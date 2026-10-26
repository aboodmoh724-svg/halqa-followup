import { strict as assert } from "node:assert";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { dayDate, dayKey, nextDay } from "../src/lib/dates";
import {
  independentSummary,
  reportIssues,
  type StudentView,
  type DayView,
} from "../src/lib/types";
import { reportMarkup } from "../src/lib/report";

const range = { startSurah: 67, startAyah: 1, endSurah: 67, endAyah: 10 };
const student: StudentView = {
  enrollmentId: "e",
  name: "طالب حافظ",
  reviewOnly: true,
  outcome: "MEMORIZED",
  memorizationResult: null,
  reviewResult: "MASTERED",
  today: null,
  tomorrow: {
    id: "a",
    memorization: null,
    review: range,
    note: "",
    imageName: "",
  },
  note: "",
  entries: [
    {
      ...range,
      id: "r",
      kind: "REVIEW",
      createdAt: "2026-10-26T09:00:00Z",
      pageAmount: null,
      pageMappingVersion: null,
    },
  ],
};
const day: DayView = {
  halqaId: "h",
  halqaName: "حلقة",
  teacherName: "معلم",
  date: "2026-10-26",
  timezone: "Europe/Istanbul",
  closedAt: null,
  students: [student],
};

test("review-only completion depends on review, without introducing an activity outcome", () => {
  assert.equal(independentSummary(null, "MASTERED", true), "MEMORIZED");
  assert.equal(independentSummary(null, "NOT_MASTERED", true), "NOT_MEMORIZED");
  assert.equal(independentSummary("MASTERED", null, true), null);
  assert.equal(independentSummary(null, "MASTERED"), null);
  assert.deepEqual(reportIssues(student), []);
  assert.deepEqual(
    reportIssues({
      ...student,
      entries: [],
      reviewResult: "NOT_MASTERED",
      outcome: "NOT_MEMORIZED",
    }),
    [],
  );
  assert.deepEqual(
    reportIssues({
      ...student,
      tomorrow: { ...student.tomorrow!, memorization: range, review: null },
    }),
    ["واجب الغد"],
  );
  assert.ok(
    reportIssues({ ...student, reviewOnly: false }).includes(
      "نتيجة الحفظ الجديد",
    ),
  );
});

test("review-only PDFs do not show new memorization, its result or homework", () => {
  const individual = reportMarkup(day, [student], "");
  assert.match(individual, /مراجعة فقط/);
  assert.doesNotMatch(individual, /الحفظ الجديد|الحفظ:<|غير حافظ/);
  assert.equal((individual.match(/data-label="حافظ"/g) ?? []).length, 2);
  const collective = reportMarkup(day, [student], "", true);
  const row = collective.match(/<tbody>([\s\S]*?)<\/tbody>/)![1];
  assert.match(row, /مراجعة فقط/);
  assert.doesNotMatch(row, /غير حافظ|<b>حفظ:<\/b>/);
});

test(
  "PostgreSQL: review-only track, repeated review, homework, absence, ownership and historical snapshot",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { db } = await import("../src/lib/db");
    const { ensureDay, getDay, mutateDay } =
      await import("../src/lib/day-service");
    const teacher = await db.teacher.create({
      data: { name: "test", codeLookup: randomUUID(), codeHash: "test" },
    });
    const other = await db.teacher.create({
      data: { name: "other", codeLookup: randomUUID(), codeHash: "test" },
    });
    const halqa = await db.halqa.create({
      data: { name: "test", teacherId: teacher.id },
    });
    const pupil = await db.student.create({ data: { name: "طالب اختبار" } });
    const enrollment = await db.enrollment.create({
      data: { studentId: pupil.id, halqaId: halqa.id, reviewOnly: true },
    });
    const date = dayKey();
    const now = new Date(`${date}T09:00:00Z`);
    const post = (m: Record<string, unknown>) =>
      mutateDay(
        teacher.id,
        halqa.id,
        { ...m, date, enrollmentId: enrollment.id },
        now,
      );
    const read = async (key = date) =>
      (await getDay(teacher.id, halqa.id, key)).students[0];
    try {
      const original = await db.assignment.create({
        data: {
          enrollmentId: enrollment.id,
          dueDate: dayDate(date),
          memorization: range,
          review: range,
        },
      });
      await ensureDay(teacher.id, halqa.id, date);
      assert.equal((await read()).reviewOnly, true);
      assert.equal((await read()).today?.memorization, null);
      assert.deepEqual((await read()).today?.review, range);
      // Teacher input cannot change a school-assigned study track.
      await assert.rejects(() => post({ action: "track", reviewOnly: false }), {
        name: "ZodError",
      });
      await post({ action: "note", note: "ملاحظة", reviewOnly: false });
      assert.equal((await read()).reviewOnly, true);
      assert.equal(
        (
          await db.enrollment.findUniqueOrThrow({
            where: { id: enrollment.id },
          })
        ).reviewOnly,
        true,
      );
      assert.deepEqual(
        (await db.assignment.findUniqueOrThrow({ where: { id: original.id } }))
          .memorization,
        range,
      );
      await assert.rejects(
        () =>
          mutateDay(
            other.id,
            halqa.id,
            {
              action: "assessment",
              kind: "REVIEW",
              assessment: "NOT_MASTERED",
              date,
              enrollmentId: enrollment.id,
              reviewOnly: false,
            },
            now,
          ),
        /الحلقة غير موجودة/,
      );
      await post({ action: "status", outcome: "ABSENT", note: "" });
      let saved = await read();
      assert.equal(saved.tomorrow?.memorization, null);
      assert.deepEqual(saved.tomorrow?.review, range);
      await post({ action: "status", outcome: null, note: "" });
      for (const action of ["entry", "assessment"])
        await assert.rejects(
          () =>
            post({
              action,
              kind: "MEMORIZATION",
              assessment: "MASTERED",
              range,
              requestKey: randomUUID(),
            }),
          /مراجعة فقط/,
        );
      await assert.rejects(
        () =>
          post({
            action: "assignment",
            memorization: range,
            review: range,
            note: "",
            imageName: "",
          }),
        /مراجعة فقط/,
      );
      await assert.rejects(
        () =>
          post({
            action: "assignment",
            memorization: null,
            review: null,
            note: "",
            imageName: "",
          }),
        /حدد مدى المراجعة/,
      );
      await post({
        action: "assessment",
        kind: "REVIEW",
        assessment: "NOT_MASTERED",
      });
      saved = await read();
      assert.equal(saved.outcome, "NOT_MEMORIZED");
      assert.equal(saved.entries.length, 0);
      assert.deepEqual(reportIssues(saved), []);
      await assert.rejects(() => post({ action: "track", reviewOnly: false }), {
        name: "ZodError",
      });
      for (let i = 0; i < 2; i++) {
        const entry = {
          action: "entry",
          kind: "REVIEW",
          assessment: "MASTERED",
          range: { ...range, startAyah: i * 5 + 1, endAyah: i * 5 + 5 },
          requestKey: randomUUID(),
        };
        await post(entry);
        await post(entry);
      }
      saved = await read();
      assert.equal(saved.entries.length, 2);
      assert.equal(saved.memorizationResult, null);
      assert.equal(saved.outcome, "MEMORIZED");
      assert.equal(saved.suggestions?.memorization, null);
      assert.deepEqual(reportIssues(saved), []);
      await post({
        action: "assignment",
        memorization: null,
        review: range,
        note: "مراجعة الغد",
        imageName: "",
      });
      await ensureDay(teacher.id, halqa.id, nextDay(date));
      const tomorrow = await read(nextDay(date));
      assert.equal(tomorrow.reviewOnly, true);
      assert.deepEqual(tomorrow.today?.review, range);
      assert.equal(tomorrow.today?.memorization, null);
      assert.equal(tomorrow.entries.length, 0);
      await post({ action: "close" });
      await db.enrollment.update({
        where: { id: enrollment.id },
        data: { reviewOnly: false },
      });
      assert.equal((await read()).reviewOnly, true);
      await ensureDay(teacher.id, halqa.id, nextDay(nextDay(date)));
      assert.equal((await read(nextDay(nextDay(date)))).reviewOnly, false);
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
      await db.student.delete({ where: { id: pupil.id } });
      await db.halqa.delete({ where: { id: halqa.id } });
      await db.teacher.deleteMany({
        where: { id: { in: [teacher.id, other.id] } },
      });
      await db.$disconnect();
    }
  },
);
