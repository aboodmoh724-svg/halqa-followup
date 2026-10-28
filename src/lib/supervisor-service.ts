import { db } from "./db";
import { dayDate, dayKey } from "./dates";
import { reportIssues, type StudentView } from "./types";
import { totalPages, rangeSchema, type QuranRange } from "./quran";
export type SupervisorAlert = {
  id: string;
  kind: "absence" | "memory" | "review" | "incomplete";
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
  const sorted = [...days].sort((a, b) => b.date.localeCompare(a.date));
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
export async function getSupervisorOverview(date = dayKey()) {
  const since = dayDate(date);
  since.setUTCDate(since.getUTCDate() - 29);
  const weekly = dayDate(date);
  weekly.setUTCDate(weekly.getUTCDate() - 6);
  const excluded = (process.env.SUPERVISOR_EXCLUDED_HALQA_IDS ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const halqas = await db.halqa.findMany({
    where: { id: { notIn: excluded } },
    select: {
      id: true,
      name: true,
      teacher: { select: { name: true } },
      enrollments: {
        where: { active: true },
        orderBy: { position: "asc" },
        select: {
          id: true,
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
  const alerts: SupervisorAlert[] = [];
  const classes = halqas
    .filter((h) => h.enrollments.length > 0)
    .map((h) => {
      const today = h.days.find(
        (d) => d.date.toISOString().slice(0, 10) === date,
      );
      const students = h.enrollments.map((e) => {
        const current = today?.statuses.find((s) => s.enrollmentId === e.id);
        const recorded = h.days.flatMap((d) => {
          const s = d.statuses.find((s) => s.enrollmentId === e.id);
          return s &&
            (s.outcome ||
              s.memorizationResult ||
              s.reviewResult ||
              s.entries.length)
            ? [{ ...s, date: d.date.toISOString().slice(0, 10) }]
            : [];
        });
        const streaks = studentStreaks(recorded);
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
      dueDate: new Date(dayDate(date).getTime() + 86400000),
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
  return {
    date,
    classes: mapped,
    alerts,
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
