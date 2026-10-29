import { strict as assert } from "node:assert";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { dayDate, dayKey, nextDay } from "../src/lib/dates";
import { pageAmount } from "../src/lib/quran";
test(
  "PostgreSQL: repeat entries, assignment separation, absence, isolation, closure",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { db } = await import("../src/lib/db");
    const {
      ensureDay,
      getDay,
      mutateDay: mutateAtRealTime,
    } = await import("../src/lib/day-service");
    const noon = new Date(`${dayKey()}T09:00:00Z`);
    const mutateDay = (teacherId: string, halqaId: string, input: unknown) =>
      mutateAtRealTime(teacherId, halqaId, input, noon);
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
    await assert.rejects(
      () =>
        mutateAtRealTime(
          teacher.id,
          halqa.id,
          { action: "close", date: dayKey(new Date("2026-10-15T00:00:00Z")) },
          new Date("2026-10-15T00:00:00Z"),
        ),
      /انتهى وقت الإدخال/,
    );
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
      await assert.rejects(
        () =>
          mutateDay(teacher.id, halqa.id, {
            action: "assessment",
            date: today,
            enrollmentId: enrollment.id,
            kind: "MEMORIZATION",
            assessment: "MASTERED",
          }),
        /سجل مدى التسميع/,
      );
      assert.deepEqual(
        (await getDay(teacher.id, halqa.id)).students[0].today?.memorization,
        range,
      );
      await assert.rejects(
        () => mutateDay(teacher.id, halqa.id, { action: "close", date: today }),
        /غير مكتمل/,
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
        assessment: "MASTERED",
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
      for (const saved of day.students[0].entries) {
        assert.equal(saved.pageAmount, pageAmount(saved)!.amount);
        assert.equal(saved.pageMappingVersion, pageAmount(saved)!.version);
      }
      assert.deepEqual(day.students[0].today?.memorization, range);
      await mutateDay(teacher.id, halqa.id, {
        action: "assessment",
        date: today,
        enrollmentId: enrollment.id,
        kind: "MEMORIZATION",
        assessment: "NOT_MASTERED",
      });
      day = await getDay(teacher.id, halqa.id);
      assert.deepEqual(day.students[0].tomorrow?.memorization, {
        ...range,
        startAyah: 18,
      });
      assert.ok(day.students[0].tomorrow?.autoMemorizationStatusId);
      assert.equal(day.students[0].entries.length, 2);
      const edit = {
        action: "edit-entry",
        date: today,
        enrollmentId: enrollment.id,
        entryId: day.students[0].entries[1].id,
        range: { ...range, startAyah: 18, endAyah: 19 },
      };
      const originalEntry = day.students[0].entries[1];
      await mutateDay(teacher.id, halqa.id, edit);
      day = await getDay(teacher.id, halqa.id);
      assert.equal(day.students[0].entries.length, 2);
      assert.equal(day.students[0].entries[1].id, originalEntry.id);
      assert.equal(
        day.students[0].entries[1].createdAt,
        originalEntry.createdAt,
      );
      assert.equal(
        day.students[0].entries[1].assessment,
        originalEntry.assessment,
      );
      assert.equal(
        day.students[0].entries[1].pageAmount,
        pageAmount(edit.range)!.amount,
      );
      assert.equal(day.students[0].memorizationResult, "NOT_MASTERED");
      assert.deepEqual(day.students[0].tomorrow?.memorization, edit.range);
      await assert.rejects(
        () =>
          mutateDay(teacher.id, halqa.id, {
            ...edit,
            entryId: "foreign-entry",
          }),
        /التسميع غير موجود/,
      );
      await assert.rejects(
        () => mutateDay(other.id, halqa.id, edit),
        /الحلقة غير موجودة/,
      );
      await assert.rejects(() =>
        mutateDay(teacher.id, halqa.id, {
          ...edit,
          range: { ...edit.range, endAyah: 31 },
        }),
      );
      await mutateDay(teacher.id, halqa.id, {
        ...edit,
        range: { ...range, startAyah: 18 },
      });
      await mutateDay(teacher.id, halqa.id, {
        action: "assessment",
        date: today,
        enrollmentId: enrollment.id,
        kind: "MEMORIZATION",
        assessment: "MASTERED",
      });
      assert.equal(
        (await getDay(teacher.id, halqa.id)).students[0].tomorrow?.memorization,
        null,
      );
      await mutateDay(teacher.id, halqa.id, {
        action: "assessment",
        date: today,
        enrollmentId: enrollment.id,
        kind: "MEMORIZATION",
        assessment: "NOT_MASTERED",
      });
      await mutateDay(teacher.id, halqa.id, {
        action: "assignment",
        date: today,
        enrollmentId: enrollment.id,
        memorization: range,
        review: range,
        note: "واجب معدّل يدويًا",
        imageName: "",
      });
      await mutateDay(teacher.id, halqa.id, {
        action: "assessment",
        date: today,
        enrollmentId: enrollment.id,
        kind: "MEMORIZATION",
        assessment: "MASTERED",
      });
      await mutateDay(teacher.id, halqa.id, edit);
      day = await getDay(teacher.id, halqa.id);
      assert.deepEqual(day.students[0].tomorrow?.memorization, range);
      assert.deepEqual(day.students[0].tomorrow?.review, range);
      assert.equal(day.students[0].tomorrow?.autoMemorizationStatusId, null);
      assert.equal(day.students[0].entries.length, 2);

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
        note: "تسميع فعلي مع نتيجة غير حافظ",
        carry: false,
      });
      await assert.rejects(
        () =>
          mutateDay(teacher.id, halqa.id, {
            action: "assignment",
            date: today,
            enrollmentId: enrollment.id,
            memorization: {
              startSurah: 68,
              startAyah: 1,
              endSurah: 68,
              endAyah: 25,
            },
          }),
        /ابدأ من|الموضع التالي/,
      );
      const nextRange = {
        startSurah: 67,
        startAyah: 20,
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
      await mutateDay(teacher.id, halqa.id, {
        action: "assessment",
        date: today,
        enrollmentId: enrollment.id,
        kind: "MEMORIZATION",
        assessment: "MASTERED",
      });
      day = await getDay(teacher.id, halqa.id);
      assert.equal(day.students[0].outcome, null);
      await assert.rejects(
        () => mutateDay(teacher.id, halqa.id, { action: "close", date: today }),
        /غير مكتمل/,
      );
      await mutateDay(teacher.id, halqa.id, {
        action: "entry",
        range: nextRange,
        requestKey: randomUUID(),
        date: today,
        enrollmentId: enrollment.id,
        kind: "REVIEW",
        assessment: "NOT_MASTERED",
      });
      day = await getDay(teacher.id, halqa.id);
      assert.equal(day.students[0].memorizationResult, "MASTERED");
      assert.equal(day.students[0].reviewResult, "NOT_MASTERED");
      assert.equal(day.students[0].outcome, "NOT_MEMORIZED");
      assert.equal(day.students[0].entries.length, 3);
      await assert.rejects(() =>
        mutateDay(teacher.id, halqa.id, {
          action: "assessment",
          date: today,
          enrollmentId: enrollment.id,
          kind: "REVIEW",
          assessment: "NOT_REQUIRED",
        }),
      );
      await mutateDay(teacher.id, halqa.id, {
        action: "assessment",
        date: today,
        enrollmentId: enrollment.id,
        kind: "REVIEW",
        assessment: "MASTERED",
      });
      day = await getDay(teacher.id, halqa.id);
      assert.equal(day.students[0].reviewResult, "MASTERED");
      assert.equal(day.students[0].outcome, "MEMORIZED");
      await mutateDay(teacher.id, halqa.id, { action: "close", date: today });
      day = await getDay(teacher.id, halqa.id);
      assert.ok(day.closedAt);
      await mutateDay(teacher.id, halqa.id, edit);
      day = await getDay(teacher.id, halqa.id);
      assert.equal(day.closedAt, null);
      assert.equal(day.students[0].entries.length, 3);
      await mutateDay(teacher.id, halqa.id, { action: "close", date: today });
      await mutateDay(teacher.id, halqa.id, {
        ...entry,
        requestKey: randomUUID(),
      });
      assert.equal((await getDay(teacher.id, halqa.id)).closedAt, null);
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
