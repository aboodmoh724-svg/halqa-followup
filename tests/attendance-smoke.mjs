import assert from "node:assert/strict";
import {
  randomUUID,
  randomInt,
  randomBytes,
  createHmac,
  scryptSync,
} from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";
if (
  process.env.ALLOW_SMOKE_MUTATIONS !== "true" ||
  !process.env.DATABASE_URL?.includes("test")
)
  throw Error("Isolated test database only");
const db = new PrismaClient(),
  base = process.env.APP_URL || "http://localhost:3000";
const lookup = (code, sup = false) =>
  createHmac("sha256", process.env.AUTH_SECRET)
    .update(`${sup ? "supervisor" : "teacher"}-code:${code}`)
    .digest("hex");
const hashed = (code, sup = false) => {
  const salt = randomBytes(16).toString("hex");
  const keyed = sup
    ? createHmac("sha256", process.env.AUTH_SECRET)
        .update("supervisor-password:code:" + code)
        .digest("hex")
    : lookup(code);
  return salt + ":" + scryptSync(keyed, salt, 64).toString("hex");
};
const codes = [
    String(randomInt(100000, 999999)),
    String(randomInt(100000, 999999)),
  ],
  supCode = String(randomInt(10000000, 99999999));
const ts = await Promise.all(
  codes.map((c, i) =>
    db.teacher.create({
      data: {
        name: "معلم تجربة الحضور " + i,
        codeLookup: lookup(c),
        codeHash: hashed(c),
      },
    }),
  ),
);
const hs = await Promise.all(
  ts.map((t, i) =>
    db.halqa.create({
      data: {
        name: i ? "التأهيلي أ التجريبي" : "حلقة القرآن التجريبية للحضور",
        teacherId: t.id,
        attendanceOnly: i === 1,
      },
    }),
  ),
);
const pupils = await Promise.all(
  Array.from({ length: 4 }, (_, i) =>
    db.student.create({ data: { name: "طالب حضور تجريبي " + i } }),
  ),
);
const es = await Promise.all(
  pupils.map((s, i) =>
    db.enrollment.create({
      data: { studentId: s.id, halqaId: hs[i < 2 ? 0 : 1].id, position: i },
    }),
  ),
);
const sup = await db.supervisor.create({
  data: {
    name: "مشرف تجربة الحضور",
    username: randomUUID(),
    passwordHash: "unused",
    codeLookup: lookup(supCode, true),
    codeHash: hashed(supCode, true),
  },
});
const browser = await chromium.launch(),
  context = await browser.newContext({ viewport: { width: 390, height: 844 } }),
  page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function login(code) {
  await page.goto(base);
  await page.getByLabel("رمز الدخول", { exact: true }).fill(code);
  await page.getByRole("button", { name: "دخول", exact: true }).click();
}
async function widths() {
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
}
try {
  assert.equal(
    (await context.request.get(base + "/api/supervisor/attendance")).status(),
    401,
  );
  await login(codes[1]);
  const region = page.getByRole("region", {
    name: "تسجيل الحضور والغياب",
    exact: true,
  });
  await region
    .getByRole("heading", { name: hs[1].name, exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "+ حفظ جديد", exact: true }).count(),
    0,
  );
  assert.equal(
    (
      await context.request.get(
        base + "/api/halqas/" + hs[0].id + "/attendance",
      )
    ).status(),
    404,
  );
  assert.equal(
    (await context.request.get(base + "/api/halqas/" + hs[1].id)).status(),
    404,
  );
  const bad = await context.request.post(
    base + "/api/halqas/" + hs[1].id + "/attendance",
    { headers: { origin: "https://foreign.example" }, data: {} },
  );
  assert.equal(bad.status(), 403);
  // The weekend notice remains after removing the temporary practice flow.
  const endpoint = base + "/api/halqas/" + hs[1].id + "/attendance";
  await page.route(endpoint, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      response,
      json: {
        ...data,
        readOnlyReason:
          "التسجيل متوقف يومي السبت والأحد لأنهما عطلة. يُفتح التسجيل يوم الاثنين الساعة 6 صباحًا.",
      },
    });
  });
  await page.reload();
  await region.getByText("التسجيل متوقف لهذا اليوم", { exact: true }).waitFor();
  assert(await region.getByRole("checkbox").first().isDisabled());
  assert.equal(
    await page
      .getByRole("button", { name: "تجربة الحضور بأسماء وهمية", exact: true })
      .count(),
    0,
  );
  await page.screenshot({
    path: "work/smoke/attendance-weekend.png",
    fullPage: true,
  });
  await page.unroute(endpoint);
  await page.reload();
  await region
    .getByRole("heading", { name: hs[1].name, exact: true })
    .waitFor();
  await region
    .getByRole("checkbox", { name: "غياب " + pupils[2].name, exact: true })
    .check();
  await region
    .getByRole("button", { name: "تأكيد وإرسال الحضور", exact: true })
    .click();
  await region
    .getByText("تم تأكيد وإرسال الحضور والغياب", { exact: true })
    .waitFor();
  await widths();
  await page.screenshot({
    path: "work/smoke/attendance-only-teacher.png",
    fullPage: true,
  });
  const ap = await (
    await context.request.get(base + "/api/halqas/" + hs[1].id + "/attendance")
  ).json();
  assert(ap.confirmed);
  assert.equal(ap.present, 1);
  assert.equal(ap.absent, 1);
  assert.equal(
    await db.recitationEntry.count({
      where: { dailyStatus: { halqaId: hs[1].id } },
    }),
    0,
  );
  await page.getByRole("button", { name: "خروج", exact: true }).click();
  await login(codes[0]);
  await page
    .getByText("حضور اليوم · تحديد الغائبين وإرسال", { exact: true })
    .click();
  await region
    .getByRole("heading", { name: hs[0].name, exact: true })
    .waitFor();
  await region
    .getByRole("checkbox", { name: "غياب " + pupils[1].name, exact: true })
    .check();
  await region
    .getByRole("button", { name: "تأكيد وإرسال الحضور", exact: true })
    .click();
  await region
    .getByText("تم تأكيد وإرسال الحضور والغياب", { exact: true })
    .waitFor();
  await widths();
  await page.screenshot({
    path: "work/smoke/attendance-quran-teacher.png",
    fullPage: true,
  });
  assert.equal(
    (await context.request.get(base + "/api/supervisor/attendance")).status(),
    401,
  );
  await page.getByRole("button", { name: "خروج", exact: true }).click();
  await login(supCode);
  await page
    .getByRole("navigation", { name: "أقسام الإدارة" })
    .getByRole("button", { name: "الحضور", exact: true })
    .click();
  const overview = page.getByRole("region", {
    name: "متابعة الحضور والغياب",
    exact: true,
  });
  await overview
    .getByRole("heading", { name: "جميع الغائبين", exact: true })
    .waitFor();
  await overview
    .getByRole("button", { name: new RegExp(pupils[2].name) })
    .waitFor();
  await widths();
  await page.screenshot({
    path: "work/smoke/attendance-supervisor.png",
    fullPage: true,
  });
  await overview
    .getByRole("button", { name: new RegExp(pupils[2].name) })
    .click();
  await region
    .getByRole("checkbox", { name: "غياب " + pupils[2].name, exact: true })
    .uncheck();
  await region
    .getByRole("button", { name: "تعديل وإرسال الحضور", exact: true })
    .click();
  await region
    .getByText("تم تأكيد وإرسال الحضور والغياب", { exact: true })
    .waitFor();
  const status = await db.dailyStudentStatus.findFirstOrThrow({
    where: { enrollmentId: es[2].id },
  });
  assert.equal(status.attendance, "PRESENT");
  assert.equal(status.outcome, null);
  assert.equal(
    await db.attendanceEdit.count({
      where: { halqaId: hs[1].id, actorKind: "SUPERVISOR" },
    }),
    1,
  );
  const reports = await (
    await context.request.get(
      base +
        "/api/supervisor/reports?type=comprehensive&from=" +
        ap.date +
        "&to=" +
        ap.date,
    )
  ).json();
  assert(!reports.classes.some((c) => c.id === hs[1].id));
  assert.deepEqual(errors, []);
  console.log(
    "Attendance mobile passed: prep-only login, early Quran confirmation, shared supervisor tab, correction audit, role isolation, CSRF and 320/390/430px layouts.",
  );
} catch (e) {
  await page.screenshot({
    path: "work/smoke/attendance-failure.png",
    fullPage: true,
  });
  throw e;
} finally {
  await browser.close();
  const ids = hs.map((h) => h.id);
  await db.attendanceEdit.deleteMany({ where: { halqaId: { in: ids } } });
  await db.dailyStudentStatus.deleteMany({ where: { halqaId: { in: ids } } });
  await db.dailySession.deleteMany({ where: { halqaId: { in: ids } } });
  await db.enrollment.deleteMany({ where: { halqaId: { in: ids } } });
  await db.student.deleteMany({
    where: { id: { in: pupils.map((s) => s.id) } },
  });
  await db.halqa.deleteMany({ where: { id: { in: ids } } });
  await db.teacherSession.deleteMany({
    where: { teacherId: { in: ts.map((t) => t.id) } },
  });
  await db.teacher.deleteMany({ where: { id: { in: ts.map((t) => t.id) } } });
  await db.supervisorSession.deleteMany({ where: { supervisorId: sup.id } });
  await db.supervisor.delete({ where: { id: sup.id } });
  await db.$disconnect();
}
