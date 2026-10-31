import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHmac, scryptSync } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
if (
  process.env.ALLOW_SMOKE_MUTATIONS !== "true" ||
  !process.env.DATABASE_URL?.includes("test")
)
  throw Error("Isolated database required");
const db = new PrismaClient(),
  base = process.env.APP_URL || "http://localhost:3000",
  browser = await chromium.launch();
const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  }),
  teacherContext = await browser.newContext();
const username = "verify-" + randomBytes(6).toString("hex"),
  code = String(10000000 + Math.floor(Math.random() * 90000000)),
  salt = randomBytes(16).toString("hex");
const lookup = createHmac("sha256", process.env.AUTH_SECRET)
    .update(`supervisor-code:${code}`)
    .digest("hex"),
  keyed = createHmac("sha256", process.env.AUTH_SECRET)
    .update(`supervisor-password:code:${code}`)
    .digest("hex");
const supervisor = await db.supervisor.create({
  data: {
    username,
    name: "مشرف التجربة",
    passwordHash: "unused",
    codeLookup: lookup,
    codeHash: `${salt}:${scryptSync(keyed, salt, 64).toString("hex")}`,
  },
});
const t = await db.teacher.create({
    data: {
      name: "معلم تجربة الإشراف",
      codeLookup: randomUUID(),
      codeHash: "test",
    },
  }),
  h = await db.halqa.create({
    data: { name: "حلقة تجربة الإشراف", teacherId: t.id },
  }),
  s = await db.student.create({ data: { name: "طالب تجربة الإشراف" } }),
  e = await db.enrollment.create({ data: { studentId: s.id, halqaId: h.id } });
const transferTarget = await db.halqa.create({
  data: { name: "حلقة الاستقبال التجريبية", teacherId: t.id },
});
const pdfPages = (buffer) =>
  [
    ...buffer
      .toString("latin1")
      .matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g),
  ].map((m) => ({ width: Number(m[1]), height: Number(m[2]) }));
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  assert.equal(
    (await context.request.get(base + "/api/supervisor/overview")).status(),
    401,
  );
  assert.equal(
    (
      await teacherContext.request.post(base + "/api/login", {
        data: { code: process.env.SEED_TEACHER_CODE, remember: false },
        headers: { origin: base },
      })
    ).status(),
    200,
  );
  assert.equal(
    (
      await teacherContext.request.get(base + "/api/supervisor/overview")
    ).status(),
    401,
  );
  assert.equal(
    (
      await context.request.post(base + "/api/login", {
        data: { code, remember: false },
        headers: { origin: "https://foreign.example" },
      })
    ).status(),
    403,
  );
  assert.equal(await db.dailySession.count({ where: { halqaId: h.id } }), 0);
  await page.goto(base + "/supervisor");
  await page.getByLabel("رمز الدخول", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/");
  await page.screenshot({
    path: "work/smoke/supervisor-login.png",
    fullPage: true,
  });
  await page.getByLabel("رمز الدخول", { exact: true }).fill(code);
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await page
    .getByRole("heading", { name: "الفصول اليوم", exact: true })
    .waitFor();
  assert.equal(new URL(page.url()).pathname, "/");
  assert.equal((await context.request.get(base + "/api/halqas")).status(), 401);
  assert.equal(
    (await (await context.request.get(base + "/api/session")).json()).role,
    "SUPERVISOR",
  );
  const cookie = (await context.cookies()).find(
    (c) => c.name === "halqa_supervisor",
  );
  assert(cookie.httpOnly);
  assert(cookie.secure);
  assert.equal(cookie.sameSite, "Strict");
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "work/smoke/supervisor-today.png",
    fullPage: true,
  });
  const overview = await (
      await context.request.get(base + "/api/supervisor/overview")
    ).json(),
    date = overview.date;
  for (let i = 0; i < 3; i++) {
    const d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - i);
    const session = await db.dailySession.create({
      data: { halqaId: h.id, date: d },
    });
    await db.dailyStudentStatus.create({
      data: {
        sessionId: session.id,
        halqaId: h.id,
        enrollmentId: e.id,
        outcome: "ABSENT",
      },
    });
  }
  await page.reload();
  await page
    .getByRole("heading", { name: "الفصول اليوم", exact: true })
    .waitFor();
  await page
    .getByRole("navigation", { name: "أقسام الإدارة" })
    .getByRole("button", { name: /التنبيهات/ })
    .click();
  await page
    .getByText("غائب في 3 أيام مسجلة متتالية", { exact: true })
    .waitFor();
  await page.screenshot({
    path: "work/smoke/supervisor-alerts.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /طالب تجربة الإشراف/ }).click();
  await page.getByText("مجموع التسميع المسجل", { exact: true }).waitFor();
  assert.equal(
    (
      await context.request.get(
        `${base}/api/supervisor/halqas/${h.id}/students/${e.id}/history`,
      )
    ).status(),
    200,
  );
  assert.equal(
    (
      await context.request.get(
        `${base}/api/supervisor/halqas/seed-halqa/students/${e.id}/history`,
      )
    ).status(),
    404,
  );
  assert.equal(
    (
      await context.request.get(
        `${base}/api/supervisor/halqas/${h.id}/students/${e.id}/history?from=2026-02-30`,
      )
    ).status(),
    400,
  );
  const correctionUrl = `${base}/api/supervisor/halqas/${h.id}/students/${e.id}/correction`;
  assert.equal(
    (
      await teacherContext.request.get(`${correctionUrl}?date=${date}`)
    ).status(),
    401,
  );
  assert.equal(
    (
      await teacherContext.request.post(correctionUrl, {
        data: {},
        headers: { origin: base },
      })
    ).status(),
    401,
  );
  assert.equal(
    (
      await context.request.post(correctionUrl, {
        data: {},
        headers: { origin: "https://foreign.example" },
      })
    ).status(),
    403,
  );
  await page.locator(".record-day").first().locator("summary").click();
  await page
    .getByRole("button", { name: "تصحيح هذا اليوم", exact: true })
    .first()
    .click();
  const correction = page.getByRole("region", { name: "تصحيح سجل الطالب" });
  await correction.getByLabel("ما الذي تريد تصحيحه؟").selectOption("note");
  await correction
    .getByLabel("الملاحظة", { exact: true })
    .fill("ملاحظة مصححة من الإشراف");
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "work/smoke/supervisor-correction.png",
    fullPage: true,
  });
  await correction
    .getByRole("button", { name: "حفظ التصحيح", exact: true })
    .click();
  await page.getByText("تم حفظ تصحيح المشرف", { exact: true }).waitFor();
  const corrected = await db.dailyStudentStatus.findFirst({
    where: {
      enrollmentId: e.id,
      session: { date: new Date(date + "T00:00:00Z") },
    },
  });
  assert.equal(corrected.note, "ملاحظة مصححة من الإشراف");
  assert.equal(
    await db.supervisorCorrection.count({ where: { enrollmentId: e.id } }),
    1,
  );
  await page
    .getByRole("navigation", { name: "أقسام الإدارة" })
    .getByRole("button", { name: "التقارير", exact: true })
    .click();
  const report = page.getByRole("region", { name: "إصدار تقارير الإشراف" });
  await report
    .getByLabel("١. نوع التقرير", { exact: true })
    .selectOption("absence");
  await report.getByLabel("٢. الفترة", { exact: true }).selectOption("custom");
  const start = new Date(date + "T00:00:00Z");
  start.setUTCDate(start.getUTCDate() - 2);
  await report
    .getByLabel("من تاريخ", { exact: true })
    .fill(start.toISOString().slice(0, 10));
  await report.getByLabel("إلى تاريخ", { exact: true }).fill(date);
  await report.getByLabel("٣. الفصل", { exact: true }).selectOption(h.id);
  await report
    .getByRole("button", { name: "معاينة التقرير", exact: true })
    .click();
  const download = report.getByRole("link", {
    name: "تنزيل التقرير PDF",
    exact: true,
  });
  await download.waitFor();
  const pdf = await context.request.get(
    new URL(await download.getAttribute("href"), base).href,
    { timeout: 90000 },
  );
  assert.equal(pdf.status(), 200);
  const buffer = await pdf.body();
  assert.equal(buffer.subarray(0, 4).toString(), "%PDF");
  assert.match(buffer.toString("latin1"), /\/Subtype\s*\/Image/);
  assert(pdfPages(buffer).length > 0);
  assert(pdfPages(buffer).every((p) => p.height > p.width));

  await writeFile("work/smoke/supervision-report.pdf", buffer);
  await page.screenshot({
    path: "work/smoke/supervisor-reports.png",
    fullPage: true,
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await report
    .getByLabel("١. نوع التقرير", { exact: true })
    .selectOption("excellent");
  assert.equal(
    await report
      .getByRole("link", { name: "تنزيل التقرير PDF", exact: true })
      .count(),
    0,
  );
  await report
    .getByRole("button", { name: "معاينة التقرير", exact: true })
    .click();
  await report.getByText(/لا يوجد طلاب مطابقون للشروط/).waitFor();
  assert.equal(
    await report.getByLabel("إتقان لا يقل عن (%)", { exact: true }).count(),
    0,
  );
  await report
    .getByText(/أعلى 3 طلاب في الحفظ الجديد المتقن/)
    .first()
    .waitFor();
  await report
    .getByLabel("١. نوع التقرير", { exact: true })
    .selectOption("support");
  await report.getByText(/معيار المدرسة للحفظ الجديد المتقن/).waitFor();
  assert.equal(
    await report.getByLabel("إتقان أقل من (%)", { exact: true }).count(),
    0,
  );
  assert.equal(
    await report
      .getByRole("option", { name: "هذا الشهر", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await report.getByLabel("٢. الفترة", { exact: true }).inputValue(),
    "previous-week",
  );
  await report
    .getByRole("button", { name: "معاينة التقرير", exact: true })
    .click();
  await report.getByText(/بيانات غير كافية للتصنيف/).waitFor();
  const supportLink = report.getByRole("link", {
    name: "تنزيل التقرير PDF",
    exact: true,
  });
  const supportResponse = await context.request.get(
    new URL(await supportLink.getAttribute("href"), base).href,
    { timeout: 90000 },
  );
  assert.equal(supportResponse.status(), 200);
  const supportBuffer = await supportResponse.body();
  assert(pdfPages(supportBuffer).every((p) => p.height > p.width));
  await writeFile("work/smoke/support-page-policy.pdf", supportBuffer);
  await report
    .getByLabel("١. نوع التقرير", { exact: true })
    .selectOption("excellent");
  await report
    .getByLabel("٢. الفترة", { exact: true })
    .selectOption("previous-month");
  await report
    .getByLabel("١. نوع التقرير", { exact: true })
    .selectOption("comprehensive");
  await report
    .getByRole("button", { name: "معاينة التقرير", exact: true })
    .click();
  await report
    .getByRole("link", { name: "تنزيل التقرير PDF", exact: true })
    .waitFor();
  assert.equal(await report.getByLabel("٣. الفصل", { exact: true }).count(), 0);
  const unifiedDownload = report.getByRole("link", {
    name: "تنزيل التقرير PDF",
    exact: true,
  });
  const unifiedResponse = await context.request.get(
    new URL(await unifiedDownload.getAttribute("href"), base).href,
    { timeout: 90000 },
  );
  assert.equal(unifiedResponse.status(), 200);
  const unifiedBuffer = await unifiedResponse.body();
  assert(pdfPages(unifiedBuffer).length >= 3);
  assert(pdfPages(unifiedBuffer).every((p) => p.width > p.height));
  await writeFile("work/smoke/unified-weekly-report.pdf", unifiedBuffer);
  assert.equal(
    (
      await context.request.get(
        base + "/api/supervisor/reports?from=2026-02-30&to=" + date,
      )
    ).status(),
    400,
  );
  assert.equal(
    (
      await teacherContext.request.get(
        base + "/api/supervisor/reports?from=" + date + "&to=" + date,
      )
    ).status(),
    401,
  );
  assert.equal(await db.dailySession.count({ where: { halqaId: h.id } }), 3);
  // Create an incomplete expired school day and a non-blocking Quran gap.
  const yesterday = new Date(date + "T00:00:00Z");
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  await db.dailyStudentStatus.updateMany({
    where: {
      enrollmentId: e.id,
      session: { date: { in: [yesterday, new Date(date + "T00:00:00Z")] } },
    },
    data: {
      outcome: "NOT_MEMORIZED",
      memorizationResult: "MASTERED",
      reviewResult: "NOT_MASTERED",
    },
  });
  const currentStatus = await db.dailyStudentStatus.findFirstOrThrow({
    where: {
      enrollmentId: e.id,
      session: { date: new Date(date + "T00:00:00Z") },
    },
  });
  for (const [startAyah, endAyah] of [
    [1, 20],
    [23, 25],
  ])
    await db.recitationEntry.create({
      data: {
        dailyStatusId: currentStatus.id,
        kind: "MEMORIZATION",
        assessment: "MASTERED",
        startSurah: 2,
        endSurah: 2,
        startAyah,
        endAyah,
        requestKey: randomUUID(),
      },
    });
  await page.reload();
  await page
    .getByRole("heading", { name: "الفصول اليوم", exact: true })
    .waitFor();
  await page
    .getByRole("navigation", { name: "أقسام الإدارة" })
    .getByRole("button", { name: /التنبيهات/ })
    .click();
  await page
    .getByRole("button", { name: new RegExp(s.name) })
    .filter({ hasText: /تسجيل يحتاج مراجعة: البقرة 1.*يوجد 2 آية/ })
    .waitFor();
  const card = page
    .getByRole("article")
    .filter({ has: page.getByRole("button", { name: new RegExp(h.name) }) });
  await card.getByText(/التسجيل غير مكتمل/).waitFor();
  await card.getByText("عرض الطلاب وما ينقصهم", { exact: true }).click();
  await page.screenshot({
    path: "work/smoke/supervisor-recording-alerts.png",
    fullPage: true,
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await db.recitationEntry.create({
    data: {
      dailyStatusId: currentStatus.id,
      kind: "MEMORIZATION",
      assessment: "MASTERED",
      startSurah: 2,
      endSurah: 2,
      startAyah: 21,
      endAyah: 22,
      requestKey: randomUUID(),
    },
  });
  const filled = await (
    await context.request.get(base + "/api/supervisor/overview")
  ).json();
  assert.equal(
    filled.alerts.filter(
      (a) => a.enrollmentId === e.id && a.kind === "sequence",
    ).length,
    0,
  );
  await page
    .getByRole("navigation", { name: "أقسام الإدارة" })
    .getByRole("button", { name: "التقارير", exact: true })
    .click();
  await report
    .getByLabel("١. نوع التقرير", { exact: true })
    .selectOption("excellent");
  await report.getByLabel("من تاريخ", { exact: true }).fill(date);
  await report.getByLabel("إلى تاريخ", { exact: true }).fill(date);
  await report.getByLabel("٣. الفصل", { exact: true }).selectOption(h.id);
  await report
    .getByRole("button", { name: "معاينة التقرير", exact: true })
    .click();
  await report
    .getByRole("heading", { name: "الأكثر حفظًا", exact: true })
    .waitFor();
  await report
    .getByRole("heading", { name: "الأكثر مراجعة", exact: true })
    .waitFor();
  assert.equal(await report.locator("ol li").count(), 1);
  assert.equal(
    await report
      .locator("ol")
      .evaluate(
        (el) => el.ownerDocument.defaultView.getComputedStyle(el).listStyleType,
      ),
    "decimal",
  );
  await report.getByRole("button", { name: s.name, exact: true }).waitFor();
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  await page.screenshot({
    path: "work/smoke/excellence-top-three-mobile.png",
    fullPage: true,
  });
  const excellenceLink = report.getByRole("link", {
    name: "تنزيل التقرير PDF",
    exact: true,
  });
  const excellencePdf = await context.request.get(
    new URL(await excellenceLink.getAttribute("href"), base).href,
    { timeout: 90000 },
  );
  assert.equal(excellencePdf.status(), 200);
  const excellenceBytes = await excellencePdf.body();
  assert(pdfPages(excellenceBytes).every((p) => p.height > p.width));
  await writeFile(
    "work/smoke/excellence-top-three-mobile.pdf",
    excellenceBytes,
  );
  const transferUrl = `${base}/api/supervisor/halqas/${h.id}/students/${e.id}/transfer`;
  assert.equal((await teacherContext.request.get(transferUrl)).status(), 401);
  assert.equal(
    (
      await teacherContext.request.post(transferUrl, {
        data: {},
        headers: { origin: base },
      })
    ).status(),
    401,
  );
  assert.equal(
    (
      await context.request.post(transferUrl, {
        data: {},
        headers: { origin: "https://foreign.example" },
      })
    ).status(),
    403,
  );
  const originalEntryIds = (
    await db.recitationEntry.findMany({
      where: { dailyStatusId: currentStatus.id },
      orderBy: { id: "asc" },
    })
  ).map((x) => x.id);
  await page
    .getByRole("navigation", { name: "أقسام الإدارة" })
    .getByRole("button", { name: "الفصول", exact: true })
    .click();
  await page.getByRole("button", { name: new RegExp(h.name) }).click();
  await page.getByRole("button", { name: new RegExp(s.name) }).click();
  await page
    .getByRole("button", { name: "نقل الطالب إلى فصل آخر", exact: true })
    .click();
  const transfer = page.getByRole("region", {
    name: "نقل الطالب",
    exact: true,
  });
  await transfer.getByLabel("الفصل الجديد").selectOption(transferTarget.id);
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "work/smoke/student-transfer.png",
    fullPage: true,
  });
  await transfer
    .getByRole("button", { name: "تأكيد النقل الآن", exact: true })
    .click();
  await page
    .getByText("تم نقل الطالب مع الحفاظ على سجله وواجبه", { exact: true })
    .waitFor();
  const newEnrollment = await db.enrollment.findFirstOrThrow({
    where: { studentId: s.id, halqaId: transferTarget.id, active: true },
  });
  const transferredStatus = await db.dailyStudentStatus.findUniqueOrThrow({
    where: { id: currentStatus.id },
  });
  assert.equal(transferredStatus.enrollmentId, newEnrollment.id);
  assert.deepEqual(
    (
      await db.recitationEntry.findMany({
        where: { dailyStatusId: currentStatus.id },
        orderBy: { id: "asc" },
      })
    ).map((x) => x.id),
    originalEntryIds,
  );
  assert.equal(
    await db.studentTransfer.count({ where: { studentId: s.id } }),
    1,
  );
  const preservedHistory = await (
    await context.request.get(
      `${base}/api/supervisor/halqas/${transferTarget.id}/students/${newEnrollment.id}/history`,
    )
  ).json();
  assert.equal(preservedHistory.summary.recordedDays, 3);
  assert(preservedHistory.days.some((d) => d.halqaId === h.id));
  await page.locator(".record-day").nth(1).locator("summary").click();
  await page
    .locator(".record-day")
    .nth(1)
    .getByRole("button", { name: "تصحيح هذا اليوم", exact: true })
    .click();
  await page
    .getByRole("region", { name: "تصحيح سجل الطالب" })
    .getByLabel("ما الذي تريد تصحيحه؟")
    .selectOption("note");
  await page
    .getByRole("region", { name: "تصحيح سجل الطالب" })
    .getByRole("button", { name: "إغلاق", exact: true })
    .click();
  // Switching identities revokes the opposite session instead of mixing permissions.
  assert.equal(
    (
      await context.request.post(base + "/api/login", {
        data: { code: process.env.SEED_TEACHER_CODE, remember: false },
        headers: { origin: base },
      })
    ).status(),
    200,
  );
  assert.equal(
    (await context.request.get(base + "/api/supervisor/overview")).status(),
    401,
  );
  assert.equal(
    (
      await context.request.post(base + "/api/login", {
        data: { code, remember: false },
        headers: { origin: base },
      })
    ).status(),
    200,
  );
  assert.equal((await context.request.get(base + "/api/halqas")).status(), 401);
  await page
    .getByRole("button", { name: "تسجيل خروج الإدارة", exact: true })
    .click();
  await page.getByLabel("رمز الدخول", { exact: true }).waitFor();
  assert.equal(
    (await context.request.get(base + "/api/supervisor/overview")).status(),
    401,
  );
  for (let i = 0; i < 9; i++) {
    const r = await context.request.post(base + "/api/login", {
      data: { code: "00000000", remember: false },
      headers: { origin: base },
    });
    assert.equal(r.status(), i < 8 ? 401 : 429);
  }
  assert.deepEqual(errors, []);
  console.log(
    "Supervisor smoke passed: unified login, role switching, reports/PDF, dates/criteria, CSRF, throttling, secure cookies, mobile views, audited correction, immediate student transfer and role isolation.",
  );
} catch (error) {
  await page.screenshot({
    path: "work/smoke/supervisor-failure.png",
    fullPage: true,
  });
  console.error("Supervisor page errors:", errors);
  throw error;
} finally {
  await browser.close();
  await db.studentTransfer.deleteMany({ where: { studentId: s.id } });
  await db.supervisorCorrection.deleteMany({ where: { enrollmentId: e.id } });
  await db.recitationEntry.deleteMany({
    where: { dailyStatus: { enrollment: { studentId: s.id } } },
  });
  await db.dailyStudentStatus.deleteMany({
    where: { enrollment: { studentId: s.id } },
  });
  await db.dailySession.deleteMany({
    where: { halqaId: { in: [h.id, transferTarget.id] } },
  });
  await db.enrollment.deleteMany({ where: { studentId: s.id } });
  await db.student.delete({ where: { id: s.id } });
  await db.halqa.deleteMany({
    where: { id: { in: [h.id, transferTarget.id] } },
  });
  await db.teacher.delete({ where: { id: t.id } });
  await db.supervisor.delete({ where: { id: supervisor.id } });
  await db.$disconnect();
}
