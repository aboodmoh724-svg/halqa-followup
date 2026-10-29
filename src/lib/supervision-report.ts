import { db } from "./db";
import { HttpError } from "./auth";
import { dayDate, dayKey } from "./dates";
import { independentSummary } from "./types";
import { totalPages, rangeText } from "./quran";
import {
  supervisionReportQuery,
  reportReasons,
  reportCriteria,
  reportTitles,
} from "./supervision-report-policy";
export async function getSupervisionReport(raw: unknown) {
  const query = supervisionReportQuery.parse(raw);
  if (query.to > dayKey())
    throw new HttpError(400, "لا يمكن إصدار تقرير بتاريخ مستقبلي");
  const bounds = { gte: dayDate(query.from), lte: dayDate(query.to) };
  const excluded = (process.env.SUPERVISOR_EXCLUDED_HALQA_IDS ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const selectedStudent =
    query.type === "student"
      ? await db.enrollment.findFirst({
          where: {
            id: query.enrollmentId,
            halqaId: {
              notIn: excluded,
              ...(query.halqaId ? { equals: query.halqaId } : {}),
            },
          },
          select: { studentId: true },
        })
      : null;
  if (query.type === "student" && !selectedStudent)
    throw new HttpError(404, "الطالب غير موجود في الحلقة المحددة");
  const classes = await db.halqa.findMany({
    where: {
      id: {
        notIn: excluded,
        ...(query.halqaId && !selectedStudent ? { equals: query.halqaId } : {}),
      },
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      teacher: { select: { name: true } },
      enrollments: {
        where: {
          ...(selectedStudent
            ? { studentId: selectedStudent.studentId }
            : query.enrollmentId
              ? { id: query.enrollmentId }
              : {}),
          OR: [
            { active: true },
            { dailyStatuses: { some: { session: { date: bounds } } } },
          ],
        },
        orderBy: { position: "asc" },
        select: {
          id: true,
          studentId: true,
          reviewOnly: true,
          active: true,
          student: { select: { name: true } },
          dailyStatuses: {
            where: { session: { date: bounds } },
            orderBy: { session: { date: "asc" } },
            include: {
              session: { select: { date: true } },
              entries: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
            },
          },
        },
      },
    },
  });
  if (query.halqaId && !classes.length)
    throw new HttpError(404, "الحلقة غير موجودة في التقرير");
  if (query.type === "student" && !classes.some((h) => h.enrollments.length))
    throw new HttpError(404, "الطالب غير موجود في الحلقة المحددة");
  const studentIds = new Map(
    classes.flatMap((h) =>
      h.enrollments.map((e) => [e.id, e.studentId] as const),
    ),
  );
  const baseRows = classes.flatMap((h) =>
    h.enrollments.map((e) => {
      const days = e.dailyStatuses.map((s) => {
        const entries = s.entries.map((x) => ({
          ...x,
          pageAmount: x.pageAmount === null ? null : Number(x.pageAmount),
        }));
        const recorded = !!(
          s.outcome ||
          s.memorizationResult ||
          s.reviewResult ||
          entries.length
        );
        const valid = (x: string | null) =>
          x === "MASTERED" || x === "NOT_MASTERED";
        const assessment =
          s.outcome === "ABSENT"
            ? "ABSENT"
            : valid(s.reviewResult) &&
                (s.reviewOnly || valid(s.memorizationResult))
              ? independentSummary(
                  s.memorizationResult,
                  s.reviewResult,
                  s.reviewOnly,
                )
              : null;
        return {
          date: s.session.date.toISOString().slice(0, 10),
          assessment,
          recorded,
          note: s.note,
          reviewOnly: s.reviewOnly,
          entries,
        };
      });
      const memoryAssessed = e.dailyStatuses.filter(
        (s) =>
          s.outcome !== "ABSENT" &&
          !s.reviewOnly &&
          ["MASTERED", "NOT_MASTERED"].includes(s.memorizationResult ?? ""),
      );
      const reviewAssessed = e.dailyStatuses.filter(
        (s) =>
          s.outcome !== "ABSENT" &&
          ["MASTERED", "NOT_MASTERED"].includes(s.reviewResult ?? ""),
      );
      const assessedDays = days.filter(
        (d) => d.assessment === "MEMORIZED" || d.assessment === "NOT_MEMORIZED",
      ).length;
      const masteredDays = days.filter(
        (d) => d.assessment === "MEMORIZED",
      ).length;
      const absentDates = days
        .filter((d) => d.assessment === "ABSENT")
        .map((d) => d.date);
      const pendingDays = days.filter((d) => d.assessment === null).length;
      const allEntries = days
        .filter((d) => d.assessment !== "ABSENT")
        .flatMap((d) => d.entries);
      const latest = (kind: string) => {
        const entry = allEntries.findLast((x) => x.kind === kind);
        return entry ? rangeText(entry) : null;
      };
      const reasons = reportReasons(
        {
          assessedDays,
          masteredDays,
          absentDays: absentDates.length,
          pendingDays,
        },
        query,
      );
      return {
        enrollmentId: e.id,
        name: e.student.name,
        halqaId: h.id,
        halqaName: h.name,
        teacherName: h.teacher.name,
        reviewOnly: e.reviewOnly,
        active: e.active,
        memoryAssessedDays: memoryAssessed.length,
        memoryMasteredDays: memoryAssessed.filter(
          (s) => s.memorizationResult === "MASTERED",
        ).length,
        reviewAssessedDays: reviewAssessed.length,
        reviewMasteredDays: reviewAssessed.filter(
          (s) => s.reviewResult === "MASTERED",
        ).length,
        recordedDays: days.filter((d) => d.recorded).length,
        assessedDays,
        masteredDays,
        notMasteredDays: assessedDays - masteredDays,
        absentDays: absentDates.length,
        absentDates,
        pendingDays,
        masteryRate: assessedDays
          ? Math.round((masteredDays / assessedDays) * 100)
          : null,
        memoryPages: totalPages(
          allEntries.filter((x) => x.kind === "MEMORIZATION"),
        ),
        reviewPages: totalPages(allEntries.filter((x) => x.kind === "REVIEW")),
        lastMemory: latest("MEMORIZATION"),
        lastReview: latest("REVIEW"),
        latestNote: days.findLast((d) => d.note.trim())?.note ?? "",
        reasons,
        days:
          query.type === "student"
            ? days.map((d) => ({
                ...d,
                entries: d.entries.map((x) => ({
                  kind: x.kind,
                  range: rangeText(x),
                })),
              }))
            : [],
      };
    }),
  );
  // Classification and pupil counts must not split or duplicate a transferred pupil.
  const aggregate = new Map<
    string,
    {
      assessedDays: number;
      masteredDays: number;
      absentDays: number;
      pendingDays: number;
    }
  >();
  for (const row of baseRows) {
    const id = studentIds.get(row.enrollmentId)!;
    const total = aggregate.get(id) ?? {
      assessedDays: 0,
      masteredDays: 0,
      absentDays: 0,
      pendingDays: 0,
    };
    for (const key of [
      "assessedDays",
      "masteredDays",
      "absentDays",
      "pendingDays",
    ] as const)
      total[key] += row[key];
    aggregate.set(id, total);
  }
  const rows = baseRows
    .map((row) => ({
      ...row,
      reasons: reportReasons(
        aggregate.get(studentIds.get(row.enrollmentId)!)!,
        query,
      ),
    }))
    .filter(
      (row) =>
        ["comprehensive", "student"].includes(query.type) ||
        row.reasons.length > 0,
    );
  return {
    query,
    title: reportTitles[query.type],
    criteria:
      reportCriteria(query) +
      (baseRows.length > aggregate.size
        ? " تُجمع أيام الطالب المنتقل عند حساب شروط التقرير، ويُحسب مرة واحدة في إجمالي الطلاب، مع عرض سجله تحت كل حلقة."
        : ""),
    generatedAt: new Date().toISOString(),
    rows,
    summary: {
      students: new Set(rows.map((r) => studentIds.get(r.enrollmentId))).size,
      recordedDays: rows.reduce((n, r) => n + r.recordedDays, 0),
      assessedDays: rows.reduce((n, r) => n + r.assessedDays, 0),
      absentDays: rows.reduce((n, r) => n + r.absentDays, 0),
      pendingDays: rows.reduce((n, r) => n + r.pendingDays, 0),
      memoryPages: rows.reduce((n, r) => n + r.memoryPages, 0),
      reviewPages: rows.reduce((n, r) => n + r.reviewPages, 0),
    },
  };
}
export type SupervisionReport = Awaited<
  ReturnType<typeof getSupervisionReport>
>;
