import { entryPages, rangeSchema, type QuranRange } from "./quran";
import { roundPages } from "./madani";
import { reportNumber } from "./report-format";
export function weeklyMinimumPages(className: string): 2 | 5 | null {
  const name = className.replace(/[أإآ]/g, "ا");
  if (name.includes("تاهيلي")) return null;
  if (/الاول|الثاني/.test(name)) return 2;
  if (/الثالث|الرابع|الخامس|السادس/.test(name)) return 5;
  return null;
}
export function weeklySupportReason(pages: number, minimum: 2 | 5) {
  return roundPages(pages) < minimum
    ? `الحفظ الجديد المتقن ${reportNumber(roundPages(pages))} صفحة؛ أقل من الحد الأسبوعي (${minimum} صفحة)`
    : null;
}
type MemoryEntry = QuranRange & {
  kind: string;
  assessment: string | null;
  masteryResult?: string | null;
  pageAmount: unknown;
  pageMappingVersion: string | null;
};
export function memoryDayEvidence(status: {
  outcome: string | null;
  reviewOnly: boolean;
  memorizationResult: string | null;
  entries: MemoryEntry[];
}) {
  return recitationDayEvidence(status, "MEMORIZATION");
}

export function recitationDayEvidence(
  status: {
    outcome: string | null;
    reviewOnly: boolean;
    memorizationResult: string | null;
    reviewResult?: string | null;
    entries: MemoryEntry[];
  },
  kind: "MEMORIZATION" | "REVIEW",
) {
  if (status.outcome === "ABSENT") return { known: true, pages: 0 };
  if (kind === "MEMORIZATION" && status.reviewOnly)
    return { known: false, pages: 0 };
  const entries = status.entries.filter((e) => e.kind === kind);
  if (!entries.length) return { known: false, pages: 0 };
  let known = true,
    pages = 0;
  for (const [i, entry] of entries.entries()) {
    const grade =
      entry.masteryResult ??
      (i === entries.length - 1
        ? kind === "MEMORIZATION"
          ? status.memorizationResult
          : status.reviewResult
        : null) ??
      entry.assessment;
    if (
      !["MASTERED", "NOT_MASTERED"].includes(grade ?? "") ||
      !rangeSchema.safeParse(entry).success
    ) {
      known = false;
      continue;
    }
    if (grade === "MASTERED")
      pages += entryPages({
        ...entry,
        pageAmount: entry.pageAmount === null ? null : Number(entry.pageAmount),
      });
  }
  return { known, pages: roundPages(pages) };
}
