import { strict as assert } from "node:assert";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  studentStreaks,
  getSupervisorOverview,
} from "../src/lib/supervisor-service";
import {
  supervisorLoginSchema,
  hashSupervisorPassword,
  verifySupervisorPassword,
} from "../src/lib/supervisor-auth";
import { dayDate, dayKey } from "../src/lib/dates";
test("supervisor password uses a separate salted domain and rejects teacher codes", () => {
  process.env.AUTH_SECRET ||= "test-supervisor-secret-at-least-32-characters";
  const password = "a-long-supervisor-password";
  const a = hashSupervisorPassword(password),
    b = hashSupervisorPassword(password);
  assert.notEqual(a, b);
  assert(!a.includes(password));
  assert(verifySupervisorPassword(password, a));
  assert(!verifySupervisorPassword("different-password", a));
  assert(
    !supervisorLoginSchema.safeParse({
      username: "supervisor",
      password: "1234",
    }).success,
  );
});
test("student alerts distinguish three recorded absences and independent results; recovery breaks streak", () => {
  const days = Array.from({ length: 3 }, (_, i) => ({
    date: `2026-10-${20 + i}`,
    outcome: "NOT_MEMORIZED",
    memorizationResult: "NOT_MASTERED",
    reviewResult: "MASTERED",
    reviewOnly: false,
  }));
  assert.equal(studentStreaks(days).memory.length, 3);
  assert.equal(studentStreaks(days).review.length, 0);
  assert.equal(studentStreaks(days).absence.length, 0);
  assert.equal(
    studentStreaks(days.map((d) => ({ ...d, outcome: "ABSENT" }))).memory
      .length,
    0,
  );
  assert.equal(
    studentStreaks(days.map((d) => ({ ...d, outcome: "ABSENT" }))).absence
      .length,
    3,
  );
  days[2].memorizationResult = "MASTERED";
  assert.equal(studentStreaks(days).memory.length, 0);
  assert.equal(
    studentStreaks(days.map((d) => ({ ...d, reviewOnly: true }))).memory.length,
    0,
  );
});
test(
  "supervision reads unopened classes without creating days and reflects corrected reports",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { db } = await import("../src/lib/db");
    const t = await db.teacher.create({
      data: {
        name: "supervisor test",
        codeHash: "test",
        codeLookup: randomUUID(),
      },
    });
    const h = await db.halqa.create({
      data: { name: "supervisor test", teacherId: t.id },
    });
    const s = await db.student.create({ data: { name: "طالب اختبار إشراف" } });
    const e = await db.enrollment.create({
      data: { studentId: s.id, halqaId: h.id },
    });
    const date = dayKey();
    try {
      let view = (await getSupervisorOverview(date)).classes.find(
        (x) => x.id === h.id,
      )!;
      assert.equal(view.state, "not-started");
      assert.equal(view.students[0].recorded, false);
      assert.equal(
        await db.dailySession.count({ where: { halqaId: h.id } }),
        0,
      );
      for (let i = 0; i < 3; i++) {
        const d = dayDate(date);
        d.setUTCDate(d.getUTCDate() - i);
        const session = await db.dailySession.create({
          data: { halqaId: h.id, date: d },
        });
        await db.dailyStudentStatus.create({
          data: {
            sessionId: session.id,
            enrollmentId: e.id,
            halqaId: h.id,
            outcome: "ABSENT",
          },
        });
      }
      let overview = await getSupervisorOverview(date);
      assert.equal(
        overview.alerts.filter(
          (a) => a.enrollmentId === e.id && a.kind === "absence",
        ).length,
        1,
      );
      view = overview.classes.find((x) => x.id === h.id)!;
      assert.equal(view.complete, 1);
      assert.equal(view.month.absent, 3);
      const today = await db.dailySession.findUniqueOrThrow({
        where: { halqaId_date: { halqaId: h.id, date: dayDate(date) } },
      });
      await db.dailyStudentStatus.updateMany({
        where: { sessionId: today.id },
        data: {
          outcome: "NOT_MEMORIZED",
          memorizationResult: "NOT_MASTERED",
          reviewResult: "MASTERED",
        },
      });
      overview = await getSupervisorOverview(date);
      assert.equal(
        overview.alerts.filter(
          (a) => a.enrollmentId === e.id && a.kind === "absence",
        ).length,
        0,
      );
      assert.equal(overview.classes.find((x) => x.id === h.id)!.complete, 0);
      assert.equal(
        await db.dailySession.count({ where: { halqaId: h.id } }),
        3,
      );
    } finally {
      await db.dailyStudentStatus.deleteMany({ where: { halqaId: h.id } });
      await db.dailySession.deleteMany({ where: { halqaId: h.id } });
      await db.enrollment.delete({ where: { id: e.id } });
      await db.student.delete({ where: { id: s.id } });
      await db.halqa.delete({ where: { id: h.id } });
      await db.teacher.delete({ where: { id: t.id } });
      await db.$disconnect();
    }
  },
);
