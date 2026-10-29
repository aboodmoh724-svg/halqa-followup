import { strict as assert } from "node:assert";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { dayKey, dayDate, nextAssignmentDay } from "../src/lib/dates";
test(
  "PostgreSQL: independent memory/review carry, absence fills only missing parts, manual protection, correction and hafiz Friday to Monday",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { db } = await import("../src/lib/db");
    const { ensureDay, getDay, mutateDay } =
      await import("../src/lib/day-service");
    const teacher = await db.teacher.create({
      data: { name: "carry test", codeHash: "test", codeLookup: randomUUID() },
    });
    const h = await db.halqa.create({
      data: { name: "carry test", teacherId: teacher.id },
    });
    const students = await Promise.all(
      ["طالب الغياب", "طالب الترحيل", "طالب حافظ", "طالب واجب المراجعة"].map(
        (name) => db.student.create({ data: { name } }),
      ),
    );
    const es = await Promise.all(
      students.map((s, i) =>
        db.enrollment.create({
          data: {
            studentId: s.id,
            halqaId: h.id,
            position: i,
            reviewOnly: i === 2,
          },
        }),
      ),
    );
    const date = dayKey(),
      range = (s: number, a: number, b: number) => ({
        startSurah: s,
        startAyah: a,
        endSurah: s,
        endAyah: b,
      });
    const m = range(67, 1, 10),
      r = range(68, 1, 20),
      manualM = range(67, 11, 20),
      manualR = range(68, 21, 30);
    const post = (index: number, data: Record<string, unknown>, d = date) =>
      mutateDay(
        teacher.id,
        h.id,
        { ...data, date: d, enrollmentId: es[index].id },
        new Date(d + "T09:00:00Z"),
      );
    const read = async (index: number, d = date) =>
      (await getDay(teacher.id, h.id, d)).students.find(
        (s) => s.enrollmentId === es[index].id,
      )!;
    const entry = (
      index: number,
      kind: string,
      recordedRange: ReturnType<typeof range>,
      assessment = "NOT_MASTERED",
    ) =>
      post(index, {
        action: "entry",
        kind,
        range: recordedRange,
        assessment,
        requestKey: randomUUID(),
      });
    try {
      await ensureDay(teacher.id, h.id, date);
      await post(0, { action: "status", outcome: "ABSENT", note: "" });
      assert.equal((await read(0)).tomorrow, null);
      await post(0, { action: "status", outcome: null, note: "" });
      await db.assignment.create({
        data: {
          enrollmentId: es[0].id,
          dueDate: dayDate(date),
          memorization: m,
          review: r,
          note: "الأصل",
        },
      });
      await post(0, {
        action: "assignment",
        memorization: manualM,
        note: "يدوي",
      });
      await post(0, { action: "status", outcome: "ABSENT", note: "" });
      let a = (await read(0)).tomorrow!;
      assert.deepEqual(a.memorization, manualM);
      assert.deepEqual(a.review, r);
      assert.equal(a.note, "يدوي");
      await post(0, { action: "status", outcome: "ABSENT", note: "" });
      assert.equal((await read(0)).tomorrow?.id, a.id);
      await post(0, { action: "status", outcome: null, note: "" });
      await post(0, { action: "assignment", memorization: manualM }); // Editing one part preserves the other's carry provenance.
      await entry(0, "REVIEW", range(68, 1, 5));
      a = (await read(0)).tomorrow!;
      assert.deepEqual(a.memorization, manualM);
      assert.deepEqual(a.review, range(68, 1, 5));
      assert(a.autoReviewStatusId);
      await post(0, {
        action: "assessment",
        kind: "REVIEW",
        assessment: "MASTERED",
      });
      assert.equal((await read(0)).tomorrow?.review, null);
      assert.deepEqual((await read(0)).tomorrow?.memorization, manualM);

      await entry(1, "MEMORIZATION", m);
      await entry(1, "REVIEW", r);
      a = (await read(1)).tomorrow!;
      assert(a.autoMemorizationStatusId && a.autoReviewStatusId);
      assert.deepEqual(a.memorization, m);
      assert.deepEqual(a.review, r);
      const reviewEntry = (await read(1)).entries.find(
        (e) => e.kind === "REVIEW",
      )!;
      await post(1, {
        action: "edit-entry",
        entryId: reviewEntry.id,
        range: range(68, 1, 18),
      });
      assert.deepEqual((await read(1)).tomorrow?.review, range(68, 1, 18));
      await post(1, {
        action: "assessment",
        kind: "MEMORIZATION",
        assessment: "MASTERED",
      });
      a = (await read(1)).tomorrow!;
      assert.equal(a.memorization, null);
      assert.deepEqual(a.review, range(68, 1, 18));
      await post(1, { action: "assignment", review: manualR });
      await post(1, {
        action: "assessment",
        kind: "REVIEW",
        assessment: "NOT_MASTERED",
      });
      assert.deepEqual((await read(1)).tomorrow?.review, manualR);
      assert.equal((await read(1)).tomorrow?.autoReviewStatusId, null);
      await post(1, {
        action: "assessment",
        kind: "REVIEW",
        assessment: "MASTERED",
      });
      assert.deepEqual((await read(1)).tomorrow?.review, manualR);
      await entry(1, "MEMORIZATION", manualM);
      a = (await read(1)).tomorrow!;
      assert.deepEqual(a.memorization, manualM);
      assert.deepEqual(a.review, manualR);

      const friday = "2026-10-30";
      await ensureDay(teacher.id, h.id, friday);
      await db.assignment.create({
        data: {
          enrollmentId: es[2].id,
          dueDate: dayDate(friday),
          memorization: m,
          review: r,
        },
      });
      await post(2, { action: "status", outcome: "ABSENT", note: "" }, friday);
      a = (await read(2, friday)).tomorrow!;
      assert.equal(a.memorization, null);
      assert.deepEqual(a.review, r);
      assert.equal(
        await db.assignment.count({
          where: { enrollmentId: es[2].id, dueDate: dayDate("2026-11-02") },
        }),
        1,
      );
      await ensureDay(teacher.id, h.id, "2026-11-02");
      assert.deepEqual((await read(2, "2026-11-02")).today?.review, r);
      assert.equal((await read(2, "2026-11-02")).today?.memorization, null);
      // Existing review data from before the migration has no auto marker: never overwrite it.
      await db.assignment.update({
        where: {
          enrollmentId_dueDate: {
            enrollmentId: es[2].id,
            dueDate: dayDate(nextAssignmentDay(date)),
          },
        },
        data: {
          review: manualR,
          reviewManual: false,
          carriedFromId: null,
        },
      });
      await entry(2, "REVIEW", r);
      assert.deepEqual((await read(2)).tomorrow?.review, manualR);
      await db.assignment.create({
        data: {
          enrollmentId: es[3].id,
          dueDate: dayDate(friday),
          memorization: m,
          review: r,
        },
      });
      await post(
        3,
        { action: "assignment", review: manualR, note: "اختيار المراجعة" },
        friday,
      );
      await post(3, { action: "status", outcome: "ABSENT", note: "" }, friday);
      const mixed = (await read(3, friday)).tomorrow!;
      assert.deepEqual(mixed.memorization, m);
      assert.deepEqual(mixed.review, manualR);
      assert.equal(mixed.note, "اختيار المراجعة");
      assert.deepEqual((await read(3, "2026-11-02")).today?.memorization, m);
      assert.deepEqual((await read(3, "2026-11-02")).today?.review, manualR);
      await post(3, { action: "assignment", review: null }, friday);
      await post(3, { action: "status", outcome: "ABSENT", note: "" }, friday);
      assert.equal((await read(3, friday)).tomorrow?.review, null);
      assert.deepEqual((await read(3, friday)).tomorrow?.memorization, m);
    } finally {
      await db.recitationEntry.deleteMany({
        where: { dailyStatus: { halqaId: h.id } },
      });
      await db.dailyStudentStatus.deleteMany({ where: { halqaId: h.id } });
      await db.dailySession.deleteMany({ where: { halqaId: h.id } });
      await db.assignment.updateMany({
        where: { enrollmentId: { in: es.map((e) => e.id) } },
        data: { carriedFromId: null },
      });
      await db.assignment.deleteMany({
        where: { enrollmentId: { in: es.map((e) => e.id) } },
      });
      await db.enrollment.deleteMany({ where: { halqaId: h.id } });
      await db.student.deleteMany({
        where: { id: { in: students.map((s) => s.id) } },
      });
      await db.halqa.delete({ where: { id: h.id } });
      await db.teacher.delete({ where: { id: teacher.id } });
      await db.$disconnect();
    }
  },
);
