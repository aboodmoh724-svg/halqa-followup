import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
if (
  process.env.ALLOW_SMOKE_MUTATIONS !== "true" ||
  !process.env.DATABASE_URL?.includes("test")
)
  throw new Error(
    "Use only an isolated test database and ALLOW_SMOKE_MUTATIONS=true",
  );
const base = process.env.APP_URL || "http://localhost:3000";
const browser = await chromium.launch();
const context = await browser.newContext({
  // Cold PDF rendering starts a separate browser on the app server.
  // Give the download a longer deadline than ordinary UI requests.
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await mkdir("work/smoke", { recursive: true });
try {
  assert.equal((await context.request.get(`${base}/api/halqas`)).status(), 401);
  assert.equal(
    (
      await context.request.post(`${base}/api/login`, {
        data: { code: "123456", remember: true },
        headers: { origin: "https://foreign.example" },
      })
    ).status(),
    403,
  );
  await page.goto(base);
  await page.getByLabel("رمز المعلم", { exact: true }).waitFor();
  await page.screenshot({ path: "work/smoke/login.png" });
  await page
    .getByLabel("رمز المعلم", { exact: true })
    .fill(process.env.SEED_TEACHER_CODE);
  await page
    .getByRole("button", { name: "الدخول إلى الحلقة", exact: true })
    .click();
  await page.getByRole("button", { name: /محمد أحمد علي/ }).waitFor();
  await page.screenshot({ path: "work/smoke/students.png" });
  const scheduleTeacher = await (
    await context.request.get(`${base}/api/halqas`)
  ).json();
  const scheduleDay = await (
    await context.request.get(
      `${base}/api/halqas/${scheduleTeacher.halqas[0].id}`,
    )
  ).json();
  if (scheduleDay.readOnlyReason) {
    await page.getByRole("button", { name: /محمد أحمد علي/ }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "+ حفظ جديد", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      (
        await context.request.post(
          `${base}/api/halqas/${scheduleDay.halqaId}`,
          {
            data: { action: "close", date: scheduleDay.date },
            headers: { origin: base },
          },
        )
      ).status(),
      409,
    );
    assert.deepEqual(errors, []);
    console.log(
      "Browser smoke passed: overnight read-only screen and server write rejection. Full mutation flow is covered by fixed-time integration tests.",
    );
  } else {
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page
      .getByRole("button", { name: "التقرير اليومي لأولياء الأمور" })
      .click();
    assert.equal(
      await page
        .getByRole("button", {
          name: "تصدير التقرير اليومي لأولياء الأمور (PDF)",
          exact: true,
        })
        .isEnabled(),
      false,
    );
    await page.getByText("التقارير المكتملة: 0 من 6").waitFor();
    await page.screenshot({
      path: "work/smoke/report-incomplete.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "الطلاب ←", exact: true }).click();
    await page.getByRole("button", { name: /محمد أحمد علي/ }).click();
    // Real history in the disposable DB: five page-sized memorization days.
    const { PrismaClient: HistoryClient } = await import("@prisma/client");
    const historyDb = new HistoryClient();
    const ranges = [
      [1, 5],
      [6, 16],
      [17, 24],
      [25, 29],
      [30, 37],
    ];
    try {
      for (let i = 0; i < 5; i++) {
        const historyDate = new Date(`${scheduleDay.date}T00:00:00Z`);
        historyDate.setUTCDate(historyDate.getUTCDate() - 5 + i);
        const session = await historyDb.dailySession.create({
          data: {
            halqaId: scheduleDay.halqaId,
            date: historyDate,
            closedAt: historyDate,
          },
        });
        await historyDb.dailyStudentStatus.create({
          data: {
            sessionId: session.id,
            halqaId: scheduleDay.halqaId,
            enrollmentId: scheduleDay.students[0].enrollmentId,
            outcome: "MEMORIZED",
            memorizationResult: "MASTERED",
            reviewResult: "MASTERED",
            entries: {
              create: {
                kind: "MEMORIZATION",
                assessment: "MASTERED",
                startSurah: 2,
                endSurah: 2,
                startAyah: ranges[i][0],
                endAyah: ranges[i][1],
                requestKey: randomUUID(),
              },
            },
          },
        });
      }
    } finally {
      await historyDb.$disconnect();
    }
    await page.getByRole("button", { name: "الطلاب ←", exact: true }).click();
    await page
      .getByRole("button", { name: "تحديث اليوم", exact: true })
      .click();
    await page.locator('main[aria-busy="false"]').waitFor();
    await page.getByRole("button", { name: /محمد أحمد علي/ }).click();
    await page
      .getByRole("button", { name: "+ واجب الغد", exact: true })
      .click();
    const proposalDialog = page.getByRole("dialog");
    await proposalDialog
      .getByRole("button", { name: "استخدام اقتراح الحفظ", exact: true })
      .click();
    assert.equal(
      await proposalDialog
        .getByRole("group", { name: "مدى الحفظ", exact: true })
        .getByRole("spinbutton")
        .first()
        .inputValue(),
      "38",
    );
    await page.screenshot({ path: "work/smoke/assignment-suggestion.png" });
    await proposalDialog
      .getByRole("button", { name: "إغلاق", exact: true })
      .click();
    const untouched = await (
      await context.request.get(`${base}/api/halqas/${scheduleDay.halqaId}`)
    ).json();
    assert.equal(untouched.students[0].entries.length, 0);
    assert.equal(untouched.students[0].tomorrow, null);
    await page.getByRole("button", { name: "+ حفظ جديد", exact: true }).click();
    const dialog = page.getByRole("dialog");
    assert.equal(
      await dialog.getByRole("spinbutton").nth(0).inputValue(),
      "10",
    );
    assert.equal(
      await dialog.getByRole("spinbutton").nth(1).inputValue(),
      "20",
    );
    await dialog
      .getByRole("button", { name: "حفظ التسجيل", exact: true })
      .click();
    await dialog.getByText("اختر نتيجة التسميع أولًا").waitFor();
    await page.screenshot({ path: "work/smoke/assessment-dialog.png" });
    await dialog.getByRole("spinbutton").nth(1).fill("17");
    await dialog.getByRole("button", { name: "حافظ", exact: true }).click();
    await dialog
      .getByRole("button", { name: "حفظ التسجيل", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "+ حفظ جديد", exact: true }).click();
    await dialog.getByRole("spinbutton").nth(0).fill("18");
    await dialog.getByRole("button", { name: "حافظ", exact: true }).click();
    await dialog
      .getByRole("button", { name: "حفظ التسجيل", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "+ مراجعة", exact: true }).click();
    assert.equal(await dialog.getByRole("combobox").nth(0).inputValue(), "68");
    await dialog.getByRole("button", { name: "غير حافظ", exact: true }).click();
    await dialog
      .getByRole("button", { name: "حفظ التسجيل", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    await page
      .getByRole("button", { name: "+ واجب الغد", exact: true })
      .click();
    assert.equal(await dialog.getByLabel("اسم الصورة (نص فقط)").count(), 0);
    await dialog.getByRole("button", { name: "حفظ", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page
      .getByRole("button", { name: "إضافة ملاحظة اليوم", exact: true })
      .click();
    await dialog
      .getByRole("textbox")
      .fill("أحسن في المراجعة، نرجو تثبيت آخر آيات الحفظ.");
    await dialog.getByRole("button", { name: "حفظ", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.screenshot({ path: "work/smoke/student.png", fullPage: true });
    const individual = await context.request.get(
      new URL(
        await page
          .getByRole("link", { name: "تنزيل تقرير الطالب PDF" })
          .getAttribute("href"),
        base,
      ).href,
      { timeout: 90000 },
    );
    assert.equal(individual.status(), 200);
    const pdf = await individual.body();
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
    await writeFile("work/smoke/student.pdf", pdf);
    const teacher = await (
      await context.request.get(`${base}/api/halqas`)
    ).json();
    const id = teacher.halqas[0].id;
    const url = `${base}/api/halqas/${id}`;
    let day = await (await context.request.get(url)).json();
    assert.equal(day.students[0].memorizationResult, "MASTERED");
    assert.equal(day.students[0].reviewResult, "NOT_MASTERED");
    assert.equal(day.students[0].entries.length, 3);
    assert.equal(day.students[0].entries[2].assessment, "NOT_MASTERED");
    await page.getByText("سجل التسميع اليوم (3)", { exact: true }).click();
    await page
      .getByRole("button", { name: "تعديل التسميع", exact: true })
      .first()
      .click();
    assert.equal(
      await dialog.getByRole("spinbutton").nth(1).inputValue(),
      "17",
    );
    await dialog.getByRole("spinbutton").nth(1).fill("16");
    await dialog.getByRole("button", { name: "حفظ", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    const edited = await (await context.request.get(url)).json();
    assert.equal(edited.students[0].entries.length, 3);
    assert.equal(
      edited.students[0].entries[0].id,
      day.students[0].entries[0].id,
    );
    assert.equal(edited.students[0].entries[0].endAyah, 16);
    assert.ok(
      edited.students[0].entries[0].pageAmount <
        day.students[0].entries[0].pageAmount,
    );
    assert.equal(edited.students[0].memorizationResult, "MASTERED");
    await page
      .getByRole("button", { name: "تعديل التسميع", exact: true })
      .first()
      .click();
    await dialog.getByRole("spinbutton").nth(1).fill("17");
    await page.screenshot({ path: "work/smoke/edit-recitation.png" });
    await dialog.getByRole("button", { name: "حفظ", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });

    await page
      .getByRole("button", { name: "تعديل التسميع", exact: true })
      .last()
      .click();
    assert.equal(
      await dialog
        .getByRole("button", { name: "بعكس ترتيب السور", exact: true })
        .count(),
      0,
    );
    await dialog.getByRole("combobox").nth(0).selectOption("92");
    await dialog.getByRole("combobox").nth(1).selectOption("78");
    await dialog.getByRole("spinbutton").nth(0).fill("1");
    await dialog.getByRole("spinbutton").nth(1).fill("40");
    await page.screenshot({ path: "work/smoke/reverse-range.png" });
    await dialog.getByRole("button", { name: "حفظ", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    const backward = await (await context.request.get(url)).json();
    assert.equal(backward.students[0].entries[2].direction, "REVERSE");
    assert.equal(backward.students[0].entries.length, 3);
    assert.ok(backward.students[0].entries[2].pageAmount > 0);
    const reversePdf = await context.request.get(
      `${url}/report?date=${day.date}&student=${day.students[0].enrollmentId}`,
      { timeout: 90000 },
    );
    assert.equal(reversePdf.status(), 200);
    await writeFile("work/smoke/reverse-student.pdf", await reversePdf.body());

    await page
      .getByRole("button", { name: "تعديل التسميع", exact: true })
      .last()
      .click();

    await dialog.getByRole("combobox").nth(0).selectOption("68");
    await dialog.getByRole("combobox").nth(1).selectOption("68");
    await dialog.getByRole("spinbutton").nth(1).fill("25");
    await dialog.getByRole("button", { name: "حفظ", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.locator(".assessment-tile").first().click();
    await dialog.getByRole("button", { name: "غير حافظ", exact: true }).click();
    await dialog
      .getByRole("button", { name: "حفظ النتيجة", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    let corrected = await (await context.request.get(url)).json();
    assert.equal(corrected.students[0].entries.length, 3);
    assert.deepEqual(corrected.students[0].tomorrow.memorization, {
      startSurah: 67,
      startAyah: 10,
      endSurah: 67,
      endAyah: 20,
    });
    await page
      .getByRole("button", { name: "+ واجب الغد", exact: true })
      .click();
    await dialog.getByText(/أبقينا واجب الغد/).waitFor();
    await page.screenshot({ path: "work/smoke/automatic-assignment.png" });
    await dialog
      .getByRole("group", { name: "مدى الحفظ" })
      .getByRole("spinbutton")
      .nth(1)
      .fill("24");
    await dialog.getByRole("button", { name: "حفظ", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.locator(".assessment-tile").first().click();
    await dialog.getByRole("button", { name: "حافظ", exact: true }).click();
    await page.screenshot({ path: "work/smoke/correct-result.png" });
    await dialog
      .getByRole("button", { name: "حفظ النتيجة", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    corrected = await (await context.request.get(url)).json();
    assert.equal(corrected.students[0].entries.length, 3);
    assert.equal(corrected.students[0].memorizationResult, "MASTERED");
    assert.equal(corrected.students[0].tomorrow.memorization.endAyah, 24);
    assert.equal(corrected.students[0].tomorrow.autoMemorizationStatusId, null);
    assert.equal(
      (await context.request.get(`${url}/report?date=${day.date}`)).status(),
      409,
    );
    assert.equal(
      (
        await context.request.get(
          `${url}/report?date=${day.date}&student=${day.students.at(-1).enrollmentId}`,
        )
      ).status(),
      409,
    );
    const post = (data) =>
      context.request.post(url, {
        data: { ...data, date: day.date },
        headers: { origin: base },
      });
    assert.equal((await post({ action: "close" })).status(), 409);
    assert.equal(
      (await context.request.get(`${base}/api/halqas/foreign`)).status(),
      404,
    );
    for (const [i, s] of day.students.entries())
      if (i > 0)
        assert.equal(
          (
            await post({
              action: "status",
              enrollmentId: s.enrollmentId,
              outcome: i === 1 ? "NOT_MEMORIZED" : "ABSENT",
              note: "",
              carry: true,
            })
          ).status(),
          200,
        );
    await page
      .getByRole("button", { name: "الطالب التالي", exact: true })
      .click();
    await page.getByRole("button", { name: "غائب اليوم", exact: true }).click();
    await dialog.getByRole("button", { name: "حفظ", exact: true }).click();
    await page.getByText("الطالب غائب اليوم", { exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "+ حفظ جديد", exact: true })
        .isVisible(),
      false,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "+ مراجعة", exact: true })
        .isVisible(),
      false,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "+ واجب الغد", exact: true })
        .isVisible(),
      true,
    );
    await page.screenshot({ path: "work/smoke/absence.png" });
    await page
      .getByRole("button", { name: "حضر الطالب — إلغاء الغياب", exact: true })
      .click();
    await page.getByRole("button", { name: "+ حفظ جديد", exact: true }).click();
    assert.equal(
      await dialog
        .getByRole("button", { name: "غير مطلوب اليوم", exact: true })
        .count(),
      0,
    );
    assert.equal(await dialog.getByLabel("سمّع الطالب آيات اليوم").count(), 0);
    await dialog.getByRole("button", { name: "غير حافظ", exact: true }).click();
    await dialog
      .getByRole("button", { name: "غير حافظ — دون تسميع", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "+ مراجعة", exact: true }).click();
    await dialog.getByRole("button", { name: "حافظ", exact: true }).click();
    await dialog
      .getByRole("button", { name: "حفظ التسجيل", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    const after = await (await context.request.get(url)).json();
    assert.equal(after.students[1].entries.length, 1);
    assert.equal(after.students[1].memorizationResult, "NOT_MASTERED");
    assert.equal(after.students[1].reviewResult, "MASTERED");
    await page.screenshot({
      path: "work/smoke/no-recitation-result.png",
      fullPage: true,
    });
    // A hafiz can complete the day by recording review alone.
    await page.getByRole("button", { name: "الطلاب ←", exact: true }).click();
    await page
      .getByRole("button", { name: new RegExp(day.students[3].name) })
      .click();
    await page
      .getByRole("button", { name: "حضر الطالب — إلغاء الغياب", exact: true })
      .click();
    await page.getByText("مسار الطالب", { exact: true }).click();
    await page
      .getByRole("button", { name: "حافظ · مراجعة فقط", exact: true })
      .click();
    await page.locator('main[aria-busy="false"]').waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "+ حفظ جديد", exact: true })
        .isVisible(),
      false,
    );
    await page.getByRole("button", { name: "+ مراجعة", exact: true }).click();
    await dialog.getByRole("button", { name: "حافظ", exact: true }).click();
    await dialog
      .getByRole("button", { name: "حفظ التسجيل", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    const hafizDay = await (await context.request.get(url)).json();
    assert.equal(hafizDay.students[3].reviewOnly, true);
    assert.equal(hafizDay.students[3].memorizationResult, null);
    assert.equal(hafizDay.students[3].reviewResult, "MASTERED");
    assert.equal(hafizDay.students[3].outcome, "MEMORIZED");
    assert.equal(hafizDay.students[3].entries.length, 1);
    await page.screenshot({
      path: "work/smoke/hafiz-student.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "+ واجب الغد", exact: true })
      .click();
    assert.equal(
      await dialog
        .getByRole("group", { name: "مدى الحفظ", exact: true })
        .count(),
      0,
    );
    await page.screenshot({ path: "work/smoke/hafiz-assignment.png" });
    await dialog.getByRole("button", { name: "حفظ", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    const hafizPdf = await context.request.get(
      `${url}/report?date=${day.date}&student=${day.students[3].enrollmentId}`,
      { timeout: 90000 },
    );
    assert.equal(hafizPdf.status(), 200);
    await writeFile("work/smoke/hafiz.pdf", await hafizPdf.body());
    // Fixture setup is guarded by the isolated TEST database check above.
    const { PrismaClient } = await import("@prisma/client");
    const fixtureDb = new PrismaClient();
    const lastStudent = day.students.at(-1);
    try {
      await fixtureDb.assignment.deleteMany({
        where: { enrollmentId: lastStudent.enrollmentId },
      });
    } finally {
      await fixtureDb.$disconnect();
    }
    await page.getByRole("button", { name: "الطلاب ←", exact: true }).click();
    await page
      .getByRole("button", { name: "تحديث اليوم", exact: true })
      .click();
    await page.locator('main[aria-busy="false"]').waitFor();
    await page
      .getByRole("button", { name: new RegExp(lastStudent.name) })
      .click();
    await page
      .getByRole("button", { name: "حضر الطالب — إلغاء الغياب", exact: true })
      .click();
    await page.getByText("مسار الطالب", { exact: true }).click();
    await page
      .getByRole("button", { name: "حافظ · مراجعة فقط", exact: true })
      .click();
    await page.locator('main[aria-busy="false"]').waitFor();
    await page.getByRole("button", { name: "غائب اليوم", exact: true }).click();
    await dialog.getByRole("button", { name: "حفظ", exact: true }).click();
    await page
      .getByRole("dialog", { name: "واجب الغد", exact: true })
      .waitFor();
    await dialog.getByText(/الطالب غائب ولا يوجد واجب سابق/).waitFor();
    await page.screenshot({ path: "work/smoke/absence-new-assignment.png" });
    await dialog.getByRole("button", { name: "حفظ", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    const absentDay = await (await context.request.get(url)).json();
    assert.equal(absentDay.students.at(-1).tomorrow.memorization, null);
    assert.ok(absentDay.students.at(-1).tomorrow.review);
    assert.equal(absentDay.students.at(-1).outcome, "ABSENT");
    const all = await context.request.get(`${url}/report?date=${day.date}`, {
      timeout: 90000,
    });
    assert.equal(all.status(), 200);
    const collectivePdf = await all.body();
    assert.equal(
      (collectivePdf.toString("latin1").match(/\/Type\s*\/Page\b/g) || [])
        .length,
      1,
    );
    await writeFile("work/smoke/halqa.pdf", collectivePdf);
    await page.getByRole("button", { name: "الطلاب ←", exact: true }).click();
    await page.getByRole("button", { name: "تحديث اليوم" }).click();
    await page.getByRole("button", { name: "ملخص ونهاية الحلقة" }).click();
    await page.getByRole("button", { name: "إنهاء يوم الحلقة" }).waitFor();
    assert.equal(
      await page
        .getByRole("link", {
          name: "تصدير التقرير اليومي لأولياء الأمور (PDF)",
          exact: true,
        })
        .isVisible(),
      true,
    );
    await page.getByText("التقارير المكتملة: 6 من 6").waitFor();
    await page.screenshot({
      path: "work/smoke/report-ready.png",
      fullPage: true,
    });
    await page.screenshot({ path: "work/smoke/summary.png", fullPage: true });
    assert.equal((await post({ action: "close" })).status(), 200);
    assert.equal(
      (
        await post({
          action: "status",
          enrollmentId: day.students[0].enrollmentId,
          outcome: "NOT_MEMORIZED",
          note: "",
          carry: false,
        })
      ).status(),
      409,
    );
    assert.equal(
      (await context.cookies()).find((c) => c.name === "halqa_session")
        ?.httpOnly,
      true,
    );
    assert.equal(
      (await context.cookies()).find((c) => c.name === "halqa_session")?.secure,
      true,
    );
    assert.deepEqual(errors, []);
    console.log(
      "Browser smoke passed: mobile flow, prefilled assignment, repeated recitations, PDF, isolation, closure and cookie flags.",
    );
  }
} finally {
  await browser.close();
}
