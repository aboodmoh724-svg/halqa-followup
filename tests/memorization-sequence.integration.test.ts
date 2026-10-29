import { strict as assert } from "node:assert";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { dayKey } from "../src/lib/dates";
test(
  "PostgreSQL: Fatiha to Baqara, gaps, other surahs, homework and corrections save despite old strict anchors",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { db } = await import("../src/lib/db");
    const { ensureDay, getDay, mutateDay } =
      await import("../src/lib/day-service");
    const teacher = await db.teacher.create({
      data: {
        name: "advisory test",
        codeLookup: randomUUID(),
        codeHash: "test",
      },
    });
    const h = await db.halqa.create({
      data: { name: "advisory test", teacherId: teacher.id },
    });
    const student = await db.student.create({
      data: { name: "طالب التتابع التجريبي" },
    });
    const e = await db.enrollment.create({
      data: { studentId: student.id, halqaId: h.id },
    });
    const date = dayKey(),
      now = new Date(date + "T09:00:00Z");
    const r = (s: number, a: number, b: number) => ({
      startSurah: s,
      startAyah: a,
      endSurah: s,
      endAyah: b,
    });
    const post = (m: Record<string, unknown>) =>
      mutateDay(teacher.id, h.id, { ...m, date, enrollmentId: e.id }, now);
    const memory = (s: number, a: number, b: number, assessment = "MASTERED") =>
      post({
        action: "entry",
        kind: "MEMORIZATION",
        range: r(s, a, b),
        assessment,
        requestKey: randomUUID(),
      });
    const read = async () => (await getDay(teacher.id, h.id, date)).students[0];
    try {
      await ensureDay(teacher.id, h.id, date);
      await memory(1, 1, 7);
      const oldAnchor = await db.memorizationSequence.create({
        data: {
          enrollmentId: e.id,
          startSurah: 114,
          startAyah: 1,
          initialDirection: "REVERSE",
          anchorMastered: true,
        },
      });
      assert.deepEqual((await read()).memorySequence?.next, {
        surah: 2,
        ayah: 1,
      });
      await memory(2, 1, 20);
      assert.deepEqual((await read()).memorySequence?.next, {
        surah: 2,
        ayah: 21,
      });
      await memory(2, 23, 25);
      assert.deepEqual((await read()).memorySequence?.next, {
        surah: 2,
        ayah: 26,
      });
      await memory(67, 1, 5);
      assert.deepEqual((await read()).memorySequence?.next, {
        surah: 67,
        ayah: 6,
      });
      await post({ action: "assignment", memorization: r(68, 10, 20) });
      assert.deepEqual((await read()).tomorrow?.memorization, r(68, 10, 20));
      const first = (await read()).entries[0];
      await post({
        action: "edit-entry",
        entryId: first.id,
        range: r(1, 1, 6),
      });
      assert.equal((await read()).entries[0].endAyah, 6);
      await post({
        action: "assessment",
        kind: "MEMORIZATION",
        assessment: "NOT_MASTERED",
      });
      assert.deepEqual((await read()).memorySequence?.next, {
        surah: 67,
        ayah: 1,
      });
      await post({
        action: "assessment",
        kind: "MEMORIZATION",
        assessment: "MASTERED",
      });
      assert.deepEqual((await read()).memorySequence?.next, {
        surah: 67,
        ayah: 6,
      });
      await post({
        action: "entry",
        kind: "REVIEW",
        range: r(80, 1, 5),
        assessment: "MASTERED",
        requestKey: randomUUID(),
      });
      assert.deepEqual((await read()).memorySequence?.next, {
        surah: 67,
        ayah: 6,
      });
      const before = await db.recitationEntry.count({
        where: { dailyStatus: { enrollmentId: e.id } },
      });
      await assert.rejects(() => memory(67, 1, 31));
      assert.equal(
        await db.recitationEntry.count({
          where: { dailyStatus: { enrollmentId: e.id } },
        }),
        before,
      );
      assert.deepEqual(
        await db.memorizationSequence.findUnique({
          where: { enrollmentId: e.id },
        }),
        oldAnchor,
      );
      const rowsBefore = await db.recitationEntry.findMany({
        where: { dailyStatus: { enrollmentId: e.id } },
        orderBy: { id: "asc" },
      });
      await read();
      assert.deepEqual(
        await db.recitationEntry.findMany({
          where: { dailyStatus: { enrollmentId: e.id } },
          orderBy: { id: "asc" },
        }),
        rowsBefore,
      );
      assert.equal((await read()).memorySequence?.learning, true);
      // Even after enough school days establish the direction, advice never
      // turns into a hidden write lock in week two.
      for (let i = 0; i < 5; i++) {
        const oldDate = new Date(date + "T00:00:00Z");
        oldDate.setUTCDate(oldDate.getUTCDate() - 8 + i);
        const session = await db.dailySession.create({
          data: { halqaId: h.id, date: oldDate, closedAt: oldDate },
        });
        const status = await db.dailyStudentStatus.create({
          data: {
            halqaId: h.id,
            sessionId: session.id,
            enrollmentId: e.id,
            memorizationResult: "MASTERED",
          },
        });
        await db.recitationEntry.create({
          data: {
            dailyStatusId: status.id,
            kind: "MEMORIZATION",
            assessment: "MASTERED",
            ...r(2, i + 1, i + 1),
            requestKey: randomUUID(),
          },
        });
      }
      assert.equal((await read()).memorySequence?.learning, false);
      await memory(70, 10, 20);
      assert.deepEqual((await read()).memorySequence?.next, {
        surah: 70,
        ayah: 21,
      });
      assert.equal((await read()).entries.at(-1)?.startSurah, 70);
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
      await db.halqa.delete({ where: { id: h.id } });
      await db.teacher.delete({ where: { id: teacher.id } });
      await db.$disconnect();
    }
  },
);
