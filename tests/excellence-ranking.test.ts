import { test } from "node:test";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { topThree } from "../src/lib/excellence-ranking";
import { recitationDayEvidence } from "../src/lib/weekly-support-policy";
import { dayDate } from "../src/lib/dates";
import { pageAmount } from "../src/lib/quran";

test("top three is independent, positive-only, deterministic for ties and does not mutate input", () => {
  const rows = [
    { enrollmentId: "d", name: "د", m: 2, r: 8 },
    { enrollmentId: "c", name: "ج", m: 3, r: 0 },
    { enrollmentId: "b", name: "ب", m: 3, r: 9 },
    { enrollmentId: "a", name: "أ", m: 3, r: 10 },
    { enrollmentId: "z", name: "صفر", m: 0, r: 0 },
  ];
  assert.deepEqual(
    topThree(rows, (r) => r.m).map((r) => r.enrollmentId),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    topThree(rows, (r) => r.r).map((r) => r.enrollmentId),
    ["a", "b", "d"],
  );
  assert.equal(rows[0].enrollmentId, "d");
  assert.equal(topThree(rows.slice(-1), (r) => r.r).length, 0);
});

test("review ranking honors corrected outcomes and excludes failed/unknown/absent amounts", () => {
  const range = { startSurah: 2, startAyah: 1, endSurah: 2, endAyah: 5 },
    p = pageAmount(range)!;
  const entry = {
    ...range,
    kind: "REVIEW",
    assessment: "MASTERED",
    pageAmount: p.amount,
    pageMappingVersion: p.version,
  };
  const status = {
    outcome: null,
    reviewOnly: true,
    memorizationResult: null,
    reviewResult: "NOT_MASTERED",
    entries: [entry],
  };
  assert.equal(recitationDayEvidence(status, "REVIEW").pages, 0);
  assert.equal(
    recitationDayEvidence(
      { ...status, entries: [{ ...entry, masteryResult: "MASTERED" }] },
      "REVIEW",
    ).pages,
    1,
  );
  assert.equal(
    recitationDayEvidence(
      {
        ...status,
        reviewResult: null,
        entries: [{ ...entry, assessment: null }],
      },
      "REVIEW",
    ).pages,
    0,
  );
  assert.equal(
    recitationDayEvidence(
      { ...status, outcome: "ABSENT", reviewResult: "MASTERED" },
      "REVIEW",
    ).pages,
    0,
  );
});

test(
  "PostgreSQL excellence: independent top three per class, transfers, corrections, hafiz and filter independence",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { db } = await import("../src/lib/db"),
      { getSupervisionReport } = await import("../src/lib/supervision-report"),
      { supervisionReportMarkup } =
        await import("../src/lib/supervision-report-pdf");
    const t = await db.teacher.create({
      data: {
        name: "ranking test",
        codeHash: "test",
        codeLookup: randomUUID(),
      },
    });
    const hs = await Promise.all(
      ["الأول أ", "السادس"].map((name) =>
        db.halqa.create({ data: { name, teacherId: t.id } }),
      ),
    );
    const pupils = await Promise.all(
      Array.from({ length: 7 }, (_, i) =>
        db.student.create({
          data: {
            name: ["أحمد", "باسم", "جمال", "داود", "حافظ", "صفر", "منتقل"][i],
          },
        }),
      ),
    );
    const es = await Promise.all(
      pupils.map((s, i) =>
        db.enrollment.create({
          data: {
            studentId: s.id,
            halqaId: hs[i === 6 ? 1 : 0].id,
            position: i,
            reviewOnly: i === 4,
            active: true,
          },
        }),
      ),
    );
    const old = await db.enrollment.create({
      data: {
        studentId: pupils[6].id,
        halqaId: hs[0].id,
        position: 8,
        active: false,
      },
    });
    const supervisor = await db.supervisor.create({
      data: { username: randomUUID(), name: "ranking", passwordHash: "test" },
    });
    const raw = { type: "excellent", from: "2026-10-19", to: "2026-10-23" };
    try {
      await db.studentTransfer.create({
        data: {
          studentId: pupils[6].id,
          sourceEnrollmentId: old.id,
          targetEnrollmentId: es[6].id,
          sourceHalqaId: hs[0].id,
          targetHalqaId: hs[1].id,
          supervisorId: supervisor.id,
          requestKey: randomUUID(),
          before: {},
          after: {},
          createdAt: new Date("2026-10-21T09:00:00Z"),
        },
      });
      const dates = ["2026-10-19", "2026-10-22"];
      for (const date of dates) {
        const ss = await Promise.all(
          hs.map((h) =>
            db.dailySession.create({
              data: { halqaId: h.id, date: dayDate(date) },
            }),
          ),
        );
        const selected = date === dates[0] ? [old] : es;
        for (const e of selected) {
          const i = pupils.findIndex((s) => s.id === e.studentId),
            h = e.halqaId === hs[0].id ? 0 : 1;
          const status = await db.dailyStudentStatus.create({
            data: {
              sessionId: ss[h].id,
              halqaId: e.halqaId,
              enrollmentId: e.id,
              reviewOnly: e.reviewOnly,
              memorizationResult: i === 4 ? null : "MASTERED",
              reviewResult: "MASTERED",
            },
          });
          // Each activity is one mapped page; zero student has only failed entries.
          for (const kind of ["MEMORIZATION", "REVIEW"] as const) {
            if (kind === "MEMORIZATION" && i === 4) continue;
            const count =
              kind === "MEMORIZATION"
                ? [4, 3, 3, 2, 0, 6, 2][i]
                : [1, 4, 3, 2, 5, 6, 1][i];
            const range = {
                startSurah: 2,
                startAyah: 1,
                endSurah: 2,
                endAyah: 5,
              },
              p = pageAmount(range)!;
            for (let j = 0; j < count; j++)
              await db.recitationEntry.create({
                data: {
                  dailyStatusId: status.id,
                  kind,
                  ...range,
                  pageAmount: p.amount,
                  pageMappingVersion: p.version,
                  assessment: i === 5 ? "MASTERED" : "NOT_MASTERED",
                  masteryResult: i === 5 ? "NOT_MASTERED" : "MASTERED",
                  requestKey: randomUUID(),
                },
              });
          }
        }
      }
      const countScope = {
        dailyStatus: {
          enrollment: { studentId: { in: pupils.map((s) => s.id) } },
        },
      };
      const count = await db.recitationEntry.count({ where: countScope }),
        report = await getSupervisionReport(raw);
      const a = report.rows.filter((r) => r.halqaId === hs[0].id),
        b = report.rows.filter((r) => r.halqaId === hs[1].id);
      const ranked = (rows: typeof a, key: "memoryRank" | "reviewRank") =>
        rows
          .filter((r) => r[key] !== null)
          .sort((x, y) => x[key]! - y[key]!)
          .map((r) => r.name);
      assert.deepEqual(ranked(a, "memoryRank"), ["أحمد", "باسم", "جمال"]);
      assert.deepEqual(ranked(a, "reviewRank"), ["حافظ", "باسم", "جمال"]);
      assert(
        !a.some(
          (r) => r.name === "صفر" || r.name === "داود" || r.name === "منتقل",
        ),
      );
      assert.equal(b.length, 1);
      assert.equal(b[0].masteredMemoryPages, 4);
      assert.equal(b[0].masteredReviewPages, 2);
      assert.equal(b[0].enrollmentId, es[6].id);
      assert.equal(b[0].memoryRank, 1);
      assert.equal(b[0].reviewRank, 1);
      assert.equal(a.find((r) => r.name === "حافظ")!.memoryRank, null);
      const altered = await getSupervisionReport({
        ...raw,
        halqaId: hs[0].id,
        mastery: 100,
        minDays: 93,
        maxAbsences: 0,
        enrollmentId: es[5].id,
      });
      assert.deepEqual(
        altered.rows.map((r) => r.enrollmentId).sort(),
        a.map((r) => r.enrollmentId).sort(),
      );
      assert.equal(
        (await getSupervisionReport({ ...raw, halqaId: hs[1].id })).rows[0]
          .masteredMemoryPages,
        4,
      );
      const scoped = {
        ...report,
        rows: [...a, ...b],
        summary: { ...report.summary, students: a.length + b.length },
        classes: report.classes.filter((c) => hs.some((h) => h.id === c.id)),
      };
      const html = supervisionReportMarkup(scoped, "");
      assert(html.includes("الأكثر حفظًا"));
      assert(html.includes("الأكثر مراجعة"));
      assert(html.includes("portrait"));
      assert(!html.includes("إتقان 90%"));
      assert.equal(
        await db.recitationEntry.count({ where: countScope }),
        count,
      );
      if (process.env.EXCELLENCE_PREVIEW) {
        const { generateHtmlPdf } = await import("../src/lib/report");
        const { writeFile } = await import("node:fs/promises");
        await writeFile(
          process.env.EXCELLENCE_PREVIEW,
          await generateHtmlPdf((font) =>
            supervisionReportMarkup(scoped, font),
          ),
        );
      }
    } finally {
      const ids = pupils.map((s) => s.id);
      await db.studentTransfer.deleteMany({
        where: { studentId: { in: ids } },
      });
      await db.recitationEntry.deleteMany({
        where: { dailyStatus: { enrollment: { studentId: { in: ids } } } },
      });
      await db.dailyStudentStatus.deleteMany({
        where: { enrollment: { studentId: { in: ids } } },
      });
      await db.dailySession.deleteMany({
        where: { halqaId: { in: hs.map((h) => h.id) } },
      });
      await db.enrollment.deleteMany({ where: { studentId: { in: ids } } });
      await db.student.deleteMany({ where: { id: { in: ids } } });
      await db.halqa.deleteMany({ where: { id: { in: hs.map((h) => h.id) } } });
      await db.teacher.delete({ where: { id: t.id } });
      await db.supervisor.delete({ where: { id: supervisor.id } });
    }
  },
);
