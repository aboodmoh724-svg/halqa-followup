import { db } from "./db";
import {
  dayDate,
  dayKey,
  isStudyDay,
  nextAssignmentDay,
  lastFinishedStudyDay,
} from "./dates";
import { enrollmentIdsOnDate } from "./enrollment-history";
import { latestMemoryGap } from "./supervision-gaps";
import { completionNotices } from "./exam-service";
import { schoolClassCompare } from "./report-format";
import { reportIssues, type StudentView } from "./types";
import { totalPages, rangeSchema, type QuranRange } from "./quran";
export type SupervisorAlert = {
  id: string;
  kind: "absence" | "memory" | "review" | "incomplete" | "sequence" | "exam";
  halqaId: string;
  enrollmentId: string;
  studentName: string;
  halqaName: string;
  message: string;
  dates: string[];
};
type StreakDay = {
  date: string;
  outcome: string | null;
  memorizationResult: string | null;
  reviewResult: string | null;
  reviewOnly: boolean;
};
export function studentStreaks(days: StreakDay[]) {
  const sorted = days
    .filter((d) => isStudyDay(d.date))
    .sort((a, b) => b.date.localeCompare(a.date));
  const count = (matches: (d: StreakDay) => boolean) => {
    const dates: string[] = [];
    for (const day of sorted) {
      if (!matches(day)) break;
      dates.push(day.date);
    }
    return dates;
  };
  return {
    absence: count((d) => d.outcome === "ABSENT"),
    memory: count(
      (d) =>
        d.outcome !== "ABSENT" &&
        !d.reviewOnly &&
        d.memorizationResult === "NOT_MASTERED",
    ),
    review: count(
      (d) => d.outcome !== "ABSENT" && d.reviewResult === "NOT_MASTERED",
    ),
  };
}
export async function getSupervisorOverview(date = dayKey(), now = new Date()) {
  const deadlineDate = lastFinishedStudyDay(now);
  const since = dayDate(date);
  since.setUTCDate(since.getUTCDate() - 29);
  const weekly = dayDate(date);
  weekly.setUTCDate(weekly.getUTCDate() - 6);
  const excluded = (process.env.SUPERVISOR_EXCLUDED_HALQA_IDS ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const halqas = await db.halqa.findMany({
    where: { attendanceOnly: false, id: { notIn: excluded } },
    select: {
      id: true,
      name: true,
      teacher: { select: { name: true } },
      enrollments: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          studentId: true,
          active: true,
          reviewOnly: true,
          student: { select: { name: true } },
        },
      },
      days: {
        where: { date: { gte: since, lte: dayDate(date) } },
        orderBy: { date: "desc" },
        include: {
          statuses: {
            include: {
              entries: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
            },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });
  halqas.sort(schoolClassCompare);
  // Follow the pupil across classes for streaks and sequence advice, while class
  // totals keep each original day's class rather than relabelling history.
  const pupilHistory = await db.dailyStudentStatus.findMany({
    where: {
      enrollment: {
        studentId: {
          in: halqas.flatMap((h) => h.enrollments.map((e) => e.studentId)),
        },
      },
      session: { date: { gte: since, lte: dayDate(date) } },
    },
    include: {
      enrollment: { select: { studentId: true } },
      session: { select: { date: true } },
      entries: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
  });
  const alerts: SupervisorAlert[] = [];
  const classes = halqas
    .map((h) => ({ ...h, enrollments: h.enrollments.filter((e) => e.active) }))
    .filter((h) => h.enrollments.length > 0)
    .map((h) => {
      const today = h.days.find(
        (d) => d.date.toISOString().slice(0, 10) === date,
      );
      const students = h.enrollments.map((e) => {
        const current = today?.statuses.find((s) => s.enrollmentId === e.id);
        const recorded = pupilHistory
          .filter(
            (s) =>
              s.enrollment.studentId === e.studentId &&
              (s.outcome ||
                s.memorizationResult ||
                s.reviewResult ||
                s.entries.length),
          )
          .map((s) => ({
            ...s,
            date: s.session.date.toISOString().slice(0, 10),
          }))
          .sort((a, b) => b.date.localeCompare(a.date));
        const streaks = studentStreaks(recorded);
        const gap = !e.reviewOnly
          ? latestMemoryGap(
              [...recorded]
                .reverse()
                .flatMap((d) =>
                  d.entries
                    .filter(
                      (x) =>
                        x.kind === "MEMORIZATION" && d.outcome !== "ABSENT",
                    )
                    .map((x) => ({ id: x.id, date: d.date, range: x })),
                ),
            )
          : null;
        if (gap)
          alerts.push({
            id: `${e.id}:sequence:${gap.entryId}`,
            kind: "sequence",
            halqaId: h.id,
            enrollmentId: e.id,
            studentName: e.student.name,
            halqaName: h.name,
            message: gap.message,
            dates: gap.dates,
          });
        for (const kind of ["absence", "memory", "review"] as const) {
          const dates = streaks[kind];
          if (dates.length < 3) continue;
          alerts.push({
            id: `${e.id}:${kind}`,
            kind,
            halqaId: h.id,
            enrollmentId: e.id,
            studentName: e.student.name,
            halqaName: h.name,
            dates,
            message:
              kind === "absence"
                ? `غائب في ${dates.length} أيام مسجلة متتالية`
                : `غير حافظ ${kind === "memory" ? "الحفظ الجديد" : "المراجعة"} في ${dates.length} أيام مسجلة متتالية`,
          });
        }
        const last = recorded[0];
        if (
          last &&
          (last.date < date || today?.closedAt) &&
          last.outcome !== "ABSENT" &&
          last.entries.some((x) => x.kind === "MEMORIZATION") &&
          !last.reviewResult
        )
          alerts.push({
            id: `${e.id}:incomplete`,
            kind: "incomplete",
            halqaId: h.id,
            enrollmentId: e.id,
            studentName: e.student.name,
            halqaName: h.name,
            dates: [last.date],
            message: "حفظ مسجل بلا نتيجة للمراجعة؛ تحقق من اكتمال التسجيل",
          });
        const entries =
          current?.entries.map((x) => ({
            ...x,
            createdAt: x.createdAt.toISOString(),
            pageAmount: x.pageAmount === null ? null : Number(x.pageAmount),
          })) ?? [];
        // For today's completeness, use the same rules as the teacher, including homework.
        return {
          id: e.id,
          name: e.student.name,
          reviewOnly: e.reviewOnly,
          outcome: current?.outcome ?? null,
          memorizationResult: current?.memorizationResult ?? null,
          reviewResult: current?.reviewResult ?? null,
          note: current?.note ?? "",
          entries,
          recorded:
            !!current &&
            !!(
              current.outcome ||
              current.memorizationResult ||
              current.reviewResult ||
              current.entries.length ||
              current.note
            ),
          lastRecorded: recorded[0]?.date ?? null,
        };
      });
      return {
        id: h.id,
        name: h.name,
        teacherName: h.teacher.name,
        closedAt: today?.closedAt?.toISOString() ?? null,
        students,
        recorded: students.filter((s) => s.recorded).length,
        week: period(h.days.filter((d) => d.date >= weekly)),
        month: period(h.days),
      };
    });
  // Query assignments in one batch; supervision must never call ensureDay.
  const assignments = await db.assignment.findMany({
    where: {
      enrollmentId: { in: classes.flatMap((h) => h.students.map((s) => s.id)) },
      dueDate: dayDate(nextAssignmentDay(date)),
    },
  });
  const mapped = classes.map((h) => {
    const students = h.students.map((s) => {
      const a = assignments.find((a) => a.enrollmentId === s.id);
      const parse = (v: unknown): QuranRange | null => {
        const r = rangeSchema.safeParse(v);
        return r.success ? r.data : null;
      };
      const missing = reportIssues({
        ...s,
        enrollmentId: s.id,
        today: null,
        tomorrow: a
          ? {
              id: a.id,
              memorization: parse(a.memorization),
              review: parse(a.review),
              note: a.note,
              imageName: a.imageName,
            }
          : null,
      } as StudentView);
      return { ...s, missing };
    });
    const complete = students.filter((s) => !s.missing.length).length;
    return {
      ...h,
      students,
      complete,
      state:
        complete === students.length
          ? h.closedAt
            ? "submitted"
            : "complete"
          : h.recorded
            ? "progress"
            : "not-started",
    };
  });
  // Deadline checks read only completed school days, including Friday on a
  // weekend. Avoid retroactive alerts before the school first used the system.
  const first = await db.dailySession.aggregate({
    where: { halqaId: { in: halqas.map((h) => h.id) } },
    _min: { date: true },
  });
  const followupDate =
    deadlineDate < date ? deadlineDate : isStudyDay(date) ? date : deadlineDate;
  const followupRoster = await enrollmentIdsOnDate(db, followupDate);
  const dueAssignments =
    first._min.date && first._min.date <= dayDate(followupDate)
      ? await db.assignment.findMany({
          where: {
            enrollment: {
              studentId: {
                in: halqas.flatMap((h) =>
                  h.enrollments
                    .filter((e) => followupRoster.has(e.id))
                    .map((e) => e.studentId),
                ),
              },
            },
            dueDate: dayDate(nextAssignmentDay(followupDate)),
          },
          include: { enrollment: { select: { studentId: true } } },
          orderBy: [
            { enrollment: { active: "desc" } },
            { updatedAt: "desc" },
            { id: "asc" },
          ],
        })
      : [];
  const recordingAlerts =
    first._min.date &&
    first._min.date <= dayDate(followupDate) &&
    followupDate <= deadlineDate
      ? halqas.flatMap((original) => {
          const h = {
            ...original,
            enrollments: original.enrollments.filter((e) =>
              followupRoster.has(e.id),
            ),
          };
          if (!h.enrollments.length) return [];
          const session = h.days.find(
            (d) => d.date.toISOString().slice(0, 10) === followupDate,
          );
          let recorded = 0;
          const missing = h.enrollments.flatMap((e) => {
            const status = session?.statuses.find(
              (s) => s.enrollmentId === e.id,
            );
            if (
              status &&
              (status.outcome ||
                status.memorizationResult ||
                status.reviewResult ||
                status.entries.length ||
                status.note)
            )
              recorded++;
            const a = dueAssignments.find(
              (a) => a.enrollment.studentId === e.studentId,
            );
            const parse = (v: unknown) => {
              const p = rangeSchema.safeParse(v);
              return p.success ? p.data : null;
            };
            const issues = reportIssues({
              enrollmentId: e.id,
              name: e.student.name,
              reviewOnly: status?.reviewOnly ?? e.reviewOnly,
              outcome: status?.outcome ?? null,
              memorizationResult: status?.memorizationResult,
              reviewResult: status?.reviewResult,
              note: status?.note ?? "",
              today: null,
              entries: status?.entries ?? [],
              tomorrow: a
                ? {
                    id: a.id,
                    memorization: parse(a.memorization),
                    review: parse(a.review),
                    note: a.note,
                    imageName: a.imageName,
                  }
                : null,
            } as unknown as StudentView);
            return issues.length
              ? [{ enrollmentId: e.id, name: e.student.name, issues }]
              : [];
          });
          return missing.length
            ? [
                {
                  id: `${h.id}:${followupDate}`,
                  halqaId: h.id,
                  halqaName: h.name,
                  teacherName: h.teacher.name,
                  date: followupDate,
                  kind: recorded ? "incomplete" : "not-started",
                  missing,
                  total: h.enrollments.length,
                },
              ]
            : [];
        })
      : [];
  const notices = await completionNotices(
    db,
    halqas.flatMap((h) =>
      h.enrollments
        .filter((e) => e.active && !e.reviewOnly)
        .map((e) => e.studentId),
    ),
    date,
  );
  for (const h of halqas)
    for (const e of h.enrollments.filter((e) => e.active && !e.reviewOnly)) {
      for (const [i, message] of (notices.get(e.studentId) ?? []).entries())
        alerts.push({
          id: `${e.id}:exam:${i}`,
          kind: "exam",
          halqaId: h.id,
          enrollmentId: e.id,
          studentName: e.student.name,
          halqaName: h.name,
          message,
          dates: [],
        });
    }
  return {
    date,
    classes: mapped,
    alerts,
    recordingAlerts,
    deadlineDate: followupDate,
    totalStudents: mapped.reduce((n, h) => n + h.students.length, 0),
  };
}
function period(
  days: {
    statuses: {
      outcome: string | null;
      entries: {
        kind: string;
        pageAmount: unknown;
        pageMappingVersion: string | null;
        startSurah: number;
        startAyah: number;
        endSurah: number;
        endAyah: number;
        direction: "FORWARD" | "REVERSE";
      }[];
    }[];
  }[],
) {
  const statuses = days.flatMap((d) => d.statuses);
  const entries = statuses
    .filter((s) => s.outcome !== "ABSENT")
    .flatMap((s) => s.entries)
    .map((e) => ({
      ...e,
      pageAmount: e.pageAmount === null ? null : Number(e.pageAmount),
    }));
  return {
    days: days.length,
    mastered: statuses.filter((s) => s.outcome === "MEMORIZED").length,
    notMastered: statuses.filter((s) => s.outcome === "NOT_MEMORIZED").length,
    absent: statuses.filter((s) => s.outcome === "ABSENT").length,
    memoryPages: totalPages(entries.filter((e) => e.kind === "MEMORIZATION")),
    reviewPages: totalPages(entries.filter((e) => e.kind === "REVIEW")),
  };
}
export type SupervisorOverview = Awaited<
  ReturnType<typeof getSupervisorOverview>
>;
