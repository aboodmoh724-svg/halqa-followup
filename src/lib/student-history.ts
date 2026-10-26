import { z } from "zod";
import { db } from "./db";
import { HttpError } from "./auth";
import { dayDate, dayKey } from "./dates";
import { totalPages, rangeSchema } from "./quran";
import type { EntryView, Outcome, AssignmentView } from "./types";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  });
export const historyQuery = z
  .object({
    from: date.optional(),
    to: date.optional(),
    before: date.optional(),
    kind: z.enum(["ALL", "MEMORIZATION", "REVIEW"]).default("ALL"),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to);
export type HistoryQuery = z.infer<typeof historyQuery>;
export type HistoryDay = {
  date: string;
  outcome: Outcome | null;
  reviewOnly: boolean;
  memorizationResult: string | null;
  reviewResult: string | null;
  note: string;
  closed: boolean;
  entries: EntryView[];
  assignment: AssignmentView | null;
};
export type StudentHistory = {
  studentName: string;
  halqaName: string;
  reviewOnly: boolean;
  summary: {
    recordedDays: number;
    masteredDays: number;
    notMasteredDays: number;
    absentDays: number;
    pendingDays: number;
    memorizationPages: number;
    reviewPages: number;
    masteredMemorizationPages: number;
    masteredReviewPages: number;
  };
  latest: { date: string; entry: EntryView } | null;
  upcoming: (AssignmentView & { dueDate: string }) | null;
  days: HistoryDay[];
  nextBefore: string | null;
};

export async function getStudentHistory(
  teacherId: string,
  halqaId: string,
  enrollmentId: string,
  raw: unknown,
): Promise<StudentHistory> {
  const query = historyQuery.parse(raw);
  const enrollment = await db.enrollment.findFirst({
    where: { id: enrollmentId, halqaId, halqa: { teacherId } },
    include: { student: true, halqa: true },
  });
  if (!enrollment) throw new HttpError(404, "الطالب غير موجود في حلقاتك");
  const through = query.to && query.to < dayKey() ? query.to : dayKey();
  const bounds = {
    ...(query.from ? { gte: dayDate(query.from) } : {}),
    lte: dayDate(through),
  };
  // Reading a history never opens a day, invents an absence, or creates a report.
  const records = await db.dailyStudentStatus.findMany({
    where: {
      enrollmentId,
      halqaId,
      session: { date: bounds },
      OR: [
        { outcome: { not: null } },
        { memorizationResult: { not: null } },
        { reviewResult: { not: null } },
        { note: { not: "" } },
        { entries: { some: {} } },
      ],
    },
    include: {
      session: { select: { date: true, closedAt: true } },
      entries: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
    orderBy: { session: { date: "desc" } },
  });
  const viewEntry = (
    e: (typeof records)[number]["entries"][number],
  ): EntryView => ({
    id: e.id,
    kind: e.kind,
    assessment: e.assessment,
    startSurah: e.startSurah,
    startAyah: e.startAyah,
    endSurah: e.endSurah,
    endAyah: e.endAyah,
    ...(e.direction === "REVERSE" ? { direction: "REVERSE" as const } : {}),
    createdAt: e.createdAt.toISOString(),
    pageAmount: e.pageAmount === null ? null : Number(e.pageAmount),
    pageMappingVersion: e.pageMappingVersion,
  });
  const entries = records.flatMap((r) => r.entries.map(viewEntry));
  const amount = (kind: EntryView["kind"], mastered = false) =>
    totalPages(
      entries.filter(
        (e) => e.kind === kind && (!mastered || e.assessment === "MASTERED"),
      ),
    );
  const page = records
    .filter(
      (r) =>
        !query.before ||
        r.session.date.toISOString().slice(0, 10) < query.before,
    )
    .slice(0, 21);
  const visible = page.slice(0, 20);
  const assignments = await db.assignment.findMany({
    where: {
      enrollmentId,
      dueDate: { in: visible.map((r) => r.session.date) },
    },
  });
  const assignmentView = (
    a: (typeof assignments)[number],
    reviewOnly: boolean,
  ): AssignmentView => ({
    id: a.id,
    memorization:
      !reviewOnly && a.memorization ? rangeSchema.parse(a.memorization) : null,
    review: a.review ? rangeSchema.parse(a.review) : null,
    note: a.note,
    imageName: a.imageName,
  });
  const upcoming = await db.assignment.findFirst({
    where: { enrollmentId, dueDate: { gte: dayDate(dayKey()) } },
    orderBy: { dueDate: "asc" },
  });
  const latest = await db.recitationEntry.findFirst({
    where: {
      dailyStatus: {
        enrollmentId,
        halqaId,
        session: { date: { lte: dayDate(dayKey()) } },
      },
    },
    include: {
      dailyStatus: { select: { session: { select: { date: true } } } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return {
    studentName: enrollment.student.name,
    halqaName: enrollment.halqa.name,
    reviewOnly: enrollment.reviewOnly,
    summary: {
      recordedDays: records.length,
      masteredDays: records.filter((r) => r.outcome === "MEMORIZED").length,
      notMasteredDays: records.filter((r) => r.outcome === "NOT_MEMORIZED")
        .length,
      absentDays: records.filter((r) => r.outcome === "ABSENT").length,
      pendingDays: records.filter((r) => r.outcome === null).length,
      memorizationPages: amount("MEMORIZATION"),
      reviewPages: amount("REVIEW"),
      masteredMemorizationPages: amount("MEMORIZATION", true),
      masteredReviewPages: amount("REVIEW", true),
    },
    latest: latest
      ? {
          date: latest.dailyStatus.session.date.toISOString().slice(0, 10),
          entry: viewEntry(latest),
        }
      : null,
    upcoming: upcoming
      ? {
          ...assignmentView(upcoming, enrollment.reviewOnly),
          dueDate: upcoming.dueDate.toISOString().slice(0, 10),
        }
      : null,
    days: visible.map((r) => {
      const a = assignments.find(
        (a) => a.dueDate.getTime() === r.session.date.getTime(),
      );
      return {
        date: r.session.date.toISOString().slice(0, 10),
        outcome: r.outcome,
        reviewOnly: r.reviewOnly,
        memorizationResult: r.memorizationResult,
        reviewResult: r.reviewResult,
        note: r.note,
        closed: !!r.session.closedAt,
        entries: r.entries
          .map(viewEntry)
          .filter((e) => query.kind === "ALL" || e.kind === query.kind),
        assignment: a ? assignmentView(a, r.reviewOnly) : null,
      };
    }),
    nextBefore:
      page.length > 20
        ? visible[visible.length - 1].session.date.toISOString().slice(0, 10)
        : null,
  };
}
