import { entryPages, rangeSchema, surahs, type QuranRange } from "./quran";
import { madaniPageMap, roundPages } from "./madani";
import type { AssignmentSuggestion, EntryView } from "./types";

type HistoryDay = { date: string; entries: EntryView[] };

// A suggestion is a draft only. Five distinct days avoid extrapolating from
// several attempts on one day. No assignment or recitation is written here.
export function suggestAssignment(
  history: HistoryDay[],
  kind: EntryView["kind"],
): AssignmentSuggestion | null {
  const days = history
    .map((day) => ({
      date: day.date,
      entries: day.entries.filter(
        (e) => e.kind === kind && e.assessment === "MASTERED",
      ),
    }))
    .filter((day) => day.entries.length)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);
  if (days.length < 5) return null;
  const averages = days.map((day) =>
    day.entries.reduce((sum, e) => sum + entryPages(e), 0),
  );
  const averagePages = averages.reduce((sum, n) => sum + n, 0) / days.length;
  // With highly variable daily amounts, there is no useful stable proposal.
  if (averages.some((n) => n < averagePages * 0.5 || n > averagePages * 1.5))
    return null;
  const recent = days.flatMap((day) => [...day.entries].reverse());
  const last = recent[0];
  // Within one chapter the direction is ambiguous. Infer it only from actual
  // chapter movement in the recent history; otherwise omit the suggestion.
  const older = recent.find((e) => e.endSurah !== last.endSurah);
  const reverse =
    last.startSurah > last.endSurah || last.direction === "REVERSE"
      ? true
      : last.startSurah < last.endSurah
        ? false
        : older
          ? last.endSurah < older.endSurah
          : null;
  let surah = last.endSurah;
  let ayah = last.endAyah + 1;
  if (ayah > surahs[surah - 1].ayahs) {
    if (reverse === null) return null;
    surah += reverse ? -1 : 1;
    ayah = 1;
  }
  if (surah < 1 || surah > 114) return null;
  const startSurah = surah;
  const startAyah = ayah;
  let amount = 0;
  let best: QuranRange | null = null;
  let distance = Infinity;
  while (surah >= 1 && surah <= 114) {
    amount += madaniPageMap.fraction(surah, ayah);
    const diff = Math.abs(amount - averagePages);
    if (diff < distance) {
      best = rangeSchema.parse({
        startSurah,
        startAyah,
        endSurah: surah,
        endAyah: ayah,
      });
      distance = diff;
    }
    if (amount >= averagePages) break;
    ayah++;
    if (ayah > surahs[surah - 1].ayahs) {
      if (reverse === null) return null;
      surah += reverse ? -1 : 1;
      ayah = 1;
    }
  }
  // Do not suggest a truncated amount at the end of the study direction.
  if (!best || amount < averagePages * 0.8) return null;
  return {
    range: best,
    sampleDays: days.length,
    averagePages: roundPages(averagePages),
  };
}
