import { strict as assert } from "node:assert";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { dayDate, dayKey, nextDay } from "../src/lib/dates";
import { pageAmount, totalPages } from "../src/lib/quran";
import { reportIssues } from "../src/lib/types";

test(
  "PostgreSQL: no-recitation results, manual homework, stale notes and independent attempts",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { db } = await import("../src/lib/db");
    const { mutateDay, ensureDay, getDay } =
      await import("../src/lib/day-service");
    const date = dayKey();
    const now = new Date(`${date}T09:00:00Z`);
    const teacher = await db.teacher.create({
      data: {
        name: "workflow test",
        codeLookup: randomUUID(),
        codeHash: "test",
      },
    });
    const halqa = await db.halqa.create({
      data: { name: "workflow test", teacherId: teacher.id },
    });
    const student = await db.student.create({
      data: { name: "workflow test" },
    });
    const enrollment = await db.enrollment.create({
      data: { studentId: student.id, halqaId: halqa.id },
    });
    const post = (m: Record<string, unknown>) =>
      mutateDay(
        teacher.id,
        halqa.id,
        { ...m, enrollmentId: enrollment.id, date },
        now,
      );
    const read = async () =>
      (await getDay(teacher.id, halqa.id, date)).students[0];
    const range = { startSurah: 67, startAyah: 1, endSurah: 67, endAyah: 10 };
    const manual = { ...range, startAyah: 11, endAyah: 20 };
    try {
      await ensureDay(teacher.id, halqa.id, date);
      await db.assignment.create({
        data: {
          enrollmentId: enrollment.id,
          dueDate: dayDate(date),
          memorization: range,
        },
      });
      for (const kind of ["MEMORIZATION", "REVIEW"])
        await post({ action: "assessment", kind, assessment: "NOT_MASTERED" });
      let saved = await read();
      assert.equal(saved.outcome, "NOT_MEMORIZED");
      assert.equal(saved.entries.length, 0);
      assert.equal(totalPages(saved.entries), 0);
      assert.deepEqual(reportIssues(saved), []);
      assert.deepEqual(saved.tomorrow?.memorization, range);
      await post({
        action: "assignment",
        memorization: manual,
        review: range,
        note: "يدوي",
        imageName: "",
      });
      await post({
        action: "assessment",
        kind: "MEMORIZATION",
        assessment: "NOT_MASTERED",
      });
      assert.deepEqual((await read()).tomorrow?.memorization, manual);
      await assert.rejects(
        () =>
          post({
            action: "assessment",
            kind: "REVIEW",
            assessment: "MASTERED",
          }),
        /سجل مدى التسميع/,
      );

      // Actual independent ranges, summed from the server's Quran calculation.
      for (const kind of ["MEMORIZATION", "REVIEW"] as const) {
        for (let i = 0; i < 3; i++) {
          const requestKey = randomUUID();
          const entry = {
            action: "entry",
            kind,
            assessment: "MASTERED",
            range: { ...range, startAyah: i * 3 + 1, endAyah: i * 3 + 3 },
            requestKey,
          };
          await post(entry);
          await post(entry);
        }
      }
      saved = await read();
      assert.equal(saved.entries.length, 6);
      assert.equal(
        totalPages(saved.entries.filter((e) => e.kind === "MEMORIZATION")),
        totalPages(
          [0, 1, 2].map((i) => ({
            ...range,
            startAyah: i * 3 + 1,
            endAyah: i * 3 + 3,
          })),
        ),
      );
      assert.equal(
        totalPages(saved.entries.filter((e) => e.kind === "REVIEW")),
        totalPages(
          [0, 1, 2].map((i) => ({
            ...range,
            startAyah: i * 3 + 1,
            endAyah: i * 3 + 3,
          })),
        ),
      );
      for (const entry of saved.entries)
        assert.equal(entry.pageAmount, pageAmount(entry)!.amount);
      assert.equal(saved.outcome, "MEMORIZED");
      await post({ action: "note", note: "ملاحظة مستقلة", outcome: null });
      assert.equal((await read()).outcome, "MEMORIZED");
      await post({ action: "status", outcome: null, note: "متصفح قديم" });
      assert.equal((await read()).outcome, "MEMORIZED");
      await Promise.all([
        post({ action: "note", note: "متزامن" }),
        post({
          action: "assessment",
          kind: "MEMORIZATION",
          assessment: "NOT_MASTERED",
        }),
      ]);
      saved = await read();
      assert.equal(saved.note, "متزامن");
      assert.equal(saved.outcome, "NOT_MEMORIZED");
      assert.deepEqual(saved.tomorrow?.memorization, manual);
      assert.equal(saved.entries.length, 6);
      await ensureDay(teacher.id, halqa.id, nextDay(date));
      const next = (await getDay(teacher.id, halqa.id, nextDay(date)))
        .students[0];
      assert.deepEqual(next.today?.memorization, manual);
      assert.equal(next.entries.length, 0);
      assert.equal(next.outcome, null);
      await post({ action: "close" });
      await assert.rejects(
        () => post({ action: "note", note: "closed" }),
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
      await db.teacher.delete({ where: { id: teacher.id } });
      await db.$disconnect();
    }
  },
);
