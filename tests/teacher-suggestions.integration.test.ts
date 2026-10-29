import { strict as assert } from "node:assert";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  dayKey,
  dayDate,
  nextAssignmentDay,
  previousStudyDay,
} from "../src/lib/dates";
test(
  "PostgreSQL: independent five-day rates, corrected grades, partial-day anchoring, hafiz track and unchanged homework",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { db } = await import("../src/lib/db");
    const { ensureDay, getDay, mutateDay } =
      await import("../src/lib/day-service");
    const t = await db.teacher.create({
      data: {
        name: "suggestion test",
        codeLookup: randomUUID(),
        codeHash: "test",
      },
    });
    const h = await db.halqa.create({
      data: { name: "suggestion test", teacherId: t.id },
    });
    const students = await Promise.all(
      ["طالب الاقتراح", "طالب المراجعة"].map((name) =>
        db.student.create({ data: { name } }),
      ),
    );
    const enrollments = await Promise.all(
      students.map((s, i) =>
        db.enrollment.create({
          data: {
            studentId: s.id,
            halqaId: h.id,
            reviewOnly: !!i,
            position: i,
          },
        }),
      ),
    );
    const date = dayKey(),
      now = new Date(date + "T09:00:00Z");
    const m = [
        [1, 5],
        [6, 16],
        [17, 24],
        [25, 29],
        [30, 37],
      ],
      r = [
        [1, 16],
        [17, 29],
        [30, 48],
        [49, 61],
        [62, 76],
      ];
    const range = (a: number, b: number) => ({
      startSurah: 2,
      startAyah: a,
      endSurah: 2,
      endAyah: b,
    });
    const read = () => getDay(t.id, h.id, date);
    const post = (data: Record<string, unknown>) =>
      mutateDay(
        t.id,
        h.id,
        { ...data, date, enrollmentId: enrollments[0].id },
        now,
      );
    try {
      let prior = date;
      const dates: string[] = [];
      for (let i = 0; i < 5; i++) {
        prior = previousStudyDay(prior);
        dates.unshift(prior);
      }
      for (let i = 0; i < 5; i++) {
        const session = await db.dailySession.create({
          data: {
            halqaId: h.id,
            date: dayDate(dates[i]),
            closedAt: dayDate(dates[i]),
          },
        });
        for (const e of enrollments)
          await db.dailyStudentStatus.create({
            data: {
              sessionId: session.id,
              halqaId: h.id,
              enrollmentId: e.id,
              reviewOnly: e.reviewOnly,
              memorizationResult: "MASTERED",
              reviewResult: "MASTERED",
              outcome: "MEMORIZED",
              entries: {
                create: [
                  {
                    kind: "MEMORIZATION",
                    assessment: i === 4 ? "NOT_MASTERED" : "MASTERED",
                    ...range(...(m[i] as [number, number])),
                    requestKey: randomUUID(),
                  },
                  {
                    kind: "REVIEW",
                    assessment: "MASTERED",
                    ...range(...(r[i] as [number, number])),
                    requestKey: randomUUID(),
                  },
                ],
              },
            },
          });
      }
      await ensureDay(t.id, h.id, date);
      const duty = { memorization: range(40, 48), review: range(80, 91) };
      await db.assignment.create({
        data: {
          enrollmentId: enrollments[0].id,
          dueDate: dayDate(date),
          ...duty,
        },
      });
      let day = await read();
      const baseline = day.students[0].suggestions!;
      assert.equal(baseline.memorization?.range.startAyah, 38);
      assert.equal(baseline.review?.range.startAyah, 77);
      assert(Math.abs(baseline.memorization!.averagePages - 1) < 0.05);
      assert(Math.abs(baseline.review!.averagePages - 2) < 0.05);
      assert.equal(day.students[1].suggestions?.memorization, null);
      assert(day.students[1].suggestions?.review);
      assert.deepEqual(day.students[0].today?.memorization, duty.memorization);
      const priorRows = await db.recitationEntry.findMany({
        where: { dailyStatus: { halqaId: h.id } },
        orderBy: { id: "asc" },
      });
      await read();
      assert.deepEqual(
        await db.recitationEntry.findMany({
          where: { dailyStatus: { halqaId: h.id } },
          orderBy: { id: "asc" },
        }),
        priorRows,
      );
      for (const [kind, a, b] of [
        ["MEMORIZATION", 38, 39],
        ["REVIEW", 77, 78],
      ] as const)
        await post({
          action: "entry",
          kind,
          assessment: "MASTERED",
          range: range(a, b),
          requestKey: randomUUID(),
        });
      day = await read();
      assert.equal(
        day.students[0].suggestions?.memorization?.averagePages,
        baseline.memorization!.averagePages,
      );
      assert.equal(
        day.students[0].suggestions?.review?.averagePages,
        baseline.review!.averagePages,
      );
      assert.equal(
        day.students[0].suggestions?.memorization?.range.startAyah,
        40,
      );
      assert.equal(day.students[0].suggestions?.review?.range.startAyah, 79);
      await post({
        action: "assignment",
        memorization: range(60, 70),
        review: range(100, 110),
      });
      await post({
        action: "assignment",
        memorization: day.students[0].suggestions!.memorization!.range,
      });
      day = await read();
      assert.deepEqual(day.students[0].tomorrow?.review, range(100, 110));
      assert.deepEqual(day.students[0].today?.memorization, duty.memorization);
      assert.equal(
        await db.assignment.count({
          where: {
            enrollmentId: enrollments[0].id,
            dueDate: dayDate(nextAssignmentDay(date)),
          },
        }),
        1,
      );
      await post({
        action: "assessment",
        kind: "MEMORIZATION",
        assessment: "NOT_MASTERED",
      });
      day = await read();
      assert.equal(day.students[0].suggestions?.memorization, null);
      assert(day.students[0].suggestions?.review);
    } finally {
      await db.recitationEntry.deleteMany({
        where: { dailyStatus: { halqaId: h.id } },
      });
      await db.dailyStudentStatus.deleteMany({ where: { halqaId: h.id } });
      await db.dailySession.deleteMany({ where: { halqaId: h.id } });
      await db.assignment.updateMany({
        where: { enrollmentId: { in: enrollments.map((e) => e.id) } },
        data: { carriedFromId: null },
      });
      await db.assignment.deleteMany({
        where: { enrollmentId: { in: enrollments.map((e) => e.id) } },
      });
      await db.enrollment.deleteMany({ where: { halqaId: h.id } });
      await db.student.deleteMany({
        where: { id: { in: students.map((s) => s.id) } },
      });
      await db.halqa.delete({ where: { id: h.id } });
      await db.teacher.delete({ where: { id: t.id } });
      await db.$disconnect();
    }
  },
);
