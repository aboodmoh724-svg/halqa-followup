import { strict as assert } from "node:assert";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { dayDate } from "../src/lib/dates";
test(
  "PostgreSQL: deadline alerts wait until midnight, exclude weekend days, resolve after completion and read without writes",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { db } = await import("../src/lib/db");
    const { getSupervisorOverview } =
      await import("../src/lib/supervisor-service");
    const { ensureDay, mutateDay, getDay } =
      await import("../src/lib/day-service");
    const t = await db.teacher.create({
      data: {
        name: "followup test",
        codeHash: "test",
        codeLookup: randomUUID(),
      },
    });
    const h = await db.halqa.create({
      data: { name: "followup test", teacherId: t.id },
    });
    const s = await db.student.create({ data: { name: "طالب متابعة تجريبي" } });
    const e = await db.enrollment.create({
      data: { studentId: s.id, halqaId: h.id },
    });
    const date = "2026-10-30",
      range = { startSurah: 2, startAyah: 1, endSurah: 2, endAyah: 20 };
    const post = (
      m: Record<string, unknown>,
      now = new Date("2026-10-30T09:00:00Z"),
    ) => mutateDay(t.id, h.id, { ...m, date, enrollmentId: e.id }, now);
    const view = (now: string) => getSupervisorOverview(date, new Date(now));
    try {
      await ensureDay(t.id, h.id, date);
      assert.equal(
        (await view("2026-10-30T20:59:59Z")).recordingAlerts.filter(
          (a) => a.halqaId === h.id && a.date === date,
        ).length,
        0,
      );
      let alerts = (await view("2026-10-30T21:00:00Z")).recordingAlerts.filter(
        (a) => a.halqaId === h.id,
      );
      assert.equal(alerts.length, 1);
      assert.equal(alerts[0].kind, "not-started");
      assert(alerts[0].missing[0].issues.includes("واجب الغد"));
      await post({
        action: "entry",
        kind: "MEMORIZATION",
        range,
        assessment: "MASTERED",
        requestKey: randomUUID(),
      });
      alerts = (await view("2026-11-01T09:00:00Z")).recordingAlerts.filter(
        (a) => a.halqaId === h.id,
      );
      assert.equal(alerts[0].kind, "incomplete");
      assert.equal(alerts[0].date, date);
      await post({
        action: "entry",
        kind: "REVIEW",
        range,
        assessment: "MASTERED",
        requestKey: randomUUID(),
      });
      await post({
        action: "assignment",
        memorization: { ...range, startAyah: 21, endAyah: 30 },
      });
      assert.equal(
        await db.assignment.count({
          where: { enrollmentId: e.id, dueDate: dayDate("2026-11-02") },
        }),
        1,
      );
      assert.equal(
        await db.assignment.count({
          where: { enrollmentId: e.id, dueDate: dayDate("2026-10-31") },
        }),
        0,
      );
      assert.equal(
        (await view("2026-11-02T07:00:00Z")).recordingAlerts.filter(
          (a) => a.halqaId === h.id,
        ).length,
        0,
      );
      await assert.rejects(
        () =>
          post(
            { action: "note", note: "عطلة" },
            new Date("2026-10-31T09:00:00Z"),
          ),
        /عطلة/,
      );
      assert.equal(
        await db.dailySession.count({ where: { halqaId: h.id } }),
        1,
      );
      await post({
        action: "entry",
        kind: "MEMORIZATION",
        range: { ...range, startAyah: 23, endAyah: 25 },
        assessment: "NOT_MASTERED",
        requestKey: randomUUID(),
      });
      assert.equal(
        (await view("2026-10-30T10:00:00Z")).alerts.filter(
          (a) => a.enrollmentId === e.id && a.kind === "sequence",
        ).length,
        1,
      );
      await post({
        action: "entry",
        kind: "MEMORIZATION",
        range: { ...range, startAyah: 21, endAyah: 22 },
        assessment: "MASTERED",
        requestKey: randomUUID(),
      });
      assert.equal(
        (await view("2026-10-30T10:00:00Z")).alerts.filter(
          (a) => a.enrollmentId === e.id && a.kind === "sequence",
        ).length,
        0,
      );
      assert.equal(
        (await getDay(t.id, h.id, date)).students[0].entries.length,
        4,
      );
      const before = await db.dailyStudentStatus.findMany({
        where: { halqaId: h.id },
      });
      await view("2026-10-30T21:00:00Z");
      assert.deepEqual(
        await db.dailyStudentStatus.findMany({ where: { halqaId: h.id } }),
        before,
      );
      assert.equal(
        await db.dailySession.count({ where: { halqaId: h.id } }),
        1,
      );
    } finally {
      await db.recitationEntry.deleteMany({
        where: { dailyStatus: { halqaId: h.id } },
      });
      await db.dailyStudentStatus.deleteMany({ where: { halqaId: h.id } });
      await db.dailySession.deleteMany({ where: { halqaId: h.id } });
      await db.assignment.updateMany({
        where: { enrollmentId: e.id },
        data: { carriedFromId: null },
      });
      await db.assignment.deleteMany({ where: { enrollmentId: e.id } });
      await db.enrollment.delete({ where: { id: e.id } });
      await db.student.delete({ where: { id: s.id } });
      await db.halqa.delete({ where: { id: h.id } });
      await db.teacher.delete({ where: { id: t.id } });
      await db.$disconnect();
    }
  },
);
