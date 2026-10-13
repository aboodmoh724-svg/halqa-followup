import { strict as assert } from "node:assert";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { dayDate, dayKey, nextDay } from "../src/lib/dates";
test(
  "PostgreSQL: repeat entries, assignment separation, absence, isolation, closure",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { db } = await import("../src/lib/db");
    const { ensureDay, getDay, mutateDay } =
      await import("../src/lib/day-service");
    const key = randomUUID();
    const teacher = await db.teacher.create({
      data: { name: "test", codeLookup: key, codeHash: "test" },
    });
    const other = await db.teacher.create({
      data: { name: "other", codeLookup: randomUUID(), codeHash: "test" },
    });
    const halqa = await db.halqa.create({
      data: { name: "test", teacherId: teacher.id },
    });
    const student = await db.student.create({
      data: { name: "طالب الاختبار" },
    });
    const enrollment = await db.enrollment.create({
      data: { studentId: student.id, halqaId: halqa.id },
    });
    const range = { startSurah: 67, startAyah: 10, endSurah: 67, endAyah: 20 };
    const today = dayKey();
    try {
      await db.assignment.create({
        data: {
          enrollmentId: enrollment.id,
          dueDate: dayDate(today),
          memorization: range,
        },
      });
      await assert.rejects(
        () => ensureDay(other.id, halqa.id),
        /الحلقة غير موجودة/,
      );
      await ensureDay(teacher.id, halqa.id);
      assert.deepEqual(
        (await getDay(teacher.id, halqa.id)).students[0].today?.memorization,
        range,
      );
      await assert.rejects(
        () => mutateDay(teacher.id, halqa.id, { action: "close", date: today }),
        /بدون نتيجة/,
      );
      await mutateDay(teacher.id, halqa.id, {
        action: "status",
        date: today,
        enrollmentId: enrollment.id,
        outcome: "ABSENT",
        note: "",
        carry: true,
      });
      assert.deepEqual(
        (await getDay(teacher.id, halqa.id)).students[0].tomorrow?.memorization,
        range,
      );
      await assert.rejects(
        () =>
          mutateDay(teacher.id, halqa.id, {
            action: "entry",
            date: today,
            enrollmentId: enrollment.id,
            kind: "MEMORIZATION",
            range,
            requestKey: randomUUID(),
          }),
        /ألغِ الغياب/,
      );
      await mutateDay(teacher.id, halqa.id, {
        action: "status",
        date: today,
        enrollmentId: enrollment.id,
        outcome: null,
        note: "",
        carry: false,
      });
      const entry = {
        action: "entry",
        date: today,
        enrollmentId: enrollment.id,
        kind: "MEMORIZATION",
        range: { ...range, endAyah: 17 },
        requestKey: randomUUID(),
      };
      await mutateDay(teacher.id, halqa.id, entry);
      await mutateDay(teacher.id, halqa.id, entry);
      await mutateDay(teacher.id, halqa.id, {
        ...entry,
        range: { ...range, startAyah: 18 },
        requestKey: randomUUID(),
      });
      let day = await getDay(teacher.id, halqa.id);
      assert.equal(day.students[0].entries.length, 2);
      assert.deepEqual(day.students[0].today?.memorization, range);
      await assert.rejects(() =>
        mutateDay(teacher.id, halqa.id, {
          ...entry,
          range: { ...range, endAyah: 31 },
          requestKey: randomUUID(),
        }),
      );
      await assert.rejects(
        () => mutateDay(other.id, halqa.id, entry),
        /الحلقة غير موجودة/,
      );
      await assert.rejects(
        () =>
          mutateDay(teacher.id, halqa.id, {
            ...entry,
            enrollmentId: "foreign",
            requestKey: randomUUID(),
          }),
        /الطالب غير موجود/,
      );
      await mutateDay(teacher.id, halqa.id, {
        action: "status",
        date: today,
        enrollmentId: enrollment.id,
        outcome: "NOT_MEMORIZED",
        note: "تسميع فعلي مع نتيجة لم يحفظ",
        carry: false,
      });
      const nextRange = {
        startSurah: 68,
        startAyah: 1,
        endSurah: 68,
        endAyah: 25,
      };
      await mutateDay(teacher.id, halqa.id, {
        action: "assignment",
        date: today,
        enrollmentId: enrollment.id,
        memorization: nextRange,
        review: null,
        note: "اختبار",
        imageName: "17",
      });
      await ensureDay(teacher.id, halqa.id, nextDay(today));
      const tomorrow = await getDay(teacher.id, halqa.id, nextDay(today));
      assert.deepEqual(tomorrow.students[0].today?.memorization, nextRange);
      assert.equal(tomorrow.students[0].entries.length, 0);
      await mutateDay(teacher.id, halqa.id, { action: "close", date: today });
      day = await getDay(teacher.id, halqa.id);
      assert.ok(day.closedAt);
      assert.equal(day.students[0].entries.length, 2);
      await assert.rejects(
        () =>
          mutateDay(teacher.id, halqa.id, {
            ...entry,
            requestKey: randomUUID(),
          }),
        /تم إنهاء/,
      );
    } finally {
      await db.recitationEntry.deleteMany({
        where: { dailyStatus: { halqaId: halqa.id } },
      });
      await db.dailyStudentStatus.deleteMany({ where: { halqaId: halqa.id } });
      await db.dailySession.deleteMany({ where: { halqaId: halqa.id } });
      await db.assignment.updateMany({
        where: { enrollmentId: enrollment.id },
        data: { carriedFromId: null },
      });
      await db.assignment.deleteMany({
        where: { enrollmentId: enrollment.id },
      });
      await db.enrollment.delete({ where: { id: enrollment.id } });
      await db.student.delete({ where: { id: student.id } });
      await db.halqa.delete({ where: { id: halqa.id } });
      await db.teacher.deleteMany({
        where: { id: { in: [teacher.id, other.id] } },
      });
      await db.$disconnect();
    }
  },
);
