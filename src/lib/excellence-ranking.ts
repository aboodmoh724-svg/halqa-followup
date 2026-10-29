import { roundPages } from "./madani";

// Exact top three per class; ties in amount use Arabic name then stable ID.
// Positive, mastered activity only. A pupil may win both independent lists.
export function topThree<T extends { enrollmentId: string; name: string }>(
  rows: T[],
  amount: (row: T) => number,
) {
  return rows
    .filter((r) => roundPages(amount(r)) > 0)
    .sort(
      (a, b) =>
        roundPages(amount(b)) - roundPages(amount(a)) ||
        a.name.localeCompare(b.name, "ar") ||
        a.enrollmentId.localeCompare(b.enrollmentId),
    )
    .slice(0, 3);
}
