import { strict as assert } from "node:assert";
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
  await page.getByRole("button", { name: /محمد أحمد علي/ }).click();
  await page.getByRole("button", { name: "+ حفظ جديد", exact: true }).click();
  const dialog = page.getByRole("dialog");
  assert.equal(await dialog.getByRole("spinbutton").nth(0).inputValue(), "10");
  assert.equal(await dialog.getByRole("spinbutton").nth(1).inputValue(), "20");
  await dialog
    .getByRole("button", { name: "حفظ التسجيل", exact: true })
    .click();
  await dialog.getByText("اختر نتيجة التسميع أولًا").waitFor();
  await page.screenshot({ path: "work/smoke/assessment-dialog.png" });
  await dialog.getByRole("spinbutton").nth(1).fill("17");
  await dialog.getByRole("button", { name: "أتقن", exact: true }).click();
  await dialog
    .getByRole("button", { name: "حفظ التسجيل", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "+ حفظ جديد", exact: true }).click();
  await dialog.getByRole("spinbutton").nth(0).fill("18");
  await dialog.getByRole("button", { name: "أتقن", exact: true }).click();
  await dialog
    .getByRole("button", { name: "حفظ التسجيل", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "+ مراجعة", exact: true }).click();
  assert.equal(await dialog.getByRole("combobox").nth(0).inputValue(), "68");
  await dialog.getByRole("button", { name: "لم يتقن", exact: true }).click();
  await dialog
    .getByRole("button", { name: "حفظ التسجيل", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "+ واجب الغد", exact: true }).click();
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
  await dialog
    .getByRole("button", { name: "غير مطلوب اليوم", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "حفظ التسجيل", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "+ مراجعة", exact: true }).click();
  await dialog.getByRole("button", { name: "لم يتقن", exact: true }).click();
  await dialog.getByLabel("سمّع الطالب آيات اليوم").uncheck();
  await dialog
    .getByRole("button", { name: "حفظ التسجيل", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  const after = await (await context.request.get(url)).json();
  assert.equal(after.students[1].entries.length, 0);
  assert.equal(after.students[1].memorizationResult, "NOT_REQUIRED");
  assert.equal(after.students[1].reviewResult, "NOT_MASTERED");
  await page.screenshot({
    path: "work/smoke/no-recitation-result.png",
    fullPage: true,
  });
  const all = await context.request.get(`${url}/report?date=${day.date}`, {
    timeout: 90000,
  });
  assert.equal(all.status(), 200);
  await writeFile("work/smoke/halqa.pdf", await all.body());
  await page.getByRole("button", { name: "الطلاب ←", exact: true }).click();
  await page.getByRole("button", { name: "تحديث اليوم" }).click();
  await page.getByRole("button", { name: "ملخص ونهاية الحلقة" }).click();
  await page.getByRole("button", { name: "إنهاء يوم الحلقة" }).waitFor();
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
    (await context.cookies()).find((c) => c.name === "halqa_session")?.httpOnly,
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
} finally {
  await browser.close();
}
