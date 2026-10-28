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
    .getByRole("heading", { name: "الحلقات اليوم", exact: true })
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
    .getByRole("heading", { name: "الحلقات اليوم", exact: true })
    .waitFor();
  await page
    .getByRole("navigation", { name: "أقسام الإشراف" })
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
  await page
    .getByRole("navigation", { name: "أقسام الإشراف" })
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
  await report.getByLabel("٣. الحلقة", { exact: true }).selectOption(h.id);
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
    .getByRole("button", { name: "تسجيل خروج الإشراف", exact: true })
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
    "Supervisor smoke passed: unified login, role switching, reports/PDF, dates/criteria, CSRF, throttling, secure cookies, mobile views and read-only access.",
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
  await db.dailyStudentStatus.deleteMany({ where: { halqaId: h.id } });
  await db.dailySession.deleteMany({ where: { halqaId: h.id } });
  await db.enrollment.delete({ where: { id: e.id } });
  await db.student.delete({ where: { id: s.id } });
  await db.halqa.delete({ where: { id: h.id } });
  await db.teacher.delete({ where: { id: t.id } });
  await db.supervisor.delete({ where: { id: supervisor.id } });
  await db.$disconnect();
}
