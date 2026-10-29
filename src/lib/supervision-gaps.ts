import {
  rangeSchema,
  rangeSegments,
  rangeText,
  surahs,
  type QuranRange,
} from "./quran";
import { suggestMemorySequence } from "./memorization-order";
export type GapEntry = { id: string; date: string; range: QuranRange };
function points(range: QuranRange) {
  return rangeSegments(range).flatMap((s) =>
    Array.from({ length: s.endAyah - s.startAyah + 1 }, (_, i) => ({
      surah: s.surah,
      ayah: s.startAyah + i,
    })),
  );
}
function rank(surah: number, ayah: number, reverse: boolean) {
  let n = ayah - 1;
  if (reverse) for (let s = 114; s > surah; s--) n += surahs[s - 1].ayahs;
  else for (let s = 1; s < surah; s++) n += surahs[s - 1].ayahs;
  return n;
}
/** Missing recorded verses, not a judgment of mastery. Recomputed after edits
 * or later gap-filling; repetition and ranges crossing chapters are valid. */
export function latestMemoryGap(input: GapEntry[]) {
  const entries = input.filter((e) => rangeSchema.safeParse(e.range).success);
  const recorded = new Set(
    entries.flatMap((e) => points(e.range).map((p) => `${p.surah}:${p.ayah}`)),
  );
  for (let i = entries.length - 1; i > 0; i--) {
    const current = entries[i],
      prior = entries.slice(0, i),
      previous = prior.at(-1)!;
    if (previous.range.endSurah === 1) continue; // Introductory Fatiha is not a placement test.
    const view = suggestMemorySequence(
      prior.map((e) => ({ range: e.range, mastered: true, date: e.date })),
    )!;
    const reverse = view.direction
      ? view.direction === "REVERSE"
      : current.range.startSurah < previous.range.endSurah;
    let next = view.next;
    if (!next && !view.complete) {
      const surah = previous.range.endSurah + (reverse ? -1 : 1);
      if (surah >= 2 && surah <= 114) next = { surah, ayah: 1 };
    }
    if (!next) continue;
    // Returning to earlier verses is a repeat, not an unrecorded jump.
    if (
      rank(current.range.startSurah, current.range.startAyah, reverse) <=
      rank(next.surah, next.ayah, reverse)
    )
      continue;
    let endSurah = current.range.startSurah,
      endAyah = current.range.startAyah - 1;
    if (!endAyah) {
      endSurah += reverse ? 1 : -1;
      if (endSurah < 1 || endSurah > 114) continue;
      endAyah = surahs[endSurah - 1].ayahs;
    }
    const gap = rangeSchema.safeParse({
      startSurah: next.surah,
      startAyah: next.ayah,
      endSurah,
      endAyah,
    });
    if (!gap.success) continue;
    const missing = points(gap.data).filter(
      (p) => !recorded.has(`${p.surah}:${p.ayah}`),
    );
    if (!missing.length) continue;
    const first = missing[0],
      last = missing.at(-1)!;
    return {
      entryId: current.id,
      dates: [current.date, previous.date],
      missingCount: missing.length,
      message: `تسجيل يحتاج مراجعة: ${rangeText(previous.range)} ثم ${rangeText(current.range)}. يوجد ${missing.length} آية بلا تسميع مسجل بينهما: ${surahs[first.surah - 1].name} ${first.ayah} إلى ${surahs[last.surah - 1].name} ${last.ayah}. لا يمنع هذا التنبيه التسجيل ولا يثبت خطأ المعلم.`,
    };
  }
  return null;
}
