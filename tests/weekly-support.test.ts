import { test } from "node:test";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import {
  weeklyMinimumPages,
  weeklySupportReason,
  memoryDayEvidence,
} from "../src/lib/weekly-support-policy";
import { supervisionReportQuery } from "../src/lib/supervision-report-policy";
import { dayDate } from "../src/lib/dates";
import { pageAmount } from "../src/lib/quran";
test("school support thresholds are strict weekly 2/5 pages, independent of absence and percentage filters", () => {
  for (const name of ["الأول أ", "الأول ب", "الثاني أ", "الثاني ب"])
    assert.equal(weeklyMinimumPages(name), 2);
  for (const name of ["الثالث", "الرابع", "الخامس", "السادس"])
    assert.equal(weeklyMinimumPages(name), 5);
  assert.equal(weeklyMinimumPages("حلقة تجريبية"), null);
  assert.equal(weeklyMinimumPages("الأول التأهيلي"), null);
  assert(weeklySupportReason(1.9999, 2));
  assert.equal(weeklySupportReason(2, 2), null);
  assert(weeklySupportReason(4.9999, 5));
  assert.equal(weeklySupportReason(5, 5), null);
  assert(
    !supervisionReportQuery.safeParse({
      type: "support",
      from: "2026-10-26",
      to: "2026-10-29",
    }).success,
  );
  assert(
    supervisionReportQuery.safeParse({
      type: "support",
      from: "2026-10-19",
      to: "2026-10-23",
    }).success,
  );
});
test("support memory amount counts mastered new entries, corrections and independent attempts, never review or unknown grades", () => {
  const range = { startSurah: 2, startAyah: 1, endSurah: 2, endAyah: 5 },
    amount = pageAmount(range)!;
  const entry = {
    ...range,
    kind: "MEMORIZATION",
    assessment: "NOT_MASTERED",
    pageAmount: amount.amount,
    pageMappingVersion: amount.version,
  };
  const base = {
    outcome: "NOT_MEMORIZED",
    reviewOnly: false,
    memorizationResult: "NOT_MASTERED",
    entries: [entry],
  };
  assert.equal(memoryDayEvidence(base).pages, 0);
  assert.equal(memoryDayEvidence(base).known, true);
  assert.equal(
    memoryDayEvidence({ ...base, memorizationResult: "MASTERED" }).pages,
    1,
  );
  assert.equal(
    memoryDayEvidence({
      ...base,
      entries: [{ ...entry, masteryResult: "MASTERED" }, entry],
    }).pages,
    1,
  );
  assert.equal(
    memoryDayEvidence({
      ...base,
      entries: [{ ...entry, kind: "REVIEW", assessment: "MASTERED" }],
    }).known,
    false,
  );
  assert.equal(
    memoryDayEvidence({
      ...base,
      entries: [{ ...entry, assessment: null }],
      memorizationResult: null,
    }).known,
    false,
  );
  assert.deepEqual(
    memoryDayEvidence({ ...base, outcome: "ABSENT", entries: [] }),
    { known: true, pages: 0 },
  );
});
test(
  "PostgreSQL support: weekly mastered quantity, boundaries, missing data, hafiz, old alerts and transfers remain distinct",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { db } = await import("../src/lib/db"),
      { getSupervisionReport } = await import("../src/lib/supervision-report"),
      { getSupervisorOverview } = await import("../src/lib/supervisor-service");
    const teacher = await db.teacher.create({
      data: {
        name: "support test",
        codeHash: "test",
        codeLookup: randomUUID(),
      },
    });
    const hs = await Promise.all(
      ["الأول أ — اختبار المقدار", "الثالث — اختبار المقدار"].map((name) =>
        db.halqa.create({ data: { name, teacherId: teacher.id } }),
      ),
    );
    const pupils = await Promise.all(
      Array.from({ length: 9 }, (_, i) =>
        db.student.create({ data: { name: `طالب المقدار ${i}` } }),
      ),
    );
    const es = await Promise.all(
      pupils.map((s, i) =>
        db.enrollment.create({
          data: {
            studentId: s.id,
            halqaId: hs[[0, 1, 5, 8].includes(i) ? 0 : 1].id,
            reviewOnly: i === 4,
            position: i,
            active: i !== 8,
          },
        }),
      ),
    );
    const target = await db.enrollment.create({
      data: { studentId: pupils[8].id, halqaId: hs[1].id, position: 9 },
    });
    const supervisor = await db.supervisor.create({
      data: {
        name: "support test",
        username: randomUUID(),
        passwordHash: "test",
      },
    });
    const dates = [
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
    ];
    const range = (endAyah: number) => ({
      startSurah: 2,
      startAyah: 1,
      endSurah: 2,
      endAyah,
    });
    assert.equal(pageAmount(range(5))!.amount, 1);
    assert.equal(pageAmount(range(16))!.amount, 2);
    assert.equal(pageAmount(range(37))!.amount, 5);
    try {
      await db.studentTransfer.create({
        data: {
          studentId: pupils[8].id,
          sourceEnrollmentId: es[8].id,
          targetEnrollmentId: target.id,
          sourceHalqaId: hs[0].id,
          targetHalqaId: hs[1].id,
          supervisorId: supervisor.id,
          requestKey: randomUUID(),
          before: {},
          after: {},
          createdAt: new Date("2026-10-21T09:00:00Z"),
        },
      });
      for (const [day, date] of dates.entries()) {
        const sessions = await Promise.all(
          hs.map((h) =>
            db.dailySession.create({
              data: { halqaId: h.id, date: dayDate(date) },
            }),
          ),
        );
        for (const [i, e] of es.entries()) {
          if (i === 5 && day > 0) continue;
          const actual = i === 8 && day >= 2 ? target : e,
            h = actual.halqaId === hs[0].id ? 0 : 1,
            absent = i === 6;
          const mastered = day === 0 || (i === 8 && day === 3);
          const status = await db.dailyStudentStatus.create({
            data: {
              sessionId: sessions[h].id,
              halqaId: hs[h].id,
              enrollmentId: actual.id,
              reviewOnly: i === 4,
              outcome: absent ? "ABSENT" : null,
              memorizationResult:
                absent || i === 4
                  ? null
                  : mastered
                    ? "MASTERED"
                    : "NOT_MASTERED",
              reviewResult: i === 4 ? "MASTERED" : null,
            },
          });
          if (absent) continue;
          const r = range(
              day === 0
                ? i === 1 || i === 2
                  ? 16
                  : i === 3 || i === 7
                    ? 37
                    : 5
                : 5,
            ),
            pages = pageAmount(r)!;
          await db.recitationEntry.create({
            data: {
              dailyStatusId: status.id,
              kind: i === 4 ? "REVIEW" : "MEMORIZATION",
              assessment:
                i === 7 && day === 0
                  ? "NOT_MASTERED"
                  : mastered || i === 4
                    ? "MASTERED"
                    : "NOT_MASTERED",
              masteryResult: i === 7 && day === 0 ? "MASTERED" : null,
              ...r,
              pageAmount: pages.amount,
              pageMappingVersion: pages.version,
              requestKey: randomUUID(),
            },
          });
        }
      }
      const raw = { type: "support", from: dates[0], to: dates[4] };
      const report = await getSupervisionReport(raw),
        own = report.rows.filter((r) => pupils.some((s) => s.name === r.name));
      assert.deepEqual(
        own.map((r) => r.enrollmentId).sort(),
        [es[0].id, es[2].id, es[6].id, target.id].sort(),
      );
      assert.equal(
        own.find((r) => r.enrollmentId === es[0].id)!.masteredMemoryPages,
        1,
      );
      assert.equal(
        own.find((r) => r.enrollmentId === es[0].id)!.weeklyMinimumPages,
        2,
      );
      assert.equal(
        own.find((r) => r.enrollmentId === es[2].id)!.weeklyMinimumPages,
        5,
      );
      assert.equal(
        own.find((r) => r.enrollmentId === target.id)!.masteredMemoryPages,
        2,
      );
      assert.equal(
        own.find((r) => r.enrollmentId === target.id)!.memoryEvidenceDates
          .length,
        5,
      );
      assert.equal(
        (await getSupervisionReport({ ...raw, halqaId: hs[0].id })).rows.length,
        1,
      );
      assert.equal(
        (await getSupervisionReport({ ...raw, halqaId: hs[1].id })).rows.length,
        3,
      );
      assert(report.supportUnassessedCount >= 1);
      const overridden = await getSupervisionReport({
        ...raw,
        mastery: 0,
        minDays: 1,
        absenceMin: 1,
      });
      assert.deepEqual(
        overridden.rows
          .filter((r) => pupils.some((s) => s.name === r.name))
          .map((r) => r.enrollmentId)
          .sort(),
        own.map((r) => r.enrollmentId).sort(),
      );
      const overview = await getSupervisorOverview(
        dates[4],
        new Date("2026-10-23T12:00:00Z"),
      );
      assert(
        overview.alerts.some(
          (a) => a.enrollmentId === es[1].id && a.kind === "memory",
        ),
      );
      assert(
        overview.alerts.some(
          (a) => a.enrollmentId === es[6].id && a.kind === "absence",
        ),
      );
      const { supervisionReportMarkup } =
        await import("../src/lib/supervision-report-pdf");
      const html = supervisionReportMarkup(report, "");
      assert(html.includes("الحفظ المتقن"));
      assert(html.includes("الحد الأسبوعي"));
      assert(!html.includes("إتقان أقل من 70%"));
      if (process.env.SUPPORT_POLICY_PREVIEW) {
        const { generateHtmlPdf } = await import("../src/lib/report");
        const { writeFile } = await import("node:fs/promises");
        const pdf = await generateHtmlPdf((font) =>
          supervisionReportMarkup(
            {
              ...report,
              rows: own,
              classes: report.classes.filter((c) =>
                hs.some((h) => h.id === c.id),
              ),
            },
            font,
          ),
        );
        await writeFile(process.env.SUPPORT_POLICY_PREVIEW, pdf);
      }
    } finally {
      await db.studentTransfer.deleteMany({
        where: { studentId: { in: pupils.map((s) => s.id) } },
      });
      await db.recitationEntry.deleteMany({
        where: {
          dailyStatus: {
            enrollment: { studentId: { in: pupils.map((s) => s.id) } },
          },
        },
      });
      await db.dailyStudentStatus.deleteMany({
        where: { enrollment: { studentId: { in: pupils.map((s) => s.id) } } },
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
      await db.supervisor.delete({ where: { id: supervisor.id } });
    }
  },
);
