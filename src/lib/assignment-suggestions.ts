import { rangeSchema, rangeSegments, surahs, type QuranRange } from "./quran";
import { madaniPageMap, roundPages } from "./madani";
import { isStudyDay } from "./dates";
import type { AssignmentSuggestion, EntryView } from "./types";
type HistoryDay = { date: string; entries: EntryView[] };
// Average completed school days, anchor after the latest activity (including
// today's attempts). Opening/using a suggestion never writes an activity.
export function suggestAssignment(
  history: HistoryDay[],
  kind: EntryView["kind"],
  options: { beforeDate?: string; throughDate?: string } = {},
): AssignmentSuggestion | null {
  const grouped = new Map<string, Map<string, EntryView>>();
  for (const day of history) {
    if (
      !isStudyDay(day.date) ||
      (options.throughDate && day.date > options.throughDate)
    )
      continue;
    const entries = day.entries.filter(
      (e) => e.kind === kind && rangeSchema.safeParse(e).success,
    );
    if (!entries.length) continue;
    const group = grouped.get(day.date) ?? new Map<string, EntryView>();
    for (const e of entries) group.set(e.id, e);
    grouped.set(day.date, group);
  }
  const all = [...grouped]
    .map(([date, entries]) => ({
      date,
      entries: [...entries.values()].sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      ),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
  const days = all
    .filter((d) => !options.beforeDate || d.date < options.beforeDate)
    .slice(0, 5);
  if (days.length < 5) return null;
  // Do not replace a difficult/ungraded day with an older successful one.
  if (days.some((d) => d.entries.at(-1)?.assessment !== "MASTERED"))
    return null;
  const amounts = days.map((day) => {
    const verses = new Map<string, number>();
    for (const entry of day.entries.filter((e) => e.assessment === "MASTERED"))
      for (const segment of rangeSegments(entry))
        for (let a = segment.startAyah; a <= segment.endAyah; a++)
          verses.set(
            `${segment.surah}:${a}`,
            madaniPageMap.fraction(segment.surah, a),
          );
    return [...verses.values()].reduce((sum, n) => sum + n, 0);
  });
  const averagePages = amounts.reduce((sum, n) => sum + n, 0) / 5;
  if (
    !averagePages ||
    amounts.some((n) => n < averagePages * 0.5 || n > averagePages * 1.5)
  )
    return null;
  const recent = all
    .filter((day) => day.date >= days.at(-1)!.date)
    .flatMap((day) => [...day.entries].reverse());
  const last = recent[0];
  if (!last || last.assessment !== "MASTERED") return null;
  const directions = new Set<"FORWARD" | "REVERSE">();
  const chronological = [...recent].reverse();
  for (let i = 0; i < chronological.length; i++) {
    const e = chronological[i];
    if (e.startSurah !== e.endSurah && e.startSurah !== 1 && e.endSurah !== 1)
      directions.add(e.startSurah < e.endSurah ? "FORWARD" : "REVERSE");
    const prior = chronological[i - 1];
    if (
      prior &&
      prior.endSurah !== 1 &&
      e.startSurah !== 1 &&
      Math.abs(prior.endSurah - e.startSurah) === 1
    )
      directions.add(e.startSurah > prior.endSurah ? "FORWARD" : "REVERSE");
  }
  const direction =
    directions.size === 1
      ? [...directions][0]
      : directions.size > 1
        ? null
        : last.endSurah === 2
          ? "FORWARD"
          : last.endSurah === 114
            ? "REVERSE"
            : null;
  let surah = last.endSurah,
    ayah = last.endAyah + 1;
  const advance = () => {
    if (!direction) return false;
    surah += direction === "REVERSE" ? -1 : 1;
    ayah = 1;
    return surah >= 2 && surah <= 114;
  };
  if (ayah > surahs[surah - 1].ayahs && !advance()) return null;
  const startSurah = surah,
    startAyah = ayah;
  let amount = 0,
    bestAmount = 0,
    distance = Infinity,
    best: QuranRange | null = null;
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
      bestAmount = amount;
    }
    if (amount >= averagePages) break;
    ayah++;
    if (ayah > surahs[surah - 1].ayahs && !advance()) break;
  }
  // Whole verses only: omit a proposal when a long verse or route boundary
  // cannot approximate the usual amount safely. Manual entry stays available.
  if (
    !best ||
    bestAmount < averagePages * 0.8 ||
    bestAmount > averagePages * 1.25
  )
    return null;
  return { range: best, sampleDays: 5, averagePages: roundPages(averagePages) };
}
