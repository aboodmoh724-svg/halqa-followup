import metadata from "../data/juz-boundaries.json";
import { rangeSegments, rangeText, surahs, type QuranRange } from "./quran";
export const offsets = surahs.reduce<number[]>(
  (a, s) => [...a, a.at(-1)! + s.ayahs],
  [0],
);
export const verseIndex = (surah: number, ayah: number) =>
  offsets[surah - 1] + ayah - 1;
export function versePoint(index: number) {
  const s = surahs.findLast((s) => offsets[s.id - 1] <= index)!;
  return { surah: s.id, ayah: index - offsets[s.id - 1] + 1 };
}
export const juzs = metadata.juzStarts.map(([s, a], i) => {
  const start = verseIndex(s, a),
    next = metadata.juzStarts[i + 1];
  const end = next ? verseIndex(next[0], next[1]) - 1 : 6235;
  const p = versePoint(end);
  const range = {
    startSurah: s,
    startAyah: a,
    endSurah: p.surah,
    endAyah: p.ayah,
  };
  return {
    number: i + 1,
    name: `الجزء ${i + 1} · ${i === 29 ? "عمّ" : i === 28 ? "تبارك" : surahs[s - 1].name}`,
    range,
    text: rangeText(range),
    start,
    end,
    total: end - start + 1,
  };
});
export type CoverageEntry = {
  id: string;
  kind: "MEMORIZATION" | "REVIEW";
  range: QuranRange;
  mastered: boolean;
  date: string;
  createdAt: string;
};
function verses(range: QuranRange) {
  return rangeSegments(range).flatMap((s) =>
    Array.from({ length: s.endAyah - s.startAyah + 1 }, (_, i) =>
      verseIndex(s.surah, s.startAyah + i),
    ),
  );
}
export function completionProof(
  baseline: QuranRange[],
  input: CoverageEntry[],
) {
  const previous = new Uint8Array(6236),
    covered = new Uint8Array(6236);
  for (const range of baseline)
    for (const i of verses(range)) previous[i] = covered[i] = 1;
  const count = (values: Uint8Array, start: number, end: number) =>
    values.subarray(start, end + 1).reduce((a, b) => a + b, 0);
  const chapters = surahs.map((s) => ({
    number: s.id,
    name: s.name,
    start: offsets[s.id - 1],
    end: offsets[s.id] - 1,
    total: s.ayahs,
    previous: count(previous, offsets[s.id - 1], offsets[s.id] - 1),
    covered: 0,
    complete: false,
    fullRecited: false,
  }));
  for (const s of chapters) s.fullRecited = s.previous === s.total;
  const entries = [...input].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
  for (const e of entries) {
    if (!e.mastered) continue;
    if (e.kind === "MEMORIZATION")
      for (const i of verses(e.range)) covered[i] = 1;
    for (const seg of rangeSegments(e.range)) {
      const s = chapters[seg.surah - 1];
      if (
        seg.startAyah === 1 &&
        seg.endAyah === s.total &&
        count(covered, s.start, s.end) === s.total
      )
        s.fullRecited = true;
    }
  }
  for (const s of chapters) {
    s.covered = count(covered, s.start, s.end);
    s.complete = s.covered === s.total;
  }
  const parts = juzs.map((j) => {
    const amount = count(covered, j.start, j.end),
      old = count(previous, j.start, j.end);
    return {
      ...j,
      covered: amount,
      previous: old,
      complete: amount === j.total,
      eligible: amount === j.total && old < j.total,
      pendingSurahs: chapters
        .filter(
          (s) =>
            s.complete &&
            !s.fullRecited &&
            s.end >= j.start &&
            s.start <= j.end,
        )
        .map((s) => s.number),
    };
  });
  return { previous, covered, chapters, parts };
}
export type CompletionProof = ReturnType<typeof completionProof>;
// Gate only proven completed units. Ordinary sequence gaps remain advisory.
export function progressionProblem(
  baseline: QuranRange[],
  entries: CoverageEntry[],
  range: QuranRange,
  approvedParts: Set<number>,
  mastered = true,
  changedApprovals: Set<number> = new Set(),
) {
  const before = completionProof(baseline, entries);
  const novel = verses(range).filter((i) => !before.covered[i]);
  if (!novel.length) return null;
  for (const number of changedApprovals) {
    const j = juzs[number - 1];
    if (novel.some((i) => i < j.start || i > j.end))
      return `تغير سجل ${j.name} بعد اعتماد الاختبار؛ استكمل دليل الإتمام وراجعه مع المشرف قبل الانتقال.`;
  }
  const candidate: CoverageEntry = {
    id: "~candidate",
    kind: "MEMORIZATION",
    range,
    mastered,
    date: "9999-12-31",
    createdAt: "9999-12-31",
  };
  const after = completionProof(baseline, [...entries, candidate]);
  for (const s of after.chapters.filter((s) => s.complete && !s.fullRecited))
    if (novel.some((i) => i < s.start || i > s.end))
      return `أكمل تسميع سورة ${s.name} كاملة مرة واحدة بإتقان قبل الانتقال إلى سورة أخرى.`;
  const last = entries.findLast((e) => e.kind === "MEMORIZATION");
  const reverse =
    range.startSurah > range.endSurah ||
    (last && range.startSurah < last.range.endSurah) ||
    range.startSurah === 114;
  for (const j of after.parts.filter(
    (j) => j.eligible && !approvedParts.has(j.number),
  )) {
    const justFinished = !before.parts[j.number - 1].complete;
    if (
      novel.some((i) => {
        if (i >= j.start && i <= j.end) return false;
        // Reverse chapter order still recites verses ascending within a shared
        // boundary chapter. Its leading verses may belong to the following juz.
        return !(
          justFinished &&
          reverse &&
          versePoint(i).surah === j.range.startSurah
        );
      })
    )
      return `أتم الطالب ${j.name}؛ يلزم الاختبار واعتماد المشرف قبل تسجيل حفظ جديد في جزء آخر. المراجعة متاحة.`;
  }
  return null;
}
