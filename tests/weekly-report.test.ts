import { test } from "node:test";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import {
  englishDigits,
  reportNumber,
  reportPercent,
} from "../src/lib/report-format";
import { dayDate, nextAssignmentDay } from "../src/lib/dates";
import { reportPeriod } from "../src/lib/supervision-report-policy";
test("report numerals use English digits, exact quarter pages, honest zero denominator and complete Monday-Friday weeks", () => {
  assert.equal(englishDigits("٢٠٢٦ / ۱۲۳"), "2026 / 123");
  assert.equal(reportNumber(1.25), "1.25");
  assert.equal(reportPercent(0, 0), "—");
  assert.equal(reportPercent(9, 10), "90%");
  assert.deepEqual(reportPeriod("previous-week", "2026-10-29"), {
    from: "2026-10-19",
    to: "2026-10-23",
  });
  assert.deepEqual(reportPeriod("week", "2026-10-29"), {
    from: "2026-10-26",
    to: "2026-10-29",
  });
  assert.deepEqual(reportPeriod("week", "2026-10-31"), {
    from: "2026-10-26",
    to: "2026-10-30",
  });
});
test(
  "weekly report: all classes, full roster, distinct completeness/attendance/results, absent without duty, hafiz and all notes",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    assert(
      ["127.0.0.1", "localhost"].includes(url.hostname) &&
        url.pathname.includes("test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { db } = await import("../src/lib/db"),
      { getSupervisionReport } = await import("../src/lib/supervision-report"),
      { supervisionReportMarkup } =
        await import("../src/lib/supervision-report-pdf");
    const teacher = await db.teacher.create({
      data: { name: "weekly test", codeHash: "test", codeLookup: randomUUID() },
    });
    const hs = await Promise.all(
      [0, 1].map((i) =>
        db.halqa.create({
          data: { name: `حلقة أسبوعية ${i}`, teacherId: teacher.id },
        }),
      ),
    );
    const pupils = await Promise.all(
      [0, 1, 2, 3, 4].map((i) =>
        db.student.create({ data: { name: `طالب أسبوعي ${i}` } }),
      ),
    );
    const es = await Promise.all(
      pupils.map((s, i) =>
        db.enrollment.create({
          data: {
            studentId: s.id,
            halqaId: hs[i < 3 ? 0 : 1].id,
            reviewOnly: i === 1,
            position: i,
          },
        }),
      ),
    );
    const dates = [
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
    ];
    const range = { startSurah: 67, startAyah: 1, endSurah: 67, endAyah: 5 };
    try {
      for (const [i, date] of dates.entries()) {
        const days = await Promise.all(
          hs.map((h) =>
            db.dailySession.create({
              data: { halqaId: h.id, date: dayDate(date) },
            }),
          ),
        );
        for (const index of [0, 1, 2, 4]) {
          if ((index === 2 && i > 2) || (index === 4 && i > 2)) continue;
          const absent = index === 2 && i < 2,
            noteOnly = index === 2 && i === 2;
          const status = await db.dailyStudentStatus.create({
            data: {
              sessionId: days[index < 3 ? 0 : 1].id,
              halqaId: hs[index < 3 ? 0 : 1].id,
              enrollmentId: es[index].id,
              reviewOnly: index === 1,
              outcome: absent
                ? "ABSENT"
                : noteOnly || index === 4
                  ? null
                  : i === 0 && index === 0
                    ? "NOT_MEMORIZED"
                    : "MEMORIZED",
              memorizationResult:
                absent || noteOnly || index === 1 ? null : "MASTERED",
              reviewResult:
                absent || noteOnly || index === 4
                  ? null
                  : i === 0 && index === 0
                    ? "NOT_MASTERED"
                    : "MASTERED",
              note: noteOnly
                ? "ملاحظة إدارية دون تأكيد حضور"
                : index === 0
                  ? `ملاحظة ${i} <script>bad()</script>`
                  : "",
            },
          });
          if (!absent && !noteOnly) {
            for (const kind of index === 1
              ? ["REVIEW"]
              : index === 4
                ? ["MEMORIZATION"]
                : ["MEMORIZATION", "REVIEW"])
              await db.recitationEntry.create({
                data: {
                  dailyStatusId: status.id,
                  kind: kind as "MEMORIZATION" | "REVIEW",
                  assessment:
                    kind === "REVIEW" && index === 0 && i === 0
                      ? "NOT_MASTERED"
                      : "MASTERED",
                  ...range,
                  requestKey: randomUUID(),
                },
              });
          }
          if (index < 2)
            await db.assignment.create({
              data: {
                enrollmentId: es[index].id,
                dueDate: dayDate(nextAssignmentDay(date)),
                review: range,
              },
            });
        }
      }
      const before = await db.dailyStudentStatus.count({
        where: { halqaId: { in: hs.map((h) => h.id) } },
      });
      const result = await getSupervisionReport({
        type: "comprehensive",
        from: dates[0],
        to: dates[4],
        halqaId: hs[0].id,
        enrollmentId: es[0].id,
      });
      assert.equal(result.query.halqaId, undefined);
      assert.equal(result.query.enrollmentId, undefined);
      const rows = result.rows.filter((r) =>
        pupils.some((s) => s.name === r.name),
      );
      assert.equal(rows.length, 5);
      assert.equal(
        rows.reduce((n, r) => n + r.expectedStudyDays, 0),
        25,
      );
      assert.equal(
        rows.reduce((n, r) => n + r.recordedStudyDays, 0),
        16,
      );
      assert.equal(
        rows.reduce((n, r) => n + r.completedStudyDays, 0),
        12,
      );
      assert.equal(
        rows.reduce((n, r) => n + r.missingStudyDays, 0),
        9,
      );
      assert.equal(
        rows.reduce((n, r) => n + r.presentDays, 0),
        13,
      );
      assert.equal(
        rows.reduce((n, r) => n + r.absentDays, 0),
        2,
      );
      const first = rows.find((r) => r.enrollmentId === es[0].id)!;
      assert.equal(first.weeklyNotes.length, 5);
      assert.equal(first.reviewMasteredDays, 4);
      assert.equal(
        rows.find((r) => r.enrollmentId === es[1].id)!.memoryAssessedDays,
        0,
      );
      const c = result.classes.find((c) => c.id === hs[0].id)!;
      assert.equal(c.expectedStudyDays, 15);
      assert.equal(c.completedStudyDays, 12);
      assert.equal(c.memoryMasteredDays, 5);
      assert.equal(c.reviewMasteredDays, 9);
      const html = supervisionReportMarkup(result, "");
      assert(html.includes("A4 landscape"));
      assert(html.includes(hs[0].name) && html.includes(hs[1].name));
      assert(html.includes(pupils[3].name));
      assert(html.includes("ملاحظات الفترة المفصلة"));
      assert(!html.includes("<script>bad()"));
      assert(!/[٠-٩۰-۹]/.test(html));
      assert(!/NaN|Infinity/.test(html));
      for (const type of ["support", "excellent", "absence", "student"]) {
        const report = await getSupervisionReport({
          type,
          from: dates[0],
          to: dates[4],
          halqaId: hs[0].id,
          enrollmentId: type === "student" ? es[0].id : undefined,
        });
        assert(supervisionReportMarkup(report, "").includes("A4 portrait"));
      }
      assert.equal(
        await db.dailyStudentStatus.count({
          where: { halqaId: { in: hs.map((h) => h.id) } },
        }),
        before,
      );
    } finally {
      await db.assignment.deleteMany({
        where: { enrollmentId: { in: es.map((e) => e.id) } },
      });
      await db.recitationEntry.deleteMany({
        where: { dailyStatus: { enrollmentId: { in: es.map((e) => e.id) } } },
      });
      await db.dailyStudentStatus.deleteMany({
        where: { enrollmentId: { in: es.map((e) => e.id) } },
      });
      await db.dailySession.deleteMany({
        where: { halqaId: { in: hs.map((h) => h.id) } },
      });
      await db.enrollment.deleteMany({
        where: { studentId: { in: pupils.map((s) => s.id) } },
      });
      await db.student.deleteMany({
        where: { id: { in: pupils.map((s) => s.id) } },
      });
      await db.halqa.deleteMany({ where: { id: { in: hs.map((h) => h.id) } } });
      await db.teacher.delete({ where: { id: teacher.id } });
    }
  },
);
