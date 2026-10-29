import { rangeSchema, rangeSegments, surahs, type QuranRange } from "./quran";
export type MemoryDirection = "FORWARD" | "REVERSE";
export type VersePoint = { surah: number; ayah: number };
export type MemorySequenceView = {
  start: VersePoint;
  direction: MemoryDirection | null;
  next: VersePoint | null;
  adjacentSurahs: number[];
  complete: boolean;
  problem?: string;
};
export type MemoryAttempt = { range: QuranRange; mastered: boolean | null };
export class MemoryOrderError extends Error {}
export function inferMemoryDirection(
  range: QuranRange,
): MemoryDirection | null {
  if (range.startSurah !== range.endSurah)
    return range.startSurah < range.endSurah ? "FORWARD" : "REVERSE";
  return range.startSurah <= 2
    ? "FORWARD"
    : range.startSurah === 114
      ? "REVERSE"
      : null;
}
function index(point: VersePoint, direction: MemoryDirection) {
  let n = point.ayah - 1;
  if (direction === "FORWARD")
    for (let s = 1; s < point.surah; s++) n += surahs[s - 1].ayahs;
  else for (let s = 114; s > point.surah; s--) n += surahs[s - 1].ayahs;
  return n;
}
function pointAt(n: number, direction: MemoryDirection): VersePoint | null {
  const step = direction === "FORWARD" ? 1 : -1;
  for (
    let s = direction === "FORWARD" ? 1 : 114;
    s >= 1 && s <= 114;
    s += step
  ) {
    if (n < surahs[s - 1].ayahs) return { surah: s, ayah: n + 1 };
    n -= surahs[s - 1].ayahs;
  }
  return null;
}
function directionFor(
  start: VersePoint,
  initial: MemoryDirection | null,
  attempts: MemoryAttempt[],
) {
  if (initial) return initial;
  const edge = inferMemoryDirection({
    startSurah: start.surah,
    endSurah: start.surah,
    startAyah: start.ayah,
    endAyah: start.ayah,
  });
  if (edge) return edge;
  for (const a of attempts) {
    if (a.range.startSurah !== start.surah) {
      if (Math.abs(a.range.startSurah - start.surah) !== 1)
        throw new MemoryOrderError(
          "اختر السورة المجاورة بعد إكمال السورة الحالية؛ لا يمكن القفز بين السور.",
        );
      return a.range.startSurah > start.surah ? "FORWARD" : "REVERSE";
    }
    if (a.range.startSurah !== a.range.endSurah)
      return a.range.startSurah < a.range.endSurah ? "FORWARD" : "REVERSE";
  }
  return null;
}
type Interval = [number, number];
function updateCoverage(
  covered: Interval[],
  first: number,
  last: number,
  result: boolean | null,
): Interval[] {
  if (result === null || last < first) return covered;
  if (!result)
    return covered.flatMap(([a, b]) =>
      b < first || a > last
        ? [[a, b] as Interval]
        : [
            ...(a < first ? [[a, first - 1] as Interval] : []),
            ...(b > last ? [[last + 1, b] as Interval] : []),
          ],
    );
  const sorted = [...covered, [first, last] as Interval].sort(
    (a, b) => a[0] - b[0],
  );
  const merged: Interval[] = [];
  for (const pair of sorted) {
    const tail = merged.at(-1);
    if (tail && pair[0] <= tail[1] + 1) tail[1] = Math.max(tail[1], pair[1]);
    else merged.push([...pair]);
  }
  return merged;
}
function nextUncovered(covered: Interval[], start: number) {
  let cursor = start;
  for (const [a, b] of covered) {
    if (b < cursor) continue;
    if (a > cursor) break;
    cursor = b + 1;
  }
  return cursor;
}
export function replayMemorySequence(
  start: VersePoint,
  initial: MemoryDirection | null,
  attempts: MemoryAttempt[],
): MemorySequenceView {
  rangeSchema.parse({
    startSurah: start.surah,
    endSurah: start.surah,
    startAyah: start.ayah,
    endAyah: start.ayah,
  });
  const direction = directionFor(start, initial, attempts);
  if (!direction) {
    let cursor = start.ayah;
    let covered: Interval[] = [];
    for (const a of attempts) {
      const r = rangeSchema.parse(a.range);
      if (
        r.startSurah !== start.surah ||
        r.endSurah !== start.surah ||
        r.startAyah > cursor
      )
        throw new MemoryOrderError(
          `أكمل ${surahs[start.surah - 1].name} من الآية ${cursor} أولًا؛ لا يمكن تجاوز آيات غير مكتملة.`,
        );
      covered = updateCoverage(
        covered,
        Math.max(start.ayah, r.startAyah),
        r.endAyah,
        a.mastered,
      );
      cursor = nextUncovered(covered, start.ayah);
    }
    const finished = cursor > surahs[start.surah - 1].ayahs;
    return {
      start,
      direction: null,
      next: finished ? null : { surah: start.surah, ayah: cursor },
      adjacentSurahs: finished
        ? [start.surah - 1, start.surah + 1].filter((s) => s >= 2 && s <= 114)
        : [],
      complete: false,
    };
  }
  const minimum = index({ surah: start.surah, ayah: 1 }, direction),
    stop = index(
      {
        surah: direction === "FORWARD" ? 114 : start.surah === 1 ? 1 : 2,
        ayah: surahs[
          (direction === "FORWARD" ? 114 : start.surah === 1 ? 1 : 2) - 1
        ].ayahs,
      },
      direction,
    );
  const baseline = index(start, direction);
  let cursor = baseline;
  let covered: Interval[] = [];
  for (const a of attempts) {
    const r = rangeSchema.parse(a.range);
    const first = index({ surah: r.startSurah, ayah: r.startAyah }, direction),
      last = index({ surah: r.endSurah, ayah: r.endAyah }, direction);
    if (
      (r.startSurah !== r.endSurah &&
        r.startSurah < r.endSurah !== (direction === "FORWARD")) ||
      first < minimum ||
      last < first ||
      last > stop
    )
      throw new MemoryOrderError("هذا المدى يخالف اتجاه الحفظ المسجل للطالب.");
    if (first > cursor) {
      const next = pointAt(cursor, direction);
      throw new MemoryOrderError(
        next
          ? `الموضع التالي هو ${surahs[next.surah - 1].name}، الآية ${next.ayah}. أكمل ما قبله دون قفز.`
          : "وصل الطالب إلى نهاية تتابع الحفظ المسجل.",
      );
    }
    covered = updateCoverage(
      covered,
      Math.max(baseline, first),
      last,
      a.mastered,
    );
    cursor = nextUncovered(covered, baseline);
  }
  const complete = cursor > stop;
  return {
    start,
    direction,
    next: complete ? null : pointAt(cursor, direction),
    adjacentSurahs: [],
    complete,
  };
}
export function validateMemoryCandidate(
  view: MemorySequenceView,
  range: QuranRange,
): string | null {
  try {
    if (view.problem) return view.problem;
    if (view.complete)
      return "وصل الطالب إلى نهاية مسار الحفظ المسجل؛ يمكن متابعة المراجعة.";
    if (!view.direction) {
      if (view.next) {
        if (
          range.startSurah !== view.next.surah ||
          range.startAyah > view.next.ayah
        )
          return `ابدأ من ${surahs[view.next.surah - 1].name}، الآية ${view.next.ayah}، أو من موضع مسجل قبله.`;
      } else if (
        !view.adjacentSurahs.includes(range.startSurah) &&
        range.startSurah !== view.start.surah
      )
        return "اختر السورة المجاورة وفق ترتيب الحفظ؛ لا يمكن القفز بين السور.";
      if (!view.next && range.startSurah !== view.start.surah) {
        const dir = range.startSurah > view.start.surah ? "FORWARD" : "REVERSE";
        return validateMemoryCandidate(
          {
            ...view,
            direction: dir,
            next: { surah: range.startSurah, ayah: 1 },
            adjacentSurahs: [],
          },
          range,
        );
      }
      return null;
    }
    const next = view.next!;
    const first = index(
        { surah: range.startSurah, ayah: range.startAyah },
        view.direction,
      ),
      last = index(
        { surah: range.endSurah, ayah: range.endAyah },
        view.direction,
      );
    if (
      first < index({ surah: view.start.surah, ayah: 1 }, view.direction) ||
      last < first ||
      (view.direction === "REVERSE" &&
        view.start.surah !== 1 &&
        range.endSurah < 2)
    )
      return "هذا المدى يخالف اتجاه الحفظ المسجل للطالب.";
    if (first > index(next, view.direction))
      return `الموضع التالي هو ${surahs[next.surah - 1].name}، الآية ${next.ayah}. أكمل ما قبله دون قفز.`;
    return null;
  } catch {
    return "تحقق من مدى الحفظ وتسلسله.";
  }
}
export function nextMemoryRange(
  view: MemorySequenceView | undefined | null,
  assignment: QuranRange | null | undefined,
): QuranRange {
  if (!view || view.problem || view.complete)
    return (
      assignment ?? { startSurah: 0, startAyah: 1, endSurah: 0, endAyah: 1 }
    );
  if (!view.next) {
    if (
      assignment &&
      (view.adjacentSurahs.includes(assignment.startSurah) ||
        (assignment.startSurah === view.start.surah &&
          assignment.endSurah !== view.start.surah)) &&
      !validateMemoryCandidate(view, assignment)
    )
      return assignment;
    return { startSurah: 0, startAyah: 1, endSurah: 0, endAyah: 1 };
  }
  const p = view.next;
  if (
    assignment &&
    rangeSegments(assignment).some(
      (s) =>
        s.surah === p.surah && s.startAyah <= p.ayah && s.endAyah >= p.ayah,
    )
  ) {
    const candidate = rangeSchema.parse({
      ...assignment,
      startSurah: p.surah,
      startAyah: p.ayah,
    });
    if (!validateMemoryCandidate(view, candidate)) return candidate;
  }
  return {
    startSurah: p.surah,
    startAyah: p.ayah,
    endSurah: p.surah,
    endAyah: p.ayah,
  };
}
