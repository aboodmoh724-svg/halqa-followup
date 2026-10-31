import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  completionProof,
  juzs,
  progressionProblem,
  type CoverageEntry,
} from "../src/lib/completion";
import { scoreExam, retryStudyDate } from "../src/lib/exam-policy";
import type { QuranRange } from "../src/lib/quran";
const range = (s: number, a: number, b: number): QuranRange => ({
  startSurah: s,
  startAyah: a,
  endSurah: s,
  endAyah: b,
});
const entry = (
  id: string,
  r: QuranRange,
  kind: "MEMORIZATION" | "REVIEW" = "MEMORIZATION",
  mastered = true,
): CoverageEntry => ({
  id,
  range: r,
  kind,
  mastered,
  date: `2026-10-${id.padStart(2, "0")}`,
  createdAt: id,
});
test("verified juz partition covers all 6236 verses once, including shared chapter boundaries", () => {
  assert.equal(juzs.length, 30);
  assert.equal(juzs[0].start, 0);
  assert.equal(juzs[29].end, 6235);
  assert.equal(
    juzs.reduce((n, j) => n + j.total, 0),
    6236,
  );
  for (let i = 1; i < 30; i++) assert.equal(juzs[i].start, juzs[i - 1].end + 1);
  assert.deepEqual(juzs[29].range, {
    startSurah: 78,
    startAyah: 1,
    endSurah: 114,
    endAyah: 6,
  });
  assert.deepEqual(juzs[28].range, {
    startSurah: 67,
    startAyah: 1,
    endSurah: 77,
    endAyah: 50,
  });
  assert.deepEqual(juzs[26].range, {
    startSurah: 51,
    startAyah: 31,
    endSurah: 57,
    endAyah: 29,
  });
});
test("completion unions mastered new verses; repeats, review and non-mastered attempts never fabricate completion", () => {
  const records = [
    entry("1", range(112, 1, 2)),
    entry("2", range(112, 1, 2)),
    entry("3", range(112, 3, 4), "REVIEW"),
    entry("4", range(112, 3, 4), "MEMORIZATION", false),
  ];
  const p = completionProof([], records);
  assert.equal(p.chapters[111].covered, 2);
  assert(!p.chapters[111].complete);
  assert(!completionProof([juzs[29].range], []).parts[29].eligible);
  assert(completionProof([juzs[29].range], []).parts[29].complete);
});
test("a split surah must be heard in one complete mastered attempt after memorization completes", () => {
  const records = [
    entry("1", range(112, 1, 4), "REVIEW"),
    entry("2", range(112, 1, 2)),
    entry("3", range(112, 3, 4)),
  ];
  let p = completionProof([], records);
  assert(p.chapters[111].complete);
  assert(!p.chapters[111].fullRecited);
  assert.match(
    progressionProblem([], records, range(113, 1, 1), new Set())!,
    /كاملة/,
  );
  p = completionProof([], [...records, entry("4", range(112, 1, 4), "REVIEW")]);
  assert(p.chapters[111].fullRecited);
  assert.equal(
    progressionProblem(
      [],
      [...records, entry("4", range(112, 1, 4), "REVIEW")],
      range(113, 1, 1),
      new Set(),
    ),
    null,
  );
  assert(
    completionProof([], [entry("1", range(112, 1, 4))]).chapters[111]
      .fullRecited,
  );
});
test("juz gate requires an approved test while review/repeated verses remain usable; reverse shared surah is not split incorrectly", () => {
  const baseline = [{ ...juzs[29].range, endAyah: 5 }];
  const records = [
    entry("1", range(114, 6, 6)),
    entry("2", range(114, 1, 6), "REVIEW"),
  ];
  assert.match(
    progressionProblem(baseline, records, range(67, 1, 3), new Set())!,
    /الاختبار/,
  );
  assert.equal(
    progressionProblem(baseline, records, range(67, 1, 3), new Set([30])),
    null,
  );
  assert.equal(
    progressionProblem(baseline, records, range(114, 1, 6), new Set()),
    null,
  );
  const earlier = [{ startSurah: 52, startAyah: 1, endSurah: 57, endAyah: 29 }];
  assert.equal(
    progressionProblem(
      earlier,
      [entry("1", range(52, 1, 49))],
      range(51, 1, 60),
      new Set(),
    ),
    null,
  );
  assert.match(
    progressionProblem([], [], { ...juzs[0].range, endAyah: 142 }, new Set())!,
    /الاختبار/,
  );
});
test("exam deductions use exact half-points and school grade thresholds", () => {
  const q = [
    { prompting: 0, warning: 0, tajweed: 0 },
    { prompting: 0, warning: 0, tajweed: 0 },
    { prompting: 0, warning: 0, tajweed: 0 },
  ];
  for (const [warnings, rating] of [
    [0, "ممتاز"],
    [10, "ممتاز"],
    [15, "جيد جدًا"],
    [20, "جيد"],
    [25, "ناجح · ضعيف"],
    [26, "غير ناجح"],
  ] as const) {
    const r = scoreExam([{ ...q[0], warning: warnings }, q[1], q[2]]);
    assert.equal(r.rating, rating);
    assert.equal(r.passed, warnings <= 25);
  }
  assert.equal(
    scoreExam([{ prompting: 12, warning: 1, tajweed: 1 }, q[1], q[2]]).score,
    74.5,
  );
  assert.equal(
    scoreExam(q.map(() => ({ prompting: 100, warning: 100, tajweed: 100 })))
      .score,
    0,
  );
  assert.throws(() => scoreExam(q.slice(0, 2)));
  assert.throws(() => scoreExam([{ ...q[0], warning: -1 }, q[1], q[2]]));
  assert.throws(() => scoreExam([{ ...q[0], tajweed: 0.5 }, q[1], q[2]]));
});
test("retry date is exactly two study days, not 48 hours", () => {
  assert.equal(retryStudyDate("2026-10-30"), "2026-11-03");
  assert.equal(retryStudyDate("2026-10-29"), "2026-11-02");
  assert.equal(retryStudyDate("2026-10-31"), "2026-11-03");
});
