import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHmac, scryptSync } from "node:crypto";
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
  password = randomBytes(24).toString("base64url"),
  salt = randomBytes(16).toString("hex");
const keyed = createHmac("sha256", process.env.AUTH_SECRET)
  .update(`supervisor-password:${password}`)
  .digest("hex");
const supervisor = await db.supervisor.create({
  data: {
    username,
    name: "مشرف التجربة",
    passwordHash: `${salt}:${scryptSync(keyed, salt, 64).toString("hex")}`,
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
      await context.request.post(base + "/api/supervisor/login", {
        data: { username, password },
        headers: { origin: "https://foreign.example" },
      })
    ).status(),
    403,
  );
  const before = await db.dailySession.count({ where: { halqaId: h.id } });
  assert.equal(before, 0);
  await page.goto(base + "/supervisor");
  await page
    .getByRole("button", { name: "دخول الإشراف", exact: true })
    .waitFor();
  await page.screenshot({
    path: "work/smoke/supervisor-login.png",
    fullPage: true,
  });
  await page.getByLabel("اسم المستخدم", { exact: true }).fill(username);
  await page.getByLabel("كلمة المرور", { exact: true }).fill(password);
  await page.getByRole("button", { name: "دخول الإشراف", exact: true }).click();
  await page
    .getByRole("heading", { name: "الحلقات اليوم", exact: true })
    .waitFor();
  assert.equal((await context.request.get(base + "/api/halqas")).status(), 401);
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
  ).json();
  const date = overview.date;
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
  await page.screenshot({
    path: "work/smoke/supervisor-student.png",
    fullPage: true,
  });
  await page
    .getByRole("navigation", { name: "أقسام الإشراف" })
    .getByRole("button", { name: "التقارير", exact: true })
    .click();
  await page.getByRole("button", { name: "آخر ٣٠ يومًا", exact: true }).click();
  await page.screenshot({
    path: "work/smoke/supervisor-reports.png",
    fullPage: true,
  });
  assert.equal(await db.dailySession.count({ where: { halqaId: h.id } }), 3);
  await page
    .getByRole("button", { name: "تسجيل خروج الإشراف", exact: true })
    .click();
  await page
    .getByRole("button", { name: "دخول الإشراف", exact: true })
    .waitFor();
  assert.equal(
    (await context.request.get(base + "/api/supervisor/overview")).status(),
    401,
  );
  const wrongUsername = "throttle-" + randomBytes(4).toString("hex");
  for (let i = 0; i < 9; i++) {
    const r = await context.request.post(base + "/api/supervisor/login", {
      data: { username: wrongUsername, password },
      headers: { origin: base },
    });
    assert.equal(r.status(), i < 8 ? 401 : 429);
  }
  assert.deepEqual(errors, []);
  console.log(
    "Supervisor smoke passed: separate roles, CSRF, throttling, secure cookies, mobile views, student history, alerts and read-only access.",
  );
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
