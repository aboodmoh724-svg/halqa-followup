import { strict as assert } from "node:assert";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { dayDate, dayKey } from "../src/lib/dates";

test(
  "student history: privacy, repeated entries, honest results, pagination, and read-only access",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { db } = await import("../src/lib/db");
    const { getStudentHistory, historyQuery } =
      await import("../src/lib/student-history");
    const { pageAmount } = await import("../src/lib/quran");
    assert.equal(historyQuery.safeParse({ from: "2026-02-30" }).success, false);
    assert.equal(
      historyQuery.safeParse({ from: "2026-10-26", to: "2026-10-01" }).success,
      false,
    );
    const teacher = await db.teacher.create({
      data: {
        name: "history fixture",
        codeLookup: randomUUID(),
        codeHash: "fixture",
      },
    });
    const halqa = await db.halqa.create({
      data: { name: "history fixture", teacherId: teacher.id },
    });
    const student = await db.student.create({
      data: { name: "history fixture" },
    });
    const enrollment = await db.enrollment.create({
      data: { studentId: student.id, halqaId: halqa.id, reviewOnly: true },
    });
    const shift = (i: number) => {
      const d = dayDate(dayKey());
      d.setUTCDate(d.getUTCDate() - i);
      return d;
    };
    const range = { startSurah: 67, startAyah: 1, endSurah: 67, endAyah: 5 };
    try {
      for (let i = 0; i < 24; i++) {
        const session = await db.dailySession.create({
          data: {
            halqaId: halqa.id,
            date: shift(i),
            closedAt: i ? new Date() : null,
          },
        });
        const status = await db.dailyStudentStatus.create({
          data: {
            sessionId: session.id,
            enrollmentId: enrollment.id,
            halqaId: halqa.id,
            outcome: i === 0 ? null : i === 1 ? "ABSENT" : "MEMORIZED",
            reviewOnly: i === 0,
            note: i === 0 ? "ملاحظة دون نتيجة" : "",
          },
        });
        if (i === 2) {
          for (const assessment of ["MASTERED", "NOT_MASTERED"]) {
            await db.recitationEntry.create({
              data: {
                dailyStatusId: status.id,
                kind: "MEMORIZATION",
                assessment,
                ...range,
                requestKey: randomUUID(),
              },
            });
          }
        }
      }
      const emptySession = await db.dailySession.create({
        data: { halqaId: halqa.id, date: shift(24) },
      });
      await db.dailyStudentStatus.create({
        data: {
          sessionId: emptySession.id,
          enrollmentId: enrollment.id,
          halqaId: halqa.id,
        },
      });
      await db.assignment.create({
        data: {
          enrollmentId: enrollment.id,
          dueDate: shift(-1),
          review: range,
        },
      });
      const before = {
        statuses: await db.dailyStudentStatus.count({
          where: { halqaId: halqa.id },
        }),
        days: await db.dailySession.count({ where: { halqaId: halqa.id } }),
        entries: await db.recitationEntry.count({
          where: { dailyStatus: { halqaId: halqa.id } },
        }),
      };
      const result = await getStudentHistory(
        teacher.id,
        halqa.id,
        enrollment.id,
        {},
      );
      assert.equal(result.days.length, 20);
      assert(result.nextBefore);
      assert.equal(result.summary.recordedDays, 24);
      assert.equal(result.summary.absentDays, 1);
      assert.equal(result.summary.pendingDays, 1);
      assert.equal(
        result.summary.memorizationPages,
        Math.round(pageAmount(range)!.amount * 2 * 10000) / 10000,
      );
      assert.equal(
        result.summary.masteredMemorizationPages,
        pageAmount(range)!.amount,
      );
      assert.equal(
        result.days.find((d) => d.date === shift(2).toISOString().slice(0, 10))
          ?.memorizationResult,
        null,
      );
      assert.equal(result.latest?.entry.kind, "MEMORIZATION");
      assert.equal(result.upcoming?.memorization, null);
      const second = await getStudentHistory(
        teacher.id,
        halqa.id,
        enrollment.id,
        { before: result.nextBefore },
      );
      assert.equal(second.days.length, 4);
      assert.equal(second.nextBefore, null);
      assert(
        !second.days.some((d) => result.days.some((p) => p.date === d.date)),
      );
      const week = await getStudentHistory(
        teacher.id,
        halqa.id,
        enrollment.id,
        {
          from: shift(6).toISOString().slice(0, 10),
          to: dayKey(),
          kind: "REVIEW",
        },
      );
      assert.equal(week.summary.recordedDays, 7);
      assert(week.days.every((d) => !d.entries.length));
      await assert.rejects(
        getStudentHistory(randomUUID(), halqa.id, enrollment.id, {}),
        /الطالب غير موجود/,
      );
      await assert.rejects(
        getStudentHistory(teacher.id, randomUUID(), enrollment.id, {}),
        /الطالب غير موجود/,
      );
      assert.deepEqual(
        {
          statuses: await db.dailyStudentStatus.count({
            where: { halqaId: halqa.id },
          }),
          days: await db.dailySession.count({ where: { halqaId: halqa.id } }),
          entries: await db.recitationEntry.count({
            where: { dailyStatus: { halqaId: halqa.id } },
          }),
        },
        before,
      );
    } finally {
      await db.recitationEntry.deleteMany({
        where: { dailyStatus: { halqaId: halqa.id } },
      });
      await db.dailyStudentStatus.deleteMany({ where: { halqaId: halqa.id } });
      await db.dailySession.deleteMany({ where: { halqaId: halqa.id } });
      await db.assignment.deleteMany({
        where: { enrollmentId: enrollment.id },
      });
      await db.enrollment.delete({ where: { id: enrollment.id } });
      await db.student.delete({ where: { id: student.id } });
      await db.halqa.delete({ where: { id: halqa.id } });
      await db.teacher.delete({ where: { id: teacher.id } });
      await db.$disconnect();
    }
  },
);
