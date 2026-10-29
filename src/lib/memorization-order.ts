import { rangeSchema, rangeSegments, surahs, type QuranRange } from "./quran";
export type MemoryDirection = "FORWARD" | "REVERSE";
export type VersePoint = { surah: number; ayah: number };
export type MemorySequenceView = {
  start: VersePoint;
  direction: MemoryDirection | null;
  next: VersePoint | null;
  adjacentSurahs: number[];
  complete: boolean;
  learning: boolean;
  sampleDays: number;
};
export type MemoryAttempt = {
  range: QuranRange;
  mastered: boolean | null;
  date: string;
};
// Fatiha is introductory and does not establish a pupil's direction.
export function inferMemoryDirection(
  range: QuranRange,
): MemoryDirection | null {
  if (range.startSurah !== range.endSurah)
    return range.startSurah < range.endSurah ? "FORWARD" : "REVERSE";
  return range.startSurah === 2
    ? "FORWARD"
    : range.startSurah === 114
      ? "REVERSE"
      : null;
}
/** Suggest from recorded attempts; never certify coverage or gate eligibility. */
export function suggestMemorySequence(
  attempts: MemoryAttempt[],
): MemorySequenceView | undefined {
  const records = attempts.filter(
    (a) => rangeSchema.safeParse(a.range).success,
  );
  if (!records.length) return undefined;
  const days = [...new Set(records.map((a) => a.date))];
  const recentDays = new Set(days.slice(-14));
  const recent = records.filter((a) => recentDays.has(a.date));
  const votes = new Map<string, Set<MemoryDirection>>();
  const vote = (date: string, direction: MemoryDirection) => {
    const set = votes.get(date) ?? new Set<MemoryDirection>();
    set.add(direction);
    votes.set(date, set);
  };
  let previous: MemoryAttempt | undefined;
  for (const a of recent) {
    if (a.mastered !== true) continue;
    if (
      a.range.startSurah !== a.range.endSurah &&
      a.range.startSurah !== 1 &&
      a.range.endSurah !== 1
    )
      vote(
        a.date,
        a.range.startSurah < a.range.endSurah ? "FORWARD" : "REVERSE",
      );
    if (
      previous &&
      previous.range.endSurah !== 1 &&
      a.range.startSurah !== 1 &&
      Math.abs(a.range.startSurah - previous.range.endSurah) === 1
    )
      vote(
        a.date,
        a.range.startSurah > previous.range.endSurah ? "FORWARD" : "REVERSE",
      );
    previous = a;
  }
  const forward = [...votes.values()].filter((v) => v.has("FORWARD")).length;
  const reverse = [...votes.values()].filter((v) => v.has("REVERSE")).length;
  const conflict = forward > 0 && reverse > 0;
  const latest =
    records.findLast((a) => a.mastered !== null) ?? records.at(-1)!;
  const last = latest.range;
  const edge = recent.some(
    (a) => a.mastered === true && a.range.startSurah === 2,
  )
    ? "FORWARD"
    : recent.some((a) => a.mastered === true && a.range.startSurah === 114)
      ? "REVERSE"
      : null;
  const observed = forward ? "FORWARD" : reverse ? "REVERSE" : null;
  const direction: MemoryDirection | null = conflict
    ? null
    : (observed ?? edge);
  const span = (Date.parse(days.at(-1)!) - Date.parse(days[0])) / 86400000;
  const learning =
    days.length < 5 ||
    span < 7 ||
    !direction ||
    (!edge && Math.max(forward, reverse) < 2);
  let next: VersePoint | null;
  let adjacentSurahs: number[] = [];
  if (latest.mastered !== true)
    next = { surah: last.startSurah, ayah: last.startAyah };
  else if (last.endAyah < surahs[last.endSurah - 1].ayahs)
    next = { surah: last.endSurah, ayah: last.endAyah + 1 };
  else if (last.endSurah === 1) next = { surah: 2, ayah: 1 };
  else if (direction) {
    const s = last.endSurah + (direction === "FORWARD" ? 1 : -1);
    next = s >= 2 && s <= 114 ? { surah: s, ayah: 1 } : null;
  } else {
    next = null;
    adjacentSurahs = [last.endSurah - 1, last.endSurah + 1].filter(
      (s) => s >= 2 && s <= 114,
    );
  }
  return {
    start: { surah: last.startSurah, ayah: last.startAyah },
    direction,
    next,
    adjacentSurahs,
    complete:
      latest.mastered === true &&
      !next &&
      !!direction &&
      !adjacentSurahs.length,
    learning,
    sampleDays: days.length,
  };
}
/** Informational only. Callers must not reject a save because of this advice. */
export function memoryRangeAdvice(
  view: MemorySequenceView,
  range: QuranRange,
): string | null {
  if (!rangeSchema.safeParse(range).success) return null;
  const next = view.next;
  if (
    next &&
    (range.startSurah !== next.surah || range.startAyah !== next.ayah)
  )
    return `البداية المقترحة: ${surahs[next.surah - 1].name}، الآية ${next.ayah}. راجع المدى؛ يمكنك حفظ ما أدخلته كما هو.`;
  if (
    view.direction &&
    range.startSurah !== range.endSurah &&
    range.startSurah < range.endSurah !== (view.direction === "FORWARD")
  )
    return "هذا المدى يختلف عن اتجاه الحفظ المقترح من السجل. يمكنك حفظه كما هو.";
  return null;
}
function index(point: VersePoint, direction: MemoryDirection) {
  let n = point.ayah - 1;
  if (direction === "FORWARD")
    for (let s = 1; s < point.surah; s++) n += surahs[s - 1].ayahs;
  else for (let s = 114; s > point.surah; s--) n += surahs[s - 1].ayahs;
  return n;
}
export function nextMemoryRange(
  view: MemorySequenceView | undefined | null,
  assignment: QuranRange | undefined | null,
  recordedToday = false,
): QuranRange {
  const empty = { startSurah: 0, startAyah: 1, endSurah: 0, endAyah: 1 };
  if (!view?.next) return assignment ?? empty;
  const p = view.next;
  if (assignment) {
    if (
      rangeSegments(assignment).some(
        (s) =>
          s.surah === p.surah && s.startAyah <= p.ayah && s.endAyah >= p.ayah,
      )
    )
      return rangeSchema.parse({
        ...assignment,
        startSurah: p.surah,
        startAyah: p.ayah,
      });
    const end = { surah: assignment.endSurah, ayah: assignment.endAyah };
    const alreadyPassed =
      p.surah === end.surah
        ? p.ayah > end.ayah
        : view.direction &&
          index(p, view.direction) > index(end, view.direction);
    // Keep a teacher's different/future assignment instead of silently discarding it.
    if (!alreadyPassed && !recordedToday) return assignment;
  }
  return {
    startSurah: p.surah,
    startAyah: p.ayah,
    endSurah: p.surah,
    endAyah: p.ayah,
  };
}
