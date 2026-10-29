import type { Prisma } from "@prisma/client";
import { dayDate } from "./dates";
import { rangeSchema, type QuranRange } from "./quran";
import { HttpError } from "./auth";
import {
  inferMemoryDirection,
  replayMemorySequence,
  validateMemoryCandidate,
  type MemorySequenceView,
  type MemoryDirection,
} from "./memorization-order";
type Client = Pick<
  Prisma.TransactionClient,
  "memorizationSequence" | "recitationEntry"
>;
type Path = {
  enrollmentId: string;
  startSurah: number;
  startAyah: number;
  initialDirection: MemoryDirection | null;
  anchorEntryId: string | null;
  anchorMastered: boolean;
  createdAt: Date;
};
const include = {
  dailyStatus: {
    select: {
      enrollmentId: true,
      memorizationResult: true,
      session: { select: { date: true } },
    },
  },
} as const;
const order = [
  { dailyStatus: { session: { date: "asc" } } },
  { createdAt: "asc" },
  { id: "asc" },
] as const;
type Record = Prisma.RecitationEntryGetPayload<{ include: typeof include }>;
const grade = (value: string | null) =>
  value === "MASTERED" || value === "NOT_MASTERED" ? value : null;
function seed(records: Record[]) {
  const last = records.at(-1);
  if (!last) return null;
  const older = [...records]
    .reverse()
    .find((r) => r.endSurah !== last.endSurah);
  const crossed = last.startSurah !== last.endSurah;
  const direction = crossed
    ? inferMemoryDirection(last)
    : older && Math.abs(older.endSurah - last.endSurah) === 1
      ? last.endSurah > older.endSurah
        ? "FORWARD"
        : "REVERSE"
      : inferMemoryDirection(last);
  return {
    startSurah: last.startSurah,
    startAyah: last.startAyah,
    initialDirection: direction,
    anchorEntryId: last.id,
    anchorMastered:
      (grade(last.dailyStatus.memorizationResult) ??
        grade(last.masteryResult) ??
        grade(last.assessment)) === "MASTERED",
  };
}
function replay(path: Path, records: Record[]) {
  const latest = new Map<string, string>();
  for (const r of records)
    latest.set(r.dailyStatus.session.date.toISOString(), r.id);
  return replayMemorySequence(
    { surah: path.startSurah, ayah: path.startAyah },
    path.initialDirection,
    records.map((r) => {
      let result =
        grade(r.masteryResult) ??
        (r.id === path.anchorEntryId
          ? path.anchorMastered
            ? "MASTERED"
            : "NOT_MASTERED"
          : grade(r.assessment));
      if (
        !r.masteryResult &&
        latest.get(r.dailyStatus.session.date.toISOString()) === r.id
      )
        result = grade(r.dailyStatus.memorizationResult) ?? result;
      return {
        range: rangeSchema.parse(r),
        mastered: result === null ? null : result === "MASTERED",
      };
    }),
  );
}
export async function ensureMemorySequence(
  client: Client,
  enrollmentId: string,
  date: string,
  firstRange?: QuranRange,
) {
  const existing = await client.memorizationSequence.findUnique({
    where: { enrollmentId },
  });
  if (existing) return existing;
  const legacy = await client.recitationEntry.findMany({
    where: {
      kind: "MEMORIZATION",
      dailyStatus: {
        enrollmentId,
        OR: [{ outcome: null }, { outcome: { not: "ABSENT" } }],
        session: { date: { lte: dayDate(date) } },
      },
    },
    include,
    orderBy: [...order],
  });
  const anchor = seed(legacy);
  if (!anchor && !firstRange) return null;
  return client.memorizationSequence.create({
    data: {
      enrollmentId,
      ...(anchor ?? {
        startSurah: firstRange!.startSurah,
        startAyah: firstRange!.startAyah,
        initialDirection: inferMemoryDirection(firstRange!),
        anchorEntryId: null,
        anchorMastered: false,
      }),
    },
  });
}
async function rowsFor(client: Client, path: Path, date: string) {
  return client.recitationEntry.findMany({
    where: {
      kind: "MEMORIZATION",
      dailyStatus: {
        enrollmentId: path.enrollmentId,
        session: { date: { lte: dayDate(date) } },
      },
      OR: [
        ...(path.anchorEntryId ? [{ id: path.anchorEntryId }] : []),
        { createdAt: { gte: path.createdAt } },
      ],
    },
    include,
    orderBy: [...order],
  });
}
export async function enforceMemorySequence(
  client: Client,
  path: Path,
  date: string,
  edit?: { id: string; range: QuranRange },
  assignment?: QuranRange,
) {
  const rows = await rowsFor(client, path, date);
  let current = path;
  if (
    edit &&
    ((path.anchorEntryId && path.anchorEntryId === edit.id) ||
      (!path.anchorEntryId && rows[0]?.id === edit.id))
  ) {
    current = await client.memorizationSequence.update({
      where: { enrollmentId: path.enrollmentId },
      data: {
        startSurah: edit.range.startSurah,
        startAyah: edit.range.startAyah,
        initialDirection: inferMemoryDirection(edit.range),
      },
    });
  }
  try {
    const state = replay(current, rows);
    if (assignment) {
      const problem = validateMemoryCandidate(state, assignment);
      if (problem) throw Error(problem);
    }
    return state;
  } catch (e) {
    throw new HttpError(
      409,
      e instanceof Error ? e.message : "تحقق من تتابع الحفظ",
    );
  }
}
export async function readMemorySequences(
  client: Client,
  enrollmentIds: string[],
  date: string,
) {
  const paths = await client.memorizationSequence.findMany({
    where: { enrollmentId: { in: enrollmentIds } },
  });
  const map = new Map(paths.map((p) => [p.enrollmentId, p]));
  const rows = await client.recitationEntry.findMany({
    where: {
      kind: "MEMORIZATION",
      dailyStatus: {
        enrollmentId: { in: enrollmentIds },
        session: { date: { lte: dayDate(date) } },
        OR: [{ outcome: null }, { outcome: { not: "ABSENT" } }],
      },
      OR: enrollmentIds.map((id) => {
        const p = map.get(id);
        return p
          ? {
              dailyStatus: { enrollmentId: id },
              OR: [
                ...(p.anchorEntryId ? [{ id: p.anchorEntryId }] : []),
                { createdAt: { gte: p.createdAt } },
              ],
            }
          : { dailyStatus: { enrollmentId: id } };
      }),
    },
    include,
    orderBy: [...order],
  });
  const grouped = new Map<string, Record[]>();
  for (const r of rows) {
    const a = grouped.get(r.dailyStatus.enrollmentId) ?? [];
    a.push(r);
    grouped.set(r.dailyStatus.enrollmentId, a);
  }
  const views = new Map<string, MemorySequenceView>();
  for (const id of enrollmentIds) {
    const path = map.get(id),
      records = grouped.get(id) ?? [];
    const anchor = path ?? seed(records);
    if (!anchor) continue;
    if (path && !records.length) continue;
    const p: Path = path ?? {
      ...anchor,
      enrollmentId: id,
      createdAt: new Date(),
    };
    const selected = path ? records : records.slice(-1);
    try {
      views.set(id, replay(p, selected));
    } catch (e) {
      views.set(id, {
        start: { surah: p.startSurah, ayah: p.startAyah },
        direction: p.initialDirection,
        next: null,
        adjacentSurahs: [],
        complete: false,
        problem: e instanceof Error ? e.message : "تحقق من تتابع الحفظ",
      });
    }
  }
  return views;
}
