import { strict as assert } from "node:assert";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { dayKey, dayDate } from "../src/lib/dates";
test(
  "PostgreSQL: automatic anchor, contiguous progression, implicit direction, correction, homework and review isolation",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { db } = await import("../src/lib/db");
    const { ensureDay, getDay, mutateDay } =
      await import("../src/lib/day-service");
    const teacher = await db.teacher.create({
        data: {
          name: "sequence test",
          codeLookup: randomUUID(),
          codeHash: "test",
        },
      }),
      h = await db.halqa.create({
        data: { name: "sequence test", teacherId: teacher.id },
      }),
      student = await db.student.create({ data: { name: "طالب التتابع" } }),
      e = await db.enrollment.create({
        data: { studentId: student.id, halqaId: h.id },
      });
    const legacyStudent = await db.student.create({
      data: { name: "طالب السجل السابق" },
    });
    const legacyEnrollment = await db.enrollment.create({
      data: { studentId: legacyStudent.id, halqaId: h.id, position: 1 },
    });
    const date = dayKey(),
      now = new Date(date + "T09:00:00Z"),
      range = (s: number, a: number, b: number) => ({
        startSurah: s,
        startAyah: a,
        endSurah: s,
        endAyah: b,
      });
    const post = (m: Record<string, unknown>) =>
        mutateDay(teacher.id, h.id, { ...m, date, enrollmentId: e.id }, now),
      read = async () => (await getDay(teacher.id, h.id, date)).students[0];
    const memory = (s: number, a: number, b: number, assessment = "MASTERED") =>
      post({
        action: "entry",
        kind: "MEMORIZATION",
        range: range(s, a, b),
        assessment,
        requestKey: randomUUID(),
      });
    try {
      const priorDate = dayDate(date);
      priorDate.setUTCDate(priorDate.getUTCDate() - 1);
      const priorSession = await db.dailySession.create({
        data: { halqaId: h.id, date: priorDate, closedAt: priorDate },
      });
      const priorStatus = await db.dailyStudentStatus.create({
        data: {
          halqaId: h.id,
          sessionId: priorSession.id,
          enrollmentId: legacyEnrollment.id,
          outcome: "NOT_MEMORIZED",
          memorizationResult: "MASTERED",
          reviewResult: "NOT_MASTERED",
        },
      });
      const priorEntry = await db.recitationEntry.create({
        data: {
          dailyStatusId: priorStatus.id,
          kind: "MEMORIZATION",
          assessment: "NOT_MASTERED",
          startSurah: 2,
          startAyah: 280,
          endSurah: 2,
          endAyah: 286,
          requestKey: randomUUID(),
        },
      });
      await ensureDay(teacher.id, h.id, date);
      assert.equal((await read()).memorySequence, undefined);
      const priorView = (await getDay(teacher.id, h.id, date)).students.find(
        (x) => x.enrollmentId === legacyEnrollment.id,
      )!;
      assert.deepEqual(priorView.memorySequence?.next, { surah: 3, ayah: 1 });
      assert.equal(
        await db.memorizationSequence.count({
          where: { enrollmentId: legacyEnrollment.id },
        }),
        0,
      );
      await mutateDay(
        teacher.id,
        h.id,
        {
          action: "entry",
          kind: "MEMORIZATION",
          assessment: "MASTERED",
          range: range(3, 1, 2),
          requestKey: randomUUID(),
          enrollmentId: legacyEnrollment.id,
          date,
        },
        now,
      );
      assert.deepEqual(
        (await getDay(teacher.id, h.id, date)).students.find(
          (x) => x.enrollmentId === legacyEnrollment.id,
        )!.memorySequence?.next,
        { surah: 3, ayah: 3 },
      );
      const unchanged = await db.recitationEntry.findUniqueOrThrow({
        where: { id: priorEntry.id },
      });
      assert.equal(unchanged.assessment, "NOT_MASTERED");
      assert.equal(unchanged.masteryResult, null);

      await memory(67, 1, 5);
      assert.deepEqual((await read()).memorySequence?.next, {
        surah: 67,
        ayah: 6,
      });
      const count = await db.recitationEntry.count({
        where: { dailyStatus: { enrollmentId: e.id } },
      });
      await assert.rejects(() => memory(67, 7, 10), /الموضع التالي|أكمل/);
      assert.equal(
        await db.recitationEntry.count({
          where: { dailyStatus: { enrollmentId: e.id } },
        }),
        count,
      );
      await memory(67, 6, 30);
      assert.deepEqual((await read()).memorySequence?.adjacentSurahs, [66, 68]);
      await assert.rejects(() => memory(65, 1, 5), /المجاورة/);
      await memory(66, 1, 4);
      assert.equal((await read()).memorySequence?.direction, "REVERSE");
      assert.deepEqual((await read()).memorySequence?.next, {
        surah: 66,
        ayah: 5,
      });
      await post({
        action: "entry",
        kind: "REVIEW",
        range: range(80, 1, 5),
        assessment: "MASTERED",
        requestKey: randomUUID(),
      });
      assert.deepEqual((await read()).memorySequence?.next, {
        surah: 66,
        ayah: 5,
      });
      await post({
        action: "assessment",
        kind: "MEMORIZATION",
        assessment: "NOT_MASTERED",
      });
      assert.deepEqual((await read()).memorySequence?.next, {
        surah: 66,
        ayah: 1,
      });
      await post({
        action: "assessment",
        kind: "MEMORIZATION",
        assessment: "MASTERED",
      });
      assert.deepEqual((await read()).memorySequence?.next, {
        surah: 66,
        ayah: 5,
      });
      await assert.rejects(
        () => post({ action: "assignment", memorization: range(66, 6, 10) }),
        /الموضع التالي/,
      );
      await post({ action: "assignment", memorization: range(66, 5, 10) });
      const before = (await read()).entries.find(
        (x) => x.kind === "MEMORIZATION",
      )!;
      await assert.rejects(
        () =>
          post({
            action: "edit-entry",
            entryId: before.id,
            range: range(67, 1, 4),
          }),
        /الموضع التالي|أكمل/,
      );
      assert.equal(
        (await read()).entries.find((x) => x.id === before.id)!.endAyah,
        5,
      );
      await memory(66, 5, 6, "NOT_MASTERED");
      assert.deepEqual((await read()).memorySequence?.next, {
        surah: 66,
        ayah: 5,
      });
      await memory(66, 5, 6);
      assert.deepEqual((await read()).memorySequence?.next, {
        surah: 66,
        ayah: 7,
      });
    } finally {
      await db.memorizationSequence.deleteMany({
        where: { enrollmentId: e.id },
      });
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
      await db.student.delete({ where: { id: student.id } });
      await db.enrollment.delete({ where: { id: legacyEnrollment.id } });
      await db.student.delete({ where: { id: legacyStudent.id } });
      await db.halqa.delete({ where: { id: h.id } });
      await db.teacher.delete({ where: { id: teacher.id } });
      await db.$disconnect();
    }
  },
);
