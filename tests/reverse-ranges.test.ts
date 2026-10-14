import { strict as assert } from "node:assert";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  rangeSchema,
  rangeSegments,
  ayahAmount,
  pageAmount,
  surahs,
  rangeText,
} from "../src/lib/quran";
import { dayKey, nextDay } from "../src/lib/dates";
const reverse = {
  direction: "REVERSE" as const,
  startSurah: 92,
  startAyah: 1,
  endSurah: 78,
  endAyah: 40,
};
test("reverse surahs include every verse once and preserve forward page totals", () => {
  assert.equal(rangeSegments(reverse).length, 15);
  assert.deepEqual(
    rangeSegments(reverse).map((s) => s.surah),
    Array.from({ length: 15 }, (_, i) => 92 - i),
  );
  assert.equal(
    ayahAmount(reverse),
    surahs.slice(77, 92).reduce((n, s) => n + s.ayahs, 0),
  );
  assert.equal(
    pageAmount(reverse)!.amount,
    pageAmount({ startSurah: 78, startAyah: 1, endSurah: 92, endAyah: 21 })!
      .amount,
  );
  const partial = { ...reverse, startAyah: 10, endAyah: 5 };
  assert.equal(
    ayahAmount(partial),
    12 + surahs.slice(78, 91).reduce((n, s) => n + s.ayahs, 0) + 5,
  );
  assert.equal(
    pageAmount(partial, {
      edition: "madani-604",
      version: "fixture",
      fraction: () => 0.001,
    })!.amount,
    Math.round(ayahAmount(partial) * 10) / 10000,
  );
  assert.equal(
    ayahAmount({
      direction: "REVERSE",
      startSurah: 114,
      startAyah: 1,
      endSurah: 1,
      endAyah: 7,
    }),
    6236,
  );
  assert.equal(
    pageAmount({
      direction: "REVERSE",
      startSurah: 114,
      startAyah: 1,
      endSurah: 1,
      endAyah: 7,
    })!.amount,
    604,
  );
  assert.match(rangeText(reverse), /بعكس ترتيب السور/);
});
test("direction validates endpoints while verses inside each surah stay ascending", () => {
  assert.equal(
    rangeSchema.parse({ ...reverse, direction: undefined }).direction,
    "REVERSE",
  );
  assert.equal(
    rangeSchema.parse({ ...reverse, direction: "FORWARD" }).direction,
    "REVERSE",
  );
  assert.equal(
    rangeSchema.parse({
      startSurah: 78,
      startAyah: 1,
      endSurah: 92,
      endAyah: 21,
      direction: "REVERSE",
    }).direction,
    undefined,
  );
  assert.equal(
    pageAmount({ startSurah: 92, startAyah: 1, endSurah: 78, endAyah: 40 })!
      .amount,
    pageAmount(reverse)!.amount,
  );
  assert.equal(
    rangeSchema.safeParse({ ...reverse, startAyah: 22 }).success,
    false,
  );
  assert.equal(
    rangeSchema.safeParse({ ...reverse, endAyah: 41 }).success,
    false,
  );
  assert.equal(
    rangeSchema.safeParse({
      ...reverse,
      startSurah: 78,
      endSurah: 92,
      endAyah: 21,
    }).success,
    true,
  );
  assert.equal(
    ayahAmount({
      direction: "REVERSE",
      startSurah: 92,
      startAyah: 3,
      endSurah: 92,
      endAyah: 7,
    }),
    5,
  );
  assert.equal(
    rangeSchema.safeParse({
      direction: "REVERSE",
      startSurah: 92,
      startAyah: 7,
      endSurah: 92,
      endAyah: 3,
    }).success,
    false,
  );
});
test(
  "PostgreSQL: reverse range persists through correction, repeat homework and tomorrow",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { db } = await import("../src/lib/db");
    const { ensureDay, getDay, mutateDay } =
      await import("../src/lib/day-service");
    const key = randomUUID();
    const teacher = await db.teacher.create({
      data: { name: "reverse fixture", codeLookup: key, codeHash: key },
    });
    const halqa = await db.halqa.create({
      data: { teacherId: teacher.id, name: "reverse fixture" },
    });
    const student = await db.student.create({
      data: { name: "reverse fixture" },
    });
    const enrollment = await db.enrollment.create({
      data: { studentId: student.id, halqaId: halqa.id },
    });
    const date = dayKey();
    const now = new Date(`${date}T09:00:00Z`);
    try {
      await ensureDay(teacher.id, halqa.id);
      const input = {
        action: "entry",
        date,
        enrollmentId: enrollment.id,
        kind: "MEMORIZATION",
        assessment: "NOT_MASTERED",
        range: { startSurah: 92, startAyah: 1, endSurah: 78, endAyah: 40 },
        requestKey: randomUUID(),
      };
      await mutateDay(teacher.id, halqa.id, input, now);
      await mutateDay(teacher.id, halqa.id, input, now);
      let day = await getDay(teacher.id, halqa.id);
      assert.equal(day.students[0].entries.length, 1);
      assert.equal(day.students[0].entries[0].direction, "REVERSE");
      assert.equal(
        day.students[0].entries[0].pageAmount,
        pageAmount(reverse)!.amount,
      );
      assert.deepEqual(day.students[0].tomorrow?.memorization, reverse);
      await mutateDay(
        teacher.id,
        halqa.id,
        { ...input, range: { ...reverse, direction: "FORWARD" } },
        now,
      );
      assert.equal(
        (await getDay(teacher.id, halqa.id)).students[0].entries.length,
        1,
      );
      const corrected = { ...reverse, startAyah: 10, endAyah: 5 };
      await mutateDay(
        teacher.id,
        halqa.id,
        {
          action: "edit-entry",
          date,
          enrollmentId: enrollment.id,
          entryId: day.students[0].entries[0].id,
          range: corrected,
        },
        now,
      );
      day = await getDay(teacher.id, halqa.id);
      assert.equal(day.students[0].entries.length, 1);
      assert.deepEqual(day.students[0].tomorrow?.memorization, corrected);
      await mutateDay(
        teacher.id,
        halqa.id,
        {
          action: "assessment",
          date,
          enrollmentId: enrollment.id,
          kind: "MEMORIZATION",
          assessment: "NOT_MASTERED",
        },
        now,
      );
      assert.deepEqual(
        (await getDay(teacher.id, halqa.id)).students[0].tomorrow?.memorization,
        corrected,
      );
      await ensureDay(teacher.id, halqa.id, nextDay(date));
      assert.deepEqual(
        (await getDay(teacher.id, halqa.id, nextDay(date))).students[0].today
          ?.memorization,
        corrected,
      );
      const forward = {
        startSurah: 78,
        startAyah: 1,
        endSurah: 92,
        endAyah: 21,
      };
      await mutateDay(
        teacher.id,
        halqa.id,
        {
          action: "edit-entry",
          date,
          enrollmentId: enrollment.id,
          entryId: day.students[0].entries[0].id,
          range: forward,
        },
        now,
      );
      const updated = (await getDay(teacher.id, halqa.id)).students[0];
      assert.equal(updated.entries[0].direction, undefined);
      assert.equal(updated.entries[0].pageAmount, pageAmount(forward)!.amount);
      assert.deepEqual(updated.tomorrow?.memorization, forward);
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
