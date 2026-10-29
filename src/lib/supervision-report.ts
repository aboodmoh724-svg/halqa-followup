import {
  memoryDayEvidence,
  weeklyMinimumPages,
  weeklySupportReason,
} from "./weekly-support-policy";
import { roundPages } from "./madani";
import { db } from "./db";
import { HttpError } from "./auth";
import {
  dayDate,
  dayKey,
  isStudyDay,
  nextDay,
  nextAssignmentDay,
} from "./dates";
import { schoolClassCompare } from "./report-format";
import { enrollmentIdsAtDate } from "./enrollment-history";
import { independentSummary, reportIssues } from "./types";
import { totalPages, rangeText, rangeSchema } from "./quran";
import {
  supervisionReportQuery,
  reportReasons,
  reportCriteria,
  reportTitles,
} from "./supervision-report-policy";
export async function getSupervisionReport(raw: unknown) {
  const parsed = supervisionReportQuery.parse(raw);
  const query =
    parsed.type === "comprehensive"
      ? { ...parsed, halqaId: undefined, enrollmentId: undefined }
      : parsed.type === "support"
        ? { ...parsed, enrollmentId: undefined }
        : parsed;
  if (query.to > dayKey())
    throw new HttpError(400, "لا يمكن إصدار تقرير بتاريخ مستقبلي");
  return db.$transaction(
    async (tx) => {
      const bounds = { gte: dayDate(query.from), lte: dayDate(query.to) };
      const excluded = (process.env.SUPERVISOR_EXCLUDED_HALQA_IDS ?? "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      const selectedStudent =
        query.type === "student"
          ? await tx.enrollment.findFirst({
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
      const classes = await tx.halqa.findMany({
        where: {
          id: {
            notIn: excluded,
            ...(query.halqaId && !selectedStudent && query.type !== "support"
              ? { equals: query.halqaId }
              : {}),
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
                  session: { select: { date: true, closedAt: true } },
                  entries: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
                },
              },
            },
          },
        },
      });
      classes.sort(schoolClassCompare);
      if (query.halqaId && !classes.some((h) => h.id === query.halqaId))
        throw new HttpError(404, "الحلقة غير موجودة في التقرير");
      if (
        query.type === "student" &&
        !classes.some((h) => h.enrollments.length)
      )
        throw new HttpError(404, "الطالب غير موجود في الحلقة المحددة");
      const studentIds = new Map(
        classes.flatMap((h) =>
          h.enrollments.map((e) => [e.id, e.studentId] as const),
        ),
      );
      const studyDates: string[] = [];
      for (let date = query.from; date <= query.to; date = nextDay(date))
        if (isStudyDay(date)) studyDates.push(date);
      const active = await tx.enrollment.findMany({
        where: { active: true },
        select: { id: true, studentId: true },
      });
      const transfers = await tx.studentTransfer.findMany({
        select: { studentId: true, sourceEnrollmentId: true, createdAt: true },
        orderBy: { sequence: "desc" },
      });
      const rosters = new Map(
        studyDates.map((date) => [
          date,
          enrollmentIdsAtDate(active, transfers, date),
        ]),
      );
      const homework = await tx.assignment.findMany({
        where: {
          enrollment: { studentId: { in: [...studentIds.values()] } },
          dueDate: {
            in: [
              ...new Set(
                classes.flatMap((h) =>
                  h.enrollments.flatMap((e) =>
                    e.dailyStatuses.map((s) =>
                      nextAssignmentDay(
                        s.session.date.toISOString().slice(0, 10),
                      ),
                    ),
                  ),
                ),
              ),
            ].map(dayDate),
          },
        },
        include: { enrollment: { select: { studentId: true } } },
        orderBy: [
          { enrollment: { active: "desc" } },
          { updatedAt: "desc" },
          { id: "asc" },
        ],
      });
      const asRange = (value: unknown) => {
        const result = rangeSchema.safeParse(value);
        return result.success ? result.data : null;
      };
      const baseRows = classes.flatMap((h) =>
        h.enrollments.map((e) => {
          const expectedDates = studyDates.filter(
            (date) =>
              rosters.get(date)!.has(e.id) ||
              e.dailyStatuses.some(
                (s) => s.session.date.toISOString().slice(0, 10) === date,
              ),
          );
          const days = e.dailyStatuses.map((s) => {
            const entries = s.entries.map((x) => ({
              ...x,
              pageAmount: x.pageAmount === null ? null : Number(x.pageAmount),
            }));
            const recorded = !!(
              s.outcome ||
              s.memorizationResult ||
              s.reviewResult ||
              entries.length ||
              s.note
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
            const date = s.session.date.toISOString().slice(0, 10);
            const duty = homework.find(
              (a) =>
                a.enrollment.studentId === e.studentId &&
                a.dueDate.toISOString().slice(0, 10) ===
                  nextAssignmentDay(date),
            );
            const completed =
              reportIssues(
                {
                  enrollmentId: e.id,
                  name: e.student.name,
                  reviewOnly: s.reviewOnly,
                  outcome: s.outcome,
                  memorizationResult: s.memorizationResult,
                  reviewResult: s.reviewResult,
                  note: s.note,
                  entries: s.entries.map((x) => ({
                    ...x,
                    createdAt: x.createdAt.toISOString(),
                    pageAmount:
                      x.pageAmount === null ? null : Number(x.pageAmount),
                  })),
                  today: null,
                  tomorrow: duty
                    ? {
                        id: duty.id,
                        memorization: asRange(duty.memorization),
                        review: asRange(duty.review),
                        note: duty.note,
                        imageName: duty.imageName,
                      }
                    : null,
                },
                !!s.session.closedAt,
              ).length === 0;
            return {
              date: s.session.date.toISOString().slice(0, 10),
              assessment,
              recorded,
              completed,
              present:
                s.outcome === "MEMORIZED" ||
                s.outcome === "NOT_MEMORIZED" ||
                (s.outcome !== "ABSENT" &&
                  (valid(s.memorizationResult) ||
                    valid(s.reviewResult) ||
                    entries.length > 0)),
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
            (d) =>
              d.assessment === "MEMORIZED" || d.assessment === "NOT_MEMORIZED",
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
          const memoryEvidence = e.dailyStatuses.map((s) => ({
            date: s.session.date.toISOString().slice(0, 10),
            ...memoryDayEvidence(s),
          }));
          return {
            masteredMemoryPages: roundPages(
              memoryEvidence
                .filter((d) => studyDates.includes(d.date))
                .reduce((n, d) => n + d.pages, 0),
            ),
            memoryEvidenceDates: memoryEvidence
              .filter((d) => d.known && expectedDates.includes(d.date))
              .map((d) => d.date),
            weeklyMinimumPages: null as 2 | 5 | null,
            expectedStudyDays: expectedDates.length,
            recordedStudyDays: days.filter(
              (d) => expectedDates.includes(d.date) && d.recorded,
            ).length,
            completedStudyDays: days.filter(
              (d) => expectedDates.includes(d.date) && d.completed,
            ).length,
            missingStudyDays: expectedDates.filter(
              (date) => !days.some((d) => d.date === date && d.recorded),
            ).length,
            enrollmentId: e.id,
            historyEnrollmentId: e.id,
            historyHalqaId: h.id,
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
            presentDays: days.filter((d) => d.present).length,
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
            reviewPages: totalPages(
              allEntries.filter((x) => x.kind === "REVIEW"),
            ),
            lastMemory: latest("MEMORIZATION"),
            lastReview: latest("REVIEW"),
            weeklyNotes: days
              .filter((d) => d.note.trim())
              .map((d) => ({ date: d.date, note: d.note })),
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
      const eligibleRows = baseRows.filter(
        (r) => r.expectedStudyDays > 0 || r.recordedDays > 0,
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
      for (const row of eligibleRows) {
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
      let rows = eligibleRows
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
      let supportUnassessedCount = 0;
      if (query.type === "support") {
        const endRoster = rosters.get(query.to)!;
        const grouped = new Map<string, typeof eligibleRows>();
        for (const row of eligibleRows) {
          const id = studentIds.get(row.enrollmentId)!;
          grouped.set(id, [...(grouped.get(id) ?? []), row]);
        }
        rows = [];
        for (const group of grouped.values()) {
          const end = group.find((r) => endRoster.has(r.enrollmentId));
          if (!end || (query.halqaId && end.halqaId !== query.halqaId))
            continue;
          if (end.reviewOnly) continue;
          const minimum = weeklyMinimumPages(end.halqaName),
            known = new Set(group.flatMap((r) => r.memoryEvidenceDates));
          if (minimum === null || studyDates.some((d) => !known.has(d))) {
            supportUnassessedCount++;
            continue;
          }
          const mastered = roundPages(
            group.reduce((n, r) => n + r.masteredMemoryPages, 0),
          );
          const reason = weeklySupportReason(mastered, minimum);
          if (!reason) continue;
          const merged = { ...end };
          const current = baseRows.find(
            (r) =>
              r.active &&
              studentIds.get(r.enrollmentId) ===
                studentIds.get(end.enrollmentId),
          );
          if (current) {
            merged.historyEnrollmentId = current.enrollmentId;
            merged.historyHalqaId = current.halqaId;
          }
          for (const key of [
            "expectedStudyDays",
            "recordedStudyDays",
            "completedStudyDays",
            "missingStudyDays",
            "memoryAssessedDays",
            "memoryMasteredDays",
            "reviewAssessedDays",
            "reviewMasteredDays",
            "recordedDays",
            "presentDays",
            "assessedDays",
            "masteredDays",
            "notMasteredDays",
            "absentDays",
            "pendingDays",
            "memoryPages",
            "reviewPages",
          ] as const)
            merged[key] = group.reduce((n, r) => n + r[key], 0);
          merged.masteredMemoryPages = mastered;
          merged.weeklyMinimumPages = minimum;
          merged.memoryEvidenceDates = [...known].sort();
          merged.absentDates = [
            ...new Set(group.flatMap((r) => r.absentDates)),
          ].sort();
          merged.weeklyNotes = group
            .flatMap((r) => r.weeklyNotes)
            .sort((a, b) => a.date.localeCompare(b.date));
          merged.latestNote = merged.weeklyNotes.at(-1)?.note ?? "";
          merged.masteryRate = merged.assessedDays
            ? Math.round((merged.masteredDays / merged.assessedDays) * 100)
            : null;
          rows.push({ ...merged, reasons: [reason] });
        }
      }
      const sum = (
        items: typeof rows,
        key:
          | "expectedStudyDays"
          | "recordedStudyDays"
          | "completedStudyDays"
          | "missingStudyDays"
          | "memoryAssessedDays"
          | "memoryMasteredDays"
          | "reviewAssessedDays"
          | "reviewMasteredDays"
          | "absentDays"
          | "recordedDays"
          | "presentDays"
          | "masteredMemoryPages"
          | "memoryPages"
          | "reviewPages",
      ) => items.reduce((n, r) => n + r[key], 0);
      const classSummaries = classes
        .filter(
          (h) =>
            query.type === "comprehensive" ||
            rows.some((r) => r.halqaId === h.id),
        )
        .map((h) => {
          const items = rows.filter((r) => r.halqaId === h.id);
          return {
            id: h.id,
            name: h.name,
            teacherName: h.teacher.name,
            students: new Set(items.map((r) => studentIds.get(r.enrollmentId)))
              .size,
            expectedStudyDays: sum(items, "expectedStudyDays"),
            recordedStudyDays: sum(items, "recordedStudyDays"),
            completedStudyDays: sum(items, "completedStudyDays"),
            missingStudyDays: sum(items, "missingStudyDays"),
            memoryAssessedDays: sum(items, "memoryAssessedDays"),
            memoryMasteredDays: sum(items, "memoryMasteredDays"),
            reviewAssessedDays: sum(items, "reviewAssessedDays"),
            reviewMasteredDays: sum(items, "reviewMasteredDays"),
            absentDays: sum(items, "absentDays"),
            recordedDays: sum(items, "recordedDays"),
            memoryPages: sum(items, "memoryPages"),
            reviewPages: sum(items, "reviewPages"),
          };
        });
      return {
        query,
        title:
          query.type === "comprehensive" &&
          studyDates.length === 5 &&
          new Date(query.from + "T00:00:00Z").getUTCDay() === 1 &&
          (Date.parse(query.to) - Date.parse(query.from)) / 86400000 === 4
            ? "التقرير الأسبوعي الموحد"
            : reportTitles[query.type],
        criteria:
          reportCriteria(query) +
          (baseRows.length > aggregate.size
            ? " تُجمع أيام الطالب المنتقل عند حساب شروط التقرير، ويُحسب مرة واحدة في إجمالي الطلاب، مع عرض سجله تحت كل حلقة."
            : ""),
        generatedAt: new Date().toISOString(),
        rows,
        classes: classSummaries,
        studyDays: studyDates.length,
        supportUnassessedCount,
        summary: {
          expectedStudyDays: sum(rows, "expectedStudyDays"),
          recordedStudyDays: sum(rows, "recordedStudyDays"),
          completedStudyDays: sum(rows, "completedStudyDays"),
          missingStudyDays: sum(rows, "missingStudyDays"),
          presentDays: sum(rows, "presentDays"),
          memoryAssessedDays: sum(rows, "memoryAssessedDays"),
          memoryMasteredDays: sum(rows, "memoryMasteredDays"),
          reviewAssessedDays: sum(rows, "reviewAssessedDays"),
          reviewMasteredDays: sum(rows, "reviewMasteredDays"),
          students: new Set(rows.map((r) => studentIds.get(r.enrollmentId)))
            .size,
          recordedDays: rows.reduce((n, r) => n + r.recordedDays, 0),
          assessedDays: rows.reduce((n, r) => n + r.assessedDays, 0),
          absentDays: rows.reduce((n, r) => n + r.absentDays, 0),
          pendingDays: rows.reduce((n, r) => n + r.pendingDays, 0),
          masteredMemoryPages: sum(rows, "masteredMemoryPages"),
          memoryPages: rows.reduce((n, r) => n + r.memoryPages, 0),
          reviewPages: rows.reduce((n, r) => n + r.reviewPages, 0),
        },
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 15000 },
  );
}
export type SupervisionReport = Awaited<
  ReturnType<typeof getSupervisionReport>
>;
