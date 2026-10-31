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
  const salt = randomBytes(16).toString("hex"),
    value = sup
      ? createHmac("sha256", process.env.AUTH_SECRET)
          .update("supervisor-password:code:" + code)
          .digest("hex")
      : lookup(code);
  return salt + ":" + scryptSync(value, salt, 64).toString("hex");
};
const code = String(randomInt(100000, 999999)),
  otherCode = String(randomInt(100000, 999999)),
  supCode = String(randomInt(10000000, 99999999));
const teacher = await db.teacher.create({
    data: {
      name: "معلم اختبار الجوال",
      codeHash: hashed(code),
      codeLookup: lookup(code),
    },
  }),
  other = await db.teacher.create({
    data: {
      name: "معلم معزول للاختبار",
      codeHash: hashed(otherCode),
      codeLookup: lookup(otherCode),
    },
  });
const sup = await db.supervisor.create({
    data: {
      name: "مشرف اختبار الجوال",
      username: randomUUID(),
      passwordHash: "unused",
      codeHash: hashed(supCode, true),
      codeLookup: lookup(supCode, true),
    },
  }),
  h = await db.halqa.create({
    data: { name: "حلقة اختبار الجوال", teacherId: teacher.id },
  }),
  pupil = await db.student.create({ data: { name: "طالب اختبار الأجزاء" } }),
  enrollment = await db.enrollment.create({
    data: { studentId: pupil.id, halqaId: h.id },
  });
const browser = await chromium.launch(),
  context = await browser.newContext({ viewport: { width: 390, height: 844 } }),
  page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const endpoint = `/api/halqas/${h.id}/students/${enrollment.id}/exams`,
  adminEndpoint = `/api/supervisor/halqas/${h.id}/students/${enrollment.id}/exams`;
async function login(c) {
  await page.goto(base);
  await page.getByLabel("رمز الدخول", { exact: true }).fill(c);
  await page.getByRole("button", { name: "دخول", exact: true }).click();
}
async function logout() {
  await context.request.post(base + "/api/logout", {
    headers: { origin: base },
  });
  await page.goto(base);
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
  await page.setViewportSize({ width: 390, height: 844 });
}
try {
  assert.equal(
    (await context.request.get(base + "/api/supervisor/exams")).status(),
    401,
  );
  await login(supCode);
  await page
    .getByRole("heading", { name: "الحلقات اليوم", exact: true })
    .waitFor();
  await page.getByRole("button", { name: new RegExp(h.name) }).click();
  await page.getByRole("button", { name: new RegExp(pupil.name) }).click();
  const panel = page.getByRole("region", {
    name: "إتمام الطالب واختباراته",
    exact: true,
  });
  await panel
    .getByText("اعتماد المحفوظ السابق · مرة واحدة", { exact: true })
    .click();
  const group = panel.getByRole("group", {
    name: "المحفوظ السابق",
    exact: true,
  });
  await group.getByLabel("سورة البداية", { exact: true }).selectOption("78");
  await group.getByLabel("آية البداية", { exact: true }).fill("1");
  await group.getByLabel("سورة النهاية", { exact: true }).selectOption("114");
  await group.getByLabel("آية النهاية", { exact: true }).fill("5");
  await panel
    .getByRole("button", { name: "إضافة المدى إلى القائمة", exact: true })
    .click();
  await panel
    .getByLabel("مرجع الاعتماد أو ملاحظته", { exact: true })
    .fill("محفوظ سابق راجعته المدرسة للتجربة المعزولة");
  await panel
    .getByLabel("راجعت المحفوظ السابق وهو معتمد من المدرسة.", { exact: true })
    .check();
  await panel
    .getByRole("button", { name: "اعتماد المحفوظ السابق", exact: true })
    .click();
  await panel
    .getByText("تم اعتماد المحفوظ السابق دون إضافته لصفحات الإنجاز", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await db.recitationEntry.count({
      where: { dailyStatus: { enrollmentId: enrollment.id } },
    }),
    0,
  );
  assert.equal(await db.dailySession.count({ where: { halqaId: h.id } }), 0);
  await widths();
  await page.screenshot({
    path: "work/smoke/exam-baseline.png",
    fullPage: true,
  });
  await logout();
  await login(code);
  await page.getByRole("button", { name: new RegExp(pupil.name) }).click();
  await panel
    .getByRole("heading", { name: "الإتمام والاختبارات", exact: true })
    .waitFor();
  let view = await (await context.request.get(base + endpoint)).json();
  const recite = async (s, a, b) =>
    context.request.post(base + `/api/halqas/${h.id}`, {
      headers: { origin: base },
      data: {
        action: "entry",
        enrollmentId: enrollment.id,
        date: view.today,
        kind: "MEMORIZATION",
        assessment: "MASTERED",
        range: { startSurah: s, startAyah: a, endSurah: s, endAyah: b },
        requestKey: randomUUID(),
      },
    });
  assert.equal((await recite(114, 6, 6)).status(), 200);
  await panel
    .getByRole("button", { name: "تحديث حالة الاختبارات", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "تسجيل تسميع سورة الناس كاملة", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "نعم، سمّعها كاملة بإتقان", exact: true })
    .click();
  await panel
    .getByText("تم تسجيل تسميع السورة كاملة", { exact: true })
    .waitFor();
  await panel.getByRole("button", { name: /الجزء 30/ }).click();
  await panel
    .getByLabel("التلقيني / الفتح السؤال 1", { exact: true })
    .fill("2");
  await panel.getByLabel("التنبيهي السؤال 1", { exact: true }).fill("1");
  await panel.getByLabel("التجويد السؤال 1", { exact: true }).fill("1");
  await panel
    .getByLabel("أجريت الأسئلة الثلاثة داخل الجزء وتحققت من أعداد الأخطاء.", {
      exact: true,
    })
    .check();
  await widths();
  await page.screenshot({
    path: "work/smoke/exam-teacher-form.png",
    fullPage: true,
  });
  await panel
    .getByRole("button", { name: "إرسال الاختبار للمشرف", exact: true })
    .click();
  await panel
    .getByText("أُرسل الاختبار للمشرف. تظهر حالة الاعتماد بعد مراجعته.", {
      exact: true,
    })
    .waitFor();
  view = await (await context.request.get(base + endpoint)).json();
  const exam = view.parts[0].attempts[0];
  for (const key of ["score", "rating", "passed", "actions", "scoreHalfPoints"])
    assert(!Object.hasOwn(exam, key), key + " leaked to teacher");
  assert.equal((await recite(67, 1, 3)).status(), 409);
  assert.equal((await context.request.get(base + adminEndpoint)).status(), 401);
  assert.equal(
    (
      await context.request.post(base + endpoint, {
        headers: { origin: "https://foreign.example" },
        data: {},
      })
    ).status(),
    403,
  );
  assert.equal(
    (
      await context.request.post(base + endpoint, {
        headers: { origin: base },
        data: {
          version: view.version,
          juz: 30,
          questions: [
            { prompting: 0, warning: 0, tajweed: 0 },
            { prompting: 0, warning: 0, tajweed: 0 },
            { prompting: 0, warning: 0, tajweed: 0 },
          ],
          confirmed: true,
          requestKey: randomUUID(),
          scoreHalfPoints: 200,
        },
      })
    ).status(),
    400,
  );
  await logout();
  await login(supCode);
  await page
    .getByRole("navigation", { name: "أقسام الإشراف" })
    .getByRole("button", { name: "الاختبارات", exact: true })
    .click();
  const list = page.getByRole("region", {
    name: "اختبارات الأجزاء واعتماداتها",
    exact: true,
  });
  await list
    .getByRole("button", { name: new RegExp(pupil.name + ".*الجزء 30") })
    .click();
  await panel.getByText("94.5 / 100 · ممتاز", { exact: true }).waitFor();
  await widths();
  await page.screenshot({
    path: "work/smoke/exam-supervisor-review.png",
    fullPage: true,
  });
  await panel
    .getByRole("button", { name: "اعتماد الاختبار وفتح الانتقال", exact: true })
    .click();
  await panel
    .getByText("تم اعتماد الاختبار وفتح الانتقال", { exact: true })
    .waitFor();
  await page.screenshot({
    path: "work/smoke/exam-approved.png",
    fullPage: true,
  });
  assert.equal(await db.examAction.count({ where: { examId: exam.id } }), 1);
  await logout();
  await login(code);
  await page.getByRole("button", { name: new RegExp(pupil.name) }).click();
  await panel.getByRole("button", { name: /الجزء 30/ }).click();
  await panel
    .getByText("تم اعتماد الاختبار", { exact: true })
    .first()
    .waitFor();
  assert.equal((await recite(67, 1, 3)).status(), 200);
  await logout();
  const stranger = await browser.newContext();
  try {
    assert.equal(
      (
        await stranger.request.post(base + "/api/login", {
          headers: { origin: base },
          data: { code: otherCode, remember: false },
        })
      ).status(),
      200,
    );
    assert.equal((await stranger.request.get(base + endpoint)).status(), 404);
    await stranger.request.post(base + "/api/logout", {
      headers: { origin: base },
    });
  } finally {
    await stranger.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "Part exam mobile passed: one-time baseline, actual full-surah recitation, three-question entry, no teacher grades, supervisor review/approval, progression gates, CSRF, scope and 320/390/430px layouts.",
  );
} catch (e) {
  await page.screenshot({
    path: "work/smoke/exam-failure.png",
    fullPage: true,
  });
  throw e;
} finally {
  await browser.close();
  await db.examAction.deleteMany({ where: { exam: { studentId: pupil.id } } });
  await db.partExam.deleteMany({ where: { studentId: pupil.id } });
  await db.memorizationBaseline.deleteMany({ where: { studentId: pupil.id } });
  await db.recitationEntry.deleteMany({
    where: { dailyStatus: { halqaId: h.id } },
  });
  await db.assignment.deleteMany({ where: { enrollmentId: enrollment.id } });
  await db.dailyStudentStatus.deleteMany({ where: { halqaId: h.id } });
  await db.dailySession.deleteMany({ where: { halqaId: h.id } });
  await db.enrollment.delete({ where: { id: enrollment.id } });
  await db.student.delete({ where: { id: pupil.id } });
  await db.halqa.delete({ where: { id: h.id } });
  await db.teacher.deleteMany({
    where: { id: { in: [teacher.id, other.id] } },
  });
  await db.supervisorSession.deleteMany({ where: { supervisorId: sup.id } });
  await db.supervisor.delete({ where: { id: sup.id } });
  await db.$disconnect();
}
