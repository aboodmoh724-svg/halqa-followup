import { strict as assert } from "node:assert";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  supervisionReportQuery,
  reportReasons,
  reportPeriod,
} from "../src/lib/supervision-report-policy";
import { getSupervisionReport } from "../src/lib/supervision-report";
import { supervisionReportMarkup } from "../src/lib/supervision-report-pdf";
import { pageAmount } from "../src/lib/quran";
import { dayDate, dayKey } from "../src/lib/dates";
const query = (type = "support") =>
  supervisionReportQuery.parse({ type, from: "2026-10-19", to: "2026-10-23" });
test("report periods respect calendar boundaries and query limits", () => {
  assert.deepEqual(reportPeriod("previous-month", "2026-03-05"), {
    from: "2026-02-01",
    to: "2026-02-28",
  });
  assert.deepEqual(reportPeriod("previous-month", "2028-03-05"), {
    from: "2028-02-01",
    to: "2028-02-29",
  });
  assert.deepEqual(reportPeriod("previous-week", "2026-01-01"), {
    from: "2025-12-22",
    to: "2025-12-26",
  });
  for (const q of [
    { from: "2026-02-30", to: "2026-03-01" },
    { from: "2026-10-10", to: "2026-10-01" },
    { from: "2026-01-01", to: "2026-10-01" },
    { ...query(), mastery: 101 },
    { ...query(), minDays: 0 },
    { ...query(), type: "student", enrollmentId: undefined },
  ])
    assert(!supervisionReportQuery.safeParse(q).success);
});
test("specialized criteria require evidence and do not treat missing records as weakness", () => {
  assert.equal(
    reportReasons(
      { assessedDays: 0, masteredDays: 0, absentDays: 0, pendingDays: 5 },
      query(),
    ).length,
    0,
  );
  assert.equal(
    reportReasons(
      { assessedDays: 2, masteredDays: 0, absentDays: 0, pendingDays: 0 },
      query(),
    ).length,
    0,
  );
  assert.equal(
    reportReasons(
      { assessedDays: 3, masteredDays: 0, absentDays: 0, pendingDays: 0 },
      query(),
    ).length,
    0,
  );
  assert.equal(
    reportReasons(
      { assessedDays: 0, masteredDays: 0, absentDays: 3, pendingDays: 0 },
      query(),
    ).length,
    0,
  );
  assert.equal(
    reportReasons(
      { assessedDays: 3, masteredDays: 3, absentDays: 0, pendingDays: 1 },
      query("excellent"),
    ).length,
    0,
  );
  assert.equal(
    reportReasons(
      { assessedDays: 3, masteredDays: 3, absentDays: 0, pendingDays: 0 },
      query("excellent"),
    ).length,
    1,
  );
});
test(
  "PostgreSQL reports: honest assessment, review-only excellence, absence, scope, escaping and read-only behavior",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { db } = await import("../src/lib/db");
    const t = await db.teacher.create({
      data: { name: "report test", codeLookup: randomUUID(), codeHash: "test" },
    });
    const h = await db.halqa.create({
      data: { name: "حلقة اختبار التقارير", teacherId: t.id },
    });
    const students = await Promise.all(
      [0, 1, 2, 3].map((i) =>
        db.student.create({ data: { name: `طالب اختبار ${i}` } }),
      ),
    );
    const enrollments = await Promise.all(
      students.map((s, i) =>
        db.enrollment.create({
          data: {
            studentId: s.id,
            halqaId: h.id,
            position: i,
            reviewOnly: i === 1,
          },
        }),
      ),
    );
    const to = dayKey(),
      fromDate = dayDate(to);
    fromDate.setUTCDate(fromDate.getUTCDate() - 2);
    const from = fromDate.toISOString().slice(0, 10),
      raw = { from, to, halqaId: h.id };
    try {
      for (let i = 0; i < 3; i++) {
        const date = dayDate(to);
        date.setUTCDate(date.getUTCDate() - i);
        const session = await db.dailySession.create({
          data: { halqaId: h.id, date },
        });
        for (const [index, e] of enrollments.entries())
          await db.dailyStudentStatus.create({
            data: {
              sessionId: session.id,
              enrollmentId: e.id,
              halqaId: h.id,
              reviewOnly: index === 1,
              outcome:
                index === 2
                  ? "ABSENT"
                  : index === 3
                    ? null
                    : index === 1
                      ? "MEMORIZED"
                      : "NOT_MEMORIZED",
              memorizationResult: index === 0 ? "MASTERED" : null,
              reviewResult:
                index === 0 ? "NOT_MASTERED" : index === 1 ? "MASTERED" : null,
              note: index === 0 ? '<script>alert("test")</script>' : "",
            },
          });
      }
      const status = await db.dailyStudentStatus.findFirstOrThrow({
        where: { enrollmentId: enrollments[0].id },
      });
      const range = { startSurah: 67, startAyah: 1, endSurah: 67, endAyah: 5 };
      for (let i = 0; i < 2; i++)
        await db.recitationEntry.create({
          data: {
            dailyStatusId: status.id,
            kind: "MEMORIZATION",
            assessment: "NOT_MASTERED",
            ...range,
            requestKey: randomUUID(),
          },
        });
      await db.enrollment.update({
        where: { id: enrollments[0].id },
        data: { active: false },
      });
      const before = await db.dailyStudentStatus.count({
        where: { halqaId: h.id },
      });
      const all = await getSupervisionReport(raw);
      const fixtureRows = all.rows.filter((r) => r.halqaId === h.id);
      assert.equal(fixtureRows.length, 4);
      const scopedAll = { ...all, rows: fixtureRows };
      assert.equal(fixtureRows[0].masteryRate, 0);
      assert.equal(fixtureRows[0].active, false);
      assert(
        Math.abs(fixtureRows[0].memoryPages - 2 * pageAmount(range)!.amount) <
          0.001,
      );
      assert.equal(fixtureRows[0].memoryMasteredDays, 3);
      assert.equal(fixtureRows[0].reviewMasteredDays, 0);
      await assert.rejects(() =>
        getSupervisionReport({ ...raw, type: "support" }),
      );
      const excellent = await getSupervisionReport({
        ...raw,
        type: "excellent",
      });
      assert.deepEqual(
        excellent.rows.map((x) => x.enrollmentId),
        [enrollments[1].id],
      );
      assert.equal(excellent.rows[0].masteryRate, 100);
      const support = await getSupervisionReport({
        ...raw,
        type: "support",
        from: "2026-10-19",
        to: "2026-10-23",
      });
      assert.equal(support.rows.length, 0);
      const absence = await getSupervisionReport({ ...raw, type: "absence" });
      assert.equal(absence.rows.length, 1);
      assert.equal(absence.rows[0].absentDates.length, 3);
      const one = await getSupervisionReport({
        ...raw,
        type: "student",
        enrollmentId: enrollments[0].id,
      });
      assert.equal(one.rows[0].days.length, 3);
      await assert.rejects(
        () =>
          getSupervisionReport({
            ...raw,
            type: "student",
            enrollmentId: "not-in-class",
          }),
        /الطالب غير موجود/,
      );
      await assert.rejects(
        () =>
          getSupervisionReport({
            ...raw,
            type: "absence",
            halqaId: "not-a-class",
          }),
        /الحلقة غير موجودة/,
      );
      const html = supervisionReportMarkup(scopedAll, "");
      assert(!html.includes('<script>alert("test")</script>'));
      assert(html.includes("&lt;script&gt;"));
      assert(html.includes("لا تقيس نسبة حفظ المصحف"));
      assert.equal(
        await db.dailyStudentStatus.count({ where: { halqaId: h.id } }),
        before,
      );
    } finally {
      await db.recitationEntry.deleteMany({
        where: { dailyStatus: { halqaId: h.id } },
      });
      await db.dailyStudentStatus.deleteMany({ where: { halqaId: h.id } });
      await db.dailySession.deleteMany({ where: { halqaId: h.id } });
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
