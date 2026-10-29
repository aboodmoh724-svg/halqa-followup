import { test } from "node:test";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { dayDate } from "../src/lib/dates";
test(
  "student transfer: immediate movement, original history, homework, retries, return, concurrency, review-only and weekend deadlines",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { db } = await import("../src/lib/db"),
      { getTransferOptions, transferStudent } =
        await import("../src/lib/student-transfers"),
      { ensureDay, getDay, mutateDay } = await import("../src/lib/day-service"),
      { getStudentHistory } = await import("../src/lib/student-history"),
      { enrollmentIdsOnDate } = await import("../src/lib/enrollment-history");
    const teachers = await Promise.all(
      [0, 1, 2].map((i) =>
        db.teacher.create({
          data: {
            name: `transfer teacher ${i}`,
            codeLookup: randomUUID(),
            codeHash: "test",
          },
        }),
      ),
    );
    const hs = await Promise.all(
      teachers.map((t, i) =>
        db.halqa.create({
          data: { name: `transfer class ${i}`, teacherId: t.id },
        }),
      ),
    );
    const supervisor = await db.supervisor.create({
      data: {
        name: "transfer supervisor",
        username: randomUUID(),
        passwordHash: "test",
      },
    });
    const pupils = await Promise.all(
      [0, 1, 2].map((i) =>
        db.student.create({ data: { name: `transfer pupil ${i}` } }),
      ),
    );
    const es = await Promise.all(
      pupils.map((s, i) =>
        db.enrollment.create({
          data: {
            studentId: s.id,
            halqaId: hs[0].id,
            reviewOnly: i === 1,
            position: i,
          },
        }),
      ),
    );
    const range = { startSurah: 2, startAyah: 1, endSurah: 2, endAyah: 5 };
    const date = "2026-10-29",
      now = new Date(date + "T09:00:00Z");
    const move = async (
      source: string,
      halqaId: string,
      targetHalqaId: string,
      at = now,
    ) =>
      transferStudent(
        supervisor.id,
        halqaId,
        source,
        {
          targetHalqaId,
          version: (await getTransferOptions(halqaId, source)).version,
          requestKey: randomUUID(),
        },
        at,
      );
    try {
      for (const d of [
        "2026-10-22",
        "2026-10-23",
        "2026-10-26",
        "2026-10-27",
        "2026-10-28",
        date,
      ]) {
        const session = await db.dailySession.create({
          data: { halqaId: hs[0].id, date: dayDate(d), closedAt: new Date() },
        });
        await db.dailyStudentStatus.create({
          data: {
            sessionId: session.id,
            enrollmentId: es[0].id,
            halqaId: hs[0].id,
            outcome: "MEMORIZED",
            memorizationResult: "MASTERED",
            reviewResult: "MASTERED",
            note: d === date ? "keep today's note" : "",
            entries: {
              create: [
                {
                  ...range,
                  kind: "MEMORIZATION",
                  assessment: "MASTERED",
                  requestKey: randomUUID(),
                },
                {
                  ...range,
                  kind: "REVIEW",
                  assessment: "MASTERED",
                  requestKey: randomUUID(),
                },
              ],
            },
          },
        });
      }
      const old = (await getDay(teachers[0].id, hs[0].id, date)).students[0];
      const past = await db.assignment.create({
        data: {
          enrollmentId: es[0].id,
          dueDate: dayDate("2026-10-28"),
          memorization: range,
          note: "past duty",
        },
      });
      const todayDuty = await db.assignment.create({
        data: {
          enrollmentId: es[0].id,
          dueDate: dayDate(date),
          memorization: range,
          review: range,
          carriedFromId: past.id,
        },
      });
      const tomorrowDuty = await db.assignment.create({
        data: {
          enrollmentId: es[0].id,
          dueDate: dayDate("2026-10-30"),
          review: range,
          reviewManual: true,
          note: "manual tomorrow",
        },
      });
      const targetDay = await db.dailySession.create({
        data: { halqaId: hs[1].id, date: dayDate(date), closedAt: new Date() },
      });
      const preflight = await getTransferOptions(hs[0].id, es[0].id);
      await assert.rejects(() =>
        transferStudent(
          "unknown-supervisor",
          hs[0].id,
          es[0].id,
          {
            targetHalqaId: hs[1].id,
            version: preflight.version,
            requestKey: randomUUID(),
          },
          now,
        ),
      );
      await assert.rejects(() =>
        transferStudent(
          supervisor.id,
          hs[0].id,
          es[0].id,
          {
            targetHalqaId: hs[0].id,
            version: preflight.version,
            requestKey: randomUUID(),
          },
          now,
        ),
      );
      await assert.rejects(() =>
        transferStudent(
          supervisor.id,
          hs[0].id,
          es[0].id,
          {
            targetHalqaId: "unknown-class",
            version: preflight.version,
            requestKey: randomUUID(),
          },
          now,
        ),
      );
      assert.equal(
        await db.studentTransfer.count({ where: { studentId: pupils[0].id } }),
        0,
      );
      const options = await getTransferOptions(hs[0].id, es[0].id),
        requestKey = randomUUID();
      const payload = {
        targetHalqaId: hs[1].id,
        version: options.version,
        requestKey,
      };
      const moved = await transferStudent(
        supervisor.id,
        hs[0].id,
        es[0].id,
        payload,
        now,
      );
      assert.equal(
        await db.enrollment.count({
          where: { studentId: pupils[0].id, active: true },
        }),
        1,
      );
      assert.equal(
        (await db.enrollment.findUniqueOrThrow({ where: { id: es[0].id } }))
          .active,
        false,
      );
      assert.equal(
        (
          await db.dailySession.findUniqueOrThrow({
            where: { id: targetDay.id },
          })
        ).closedAt,
        null,
      );
      assert(
        !(await getDay(teachers[0].id, hs[0].id, date)).students.some(
          (s) => s.enrollmentId === es[0].id,
        ),
      );
      const received = (
        await getDay(teachers[1].id, hs[1].id, date)
      ).students.find((s) => s.enrollmentId === moved.enrollmentId)!;
      assert.deepEqual(
        received.entries.map((e) => e.id),
        old.entries.map((e) => e.id),
      );
      assert.equal(received.outcome, old.outcome);
      assert.equal(received.note, old.note);
      assert(received.memorySequence);
      assert.equal(received.today?.id, todayDuty.id);
      assert.equal(received.tomorrow?.id, tomorrowDuty.id);
      assert.equal(received.tomorrow?.reviewManual, true);
      assert.deepEqual(
        await db.assignment.findUnique({ where: { id: past.id } }),
        past,
      );
      const oldReport = await getDay(teachers[0].id, hs[0].id, "2026-10-28");
      assert.equal(
        oldReport.students.find((s) => s.enrollmentId === es[0].id)?.tomorrow
          ?.id,
        todayDuty.id,
      );
      const { getCorrection } =
        await import("../src/lib/supervisor-corrections");
      assert.equal(
        (await getCorrection(hs[0].id, es[0].id, "2026-10-28")).assignment?.id,
        todayDuty.id,
      );
      const history = await getStudentHistory(
        teachers[1].id,
        hs[1].id,
        moved.enrollmentId,
        {},
      );
      assert.equal(history.summary.recordedDays, 6);
      const { getSupervisionReport } =
        await import("../src/lib/supervision-report");
      const report = await getSupervisionReport({
        type: "student",
        from: "2026-10-22",
        to: date,
        halqaId: hs[1].id,
        enrollmentId: moved.enrollmentId,
      });
      assert.equal(report.summary.students, 1);
      assert.equal(report.summary.recordedDays, 6);
      assert.equal(report.rows.length, 2);
      const excellent = await getSupervisionReport({
        type: "excellent",
        from: "2026-10-22",
        to: date,
        minDays: 6,
        mastery: 90,
        maxAbsences: 0,
      });
      assert(!excellent.rows.some((r) => r.enrollmentId === es[0].id));
      assert(excellent.rows.some((r) => r.enrollmentId === moved.enrollmentId));

      assert.equal(
        history.days.find((d) => d.date === "2026-10-28")?.halqaId,
        hs[0].id,
      );
      assert.equal(
        (await getStudentHistory(teachers[0].id, hs[0].id, es[0].id, {}))
          .summary.recordedDays,
        5,
      );
      await assert.rejects(() =>
        getStudentHistory(teachers[0].id, hs[1].id, moved.enrollmentId, {}),
      );
      await assert.rejects(() =>
        mutateDay(
          teachers[0].id,
          hs[0].id,
          {
            action: "note",
            date,
            enrollmentId: es[0].id,
            note: "stale teacher",
          },
          now,
        ),
      );
      assert.deepEqual(
        await transferStudent(supervisor.id, hs[0].id, es[0].id, payload, now),
        moved,
      );
      assert.equal(
        await db.studentTransfer.count({ where: { studentId: pupils[0].id } }),
        1,
      );
      await assert.rejects(
        () =>
          transferStudent(
            supervisor.id,
            hs[0].id,
            es[0].id,
            { ...payload, requestKey: randomUUID() },
            now,
          ),
        /تغيرت/,
      );
      const back = await move(moved.enrollmentId, hs[1].id, hs[0].id);
      assert.equal(back.enrollmentId, es[0].id);
      assert.equal(
        await db.recitationEntry.count({
          where: { dailyStatus: { enrollment: { studentId: pupils[0].id } } },
        }),
        12,
      );
      const concurrentVersion = (await getTransferOptions(hs[0].id, es[0].id))
        .version;
      const concurrent = await Promise.allSettled(
        [hs[1].id, hs[2].id].map((targetHalqaId) =>
          transferStudent(
            supervisor.id,
            hs[0].id,
            es[0].id,
            {
              targetHalqaId,
              version: concurrentVersion,
              requestKey: randomUUID(),
            },
            now,
          ),
        ),
      );
      assert.equal(
        concurrent.filter((r) => r.status === "fulfilled").length,
        1,
      );
      assert.equal(
        (
          concurrent.find(
            (r) => r.status === "rejected",
          ) as PromiseRejectedResult
        ).reason.status,
        409,
      );
      assert.equal(
        await db.enrollment.count({
          where: { studentId: pupils[0].id, active: true },
        }),
        1,
      );
      const conflictingEnrollment = await db.enrollment.create({
        data: { studentId: pupils[1].id, halqaId: hs[1].id, active: false },
      });
      const hafizDuty = await db.assignment.create({
        data: {
          enrollmentId: es[1].id,
          dueDate: dayDate("2026-10-30"),
          review: range,
        },
      });
      const conflictDuty = await db.assignment.create({
        data: {
          enrollmentId: conflictingEnrollment.id,
          dueDate: dayDate("2026-10-30"),
          review: range,
          note: "keep target duty",
        },
      });
      await assert.rejects(
        () => move(es[1].id, hs[0].id, hs[1].id),
        /يوجد واجب/,
      );
      assert.equal(
        (await db.enrollment.findUniqueOrThrow({ where: { id: es[1].id } }))
          .active,
        true,
      );
      assert.deepEqual(
        await db.assignment.findUnique({ where: { id: hafizDuty.id } }),
        hafizDuty,
      );
      assert.deepEqual(
        await db.assignment.findUnique({ where: { id: conflictDuty.id } }),
        conflictDuty,
      );
      await db.assignment.delete({ where: { id: conflictDuty.id } });
      const hafiz = await move(es[1].id, hs[0].id, hs[1].id);
      await ensureDay(teachers[1].id, hs[1].id, date);
      const hafizDay = (
        await getDay(teachers[1].id, hs[1].id, date)
      ).students.find((s) => s.enrollmentId === hafiz.enrollmentId)!;
      assert.equal(hafizDay.reviewOnly, true);
      assert.equal(hafizDay.entries.length, 0);
      assert.equal(hafizDay.suggestions?.memorization, null);
      const friday = "2026-10-30";
      const fridaySession = await db.dailySession.create({
        data: { halqaId: hs[0].id, date: dayDate(friday) },
      });
      const fridayStatus = await db.dailyStudentStatus.create({
        data: {
          enrollmentId: es[2].id,
          halqaId: hs[0].id,
          sessionId: fridaySession.id,
          outcome: "ABSENT",
        },
      });
      const monday = await db.assignment.create({
        data: {
          enrollmentId: es[2].id,
          dueDate: dayDate("2026-11-02"),
          review: range,
        },
      });
      const weekend = await move(
        es[2].id,
        hs[0].id,
        hs[2].id,
        new Date("2026-10-31T09:00:00Z"),
      );
      assert.equal(
        (
          await db.dailyStudentStatus.findUniqueOrThrow({
            where: { id: fridayStatus.id },
          })
        ).enrollmentId,
        es[2].id,
      );
      assert.equal(
        (await db.assignment.findUniqueOrThrow({ where: { id: monday.id } }))
          .enrollmentId,
        weekend.enrollmentId,
      );
      assert((await enrollmentIdsOnDate(db, friday)).has(es[2].id));
      assert(
        !(await enrollmentIdsOnDate(db, friday)).has(weekend.enrollmentId),
      );
      const { getSupervisorOverview } =
        await import("../src/lib/supervisor-service");
      const weekendView = await getSupervisorOverview(
        friday,
        new Date("2026-10-31T09:00:00Z"),
      );
      assert(
        !weekendView.recordingAlerts.some((a) =>
          a.missing.some((s) => s.enrollmentId === weekend.enrollmentId),
        ),
      );
      const count = await db.studentTransfer.count({
        where: { studentId: { in: pupils.map((s) => s.id) } },
      });
      assert.equal(count, 5);
      const audit = await db.studentTransfer.findUniqueOrThrow({
        where: { requestKey },
      });
      assert.equal(audit.supervisorId, supervisor.id);
      assert.equal(
        (audit.before as { source: { active: boolean } }).source.active,
        true,
      );
      assert.equal(
        (audit.after as { sourceActive: boolean }).sourceActive,
        false,
      );
    } finally {
      await db.studentTransfer.deleteMany({
        where: { studentId: { in: pupils.map((s) => s.id) } },
      });
      await db.recitationEntry.deleteMany({
        where: {
          dailyStatus: {
            enrollment: { studentId: { in: pupils.map((s) => s.id) } },
          },
        },
      });
      await db.dailyStudentStatus.deleteMany({
        where: { enrollment: { studentId: { in: pupils.map((s) => s.id) } } },
      });
      await db.assignment.updateMany({
        where: { enrollment: { studentId: { in: pupils.map((s) => s.id) } } },
        data: { carriedFromId: null },
      });
      await db.assignment.deleteMany({
        where: { enrollment: { studentId: { in: pupils.map((s) => s.id) } } },
      });
      await db.dailySession.deleteMany({
        where: { halqaId: { in: hs.map((h) => h.id) } },
      });
      await db.enrollment.deleteMany({
        where: { studentId: { in: pupils.map((s) => s.id) } },
      });
      await db.student.deleteMany({
        where: { id: { in: pupils.map((s) => s.id) } },
      });
      await db.halqa.deleteMany({ where: { id: { in: hs.map((h) => h.id) } } });
      await db.teacher.deleteMany({
        where: { id: { in: teachers.map((t) => t.id) } },
      });
      await db.supervisor.delete({ where: { id: supervisor.id } });
    }
  },
);
