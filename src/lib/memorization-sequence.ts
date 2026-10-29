import type { Prisma } from "@prisma/client";
import { dayDate } from "./dates";
import { rangeSchema } from "./quran";
import {
  suggestMemorySequence,
  type MemorySequenceView,
} from "./memorization-order";
type Client = Pick<Prisma.TransactionClient, "recitationEntry">;
// Read actual history, including teacher-accepted gaps. Old strict anchors are
// preserved in the DB but no longer constrain reads or writes.
export async function readMemorySequences(
  client: Client,
  enrollmentIds: string[],
  date: string,
) {
  const views = new Map<string, MemorySequenceView>();
  if (!enrollmentIds.length) return views;
  const rows = await client.recitationEntry.findMany({
    where: {
      kind: "MEMORIZATION",
      dailyStatus: {
        enrollmentId: { in: enrollmentIds },
        session: { date: { lte: dayDate(date) } },
        OR: [{ outcome: null }, { outcome: { not: "ABSENT" } }],
      },
    },
    include: {
      dailyStatus: {
        select: {
          enrollmentId: true,
          memorizationResult: true,
          session: { select: { date: true } },
        },
      },
    },
    orderBy: [
      { dailyStatus: { session: { date: "asc" } } },
      { createdAt: "asc" },
      { id: "asc" },
    ],
  });
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = grouped.get(row.dailyStatus.enrollmentId) ?? [];
    group.push(row);
    grouped.set(row.dailyStatus.enrollmentId, group);
  }
  for (const [id, records] of grouped) {
    const latestByDay = new Map<string, string>();
    for (const r of records)
      latestByDay.set(r.dailyStatus.session.date.toISOString(), r.id);
    const view = suggestMemorySequence(
      records.flatMap((r) => {
        const parsed = rangeSchema.safeParse(r);
        if (!parsed.success) return [];
        const date = r.dailyStatus.session.date.toISOString();
        const corrected =
          !r.masteryResult && latestByDay.get(date) === r.id
            ? r.dailyStatus.memorizationResult
            : null;
        const result = r.masteryResult ?? corrected ?? r.assessment;
        return [
          {
            range: parsed.data,
            mastered:
              result === "MASTERED"
                ? true
                : result === "NOT_MASTERED"
                  ? false
                  : null,
            date: date.slice(0, 10),
          },
        ];
      }),
    );
    if (view) views.set(id, view);
  }
  return views;
}
