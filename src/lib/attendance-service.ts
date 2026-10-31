import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { HttpError } from "./auth";
import { calendarKey, dayDate, dayReadOnlyReason, isStudyDay } from "./dates";
import { reportDate } from "./supervision-report-policy";
import { enrollmentIdsOnDate } from "./enrollment-history";
import { carryAbsentAssignment } from "./day-service";
import { schoolClassCompare } from "./report-format";
import { examinedOnDate } from "./exam-service";

export type AttendanceActor = {
  kind: "TEACHER" | "SUPERVISOR";
  id: string;
  name: string;
};
export const attendanceInput = z.object({
  date: reportDate,
  version: z.string().regex(/^[a-f0-9]{64}$/),
  absentIds: z
    .array(z.string().min(1))
    .max(1000)
    .refine((a) => new Set(a).size === a.length),
  requestKey: z.string().uuid(),
});
const excluded = () =>
  (process.env.SUPERVISOR_EXCLUDED_HALQA_IDS ?? "").split(",").filter(Boolean);
const hash = (x: unknown) =>
  createHash("sha256").update(JSON.stringify(x)).digest("hex");
const json = (x: unknown) =>
  JSON.parse(JSON.stringify(x)) as Prisma.InputJsonValue;
export function attendanceState(
  s:
    | {
        outcome: string | null;
        attendance: string | null;
        memorizationResult: string | null;
        reviewResult: string | null;
        entries: { id: string }[];
      }
    | undefined,
): "PRESENT" | "ABSENT" | null {
  if (!s) return null;
  if (s.outcome === "ABSENT") return "ABSENT";
  if (
    s.attendance === "PRESENT" ||
    s.entries.length ||
    s.memorizationResult ||
    s.reviewResult ||
    s.outcome
  )
    return "PRESENT";
  return null;
}
async function read(
  tx: Prisma.TransactionClient,
  actor: AttendanceActor,
  halqaId: string,
  date: string,
  now: Date,
) {
  const h = await tx.halqa.findFirst({
    where: {
      id: halqaId,
      ...(actor.kind === "TEACHER"
        ? { teacherId: actor.id }
        : { NOT: { id: { in: excluded() } } }),
      OR: [
        { attendanceStartsOn: null },
        { attendanceStartsOn: { lte: dayDate(date) } },
      ],
    },
    include: { teacher: { select: { name: true } } },
  });
  if (!h)
    throw new HttpError(404, "الفصل غير موجود أو لم يبدأ تسجيله بهذا التاريخ");
  const roster = await enrollmentIdsOnDate(tx, date, halqaId);
  const enrollments = await tx.enrollment.findMany({
    where: { halqaId, id: { in: [...roster] } },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    include: { student: true },
  });
  const session = await tx.dailySession.findUnique({
    where: { halqaId_date: { halqaId, date: dayDate(date) } },
    include: { statuses: { include: { entries: { select: { id: true } } } } },
  });
  const examined = h.attendanceOnly
    ? new Set<string>()
    : await examinedOnDate(
        tx,
        enrollments.map((e) => e.studentId),
        date,
      );
  const rows = enrollments.map((e) => {
    const s = session?.statuses.find((s) => s.enrollmentId === e.id);
    return {
      id: e.id,
      name: e.student.name,
      state: attendanceState(s),
      updatedAt: s?.updatedAt.toISOString() ?? null,
      hasRecitation: !!s?.entries.length,
      hasExam: examined.has(e.studentId),
    };
  });
  const unknown = rows.filter((r) => r.state === null).length;
  return {
    halqaId: h.id,
    name: h.name,
    teacherName: h.teacher.name,
    attendanceOnly: h.attendanceOnly,
    date,
    students: rows,
    confirmedAt: session?.attendanceConfirmedAt?.toISOString() ?? null,
    recordedBy: session?.attendanceRecordedBy ?? null,
    confirmed: !!session?.attendanceConfirmedAt && !unknown,
    version: hash({
      roster: rows,
      confirmed: session?.attendanceConfirmedAt?.toISOString() ?? null,
    }),
    present: rows.filter((r) => r.state === "PRESENT").length,
    absent: rows.filter((r) => r.state === "ABSENT").length,
    unknown,
    readOnlyReason: dayReadOnlyReason(date, now),
    sessionId: session?.id ?? null,
  };
}
export async function getAttendance(
  actor: AttendanceActor,
  halqaId: string,
  date = calendarKey(),
  now = new Date(),
) {
  reportDate.parse(date);
  if (date > calendarKey(now))
    throw new HttpError(400, "لا يمكن عرض يوم مستقبلي");
  return db.$transaction((tx) => read(tx, actor, halqaId, date, now), {
    isolationLevel: "RepeatableRead",
  });
}
export type AttendanceView = Awaited<ReturnType<typeof getAttendance>>;
export async function confirmAttendance(
  actor: AttendanceActor,
  halqaId: string,
  raw: unknown,
  now = new Date(),
) {
  const m = attendanceInput.parse(raw),
    reason = dayReadOnlyReason(m.date, now);
  if (reason) throw new HttpError(409, reason);
  const payloadHash = hash({
    actor,
    halqaId,
    date: m.date,
    absentIds: [...m.absentIds].sort(),
  });
  try {
    await db.$transaction(
      async (tx) => {
        const replay = await tx.attendanceEdit.findUnique({
          where: { requestKey: m.requestKey },
        });
        if (replay) {
          if (replay.payloadHash !== payloadHash)
            throw new HttpError(409, "طلب الإرسال مستخدم لبيانات أخرى");
          return;
        }
        // Lock the class so confirmation/roster changes cannot race one another.
        await tx.$queryRaw`SELECT id FROM "Halqa" WHERE id = ${halqaId} FOR UPDATE`;
        const before = await read(tx, actor, halqaId, m.date, now);
        if (before.version !== m.version)
          throw new HttpError(
            409,
            "تغير الحضور أو سجل طالب؛ حدّث القائمة قبل الإرسال",
          );
        if (!before.students.length)
          throw new HttpError(409, "لا يوجد طلاب لتأكيد حضورهم");
        const ids = new Set(before.students.map((s) => s.id));
        if (m.absentIds.some((id) => !ids.has(id)))
          throw new HttpError(400, "تضم القائمة طالبًا خارج الفصل");
        const absent = new Set(m.absentIds);
        if (
          before.students.some(
            (s) => absent.has(s.id) && (s.hasRecitation || s.hasExam),
          )
        )
          throw new HttpError(
            409,
            "يوجد تسميع مسجل أو اختبار لطالب اخترته غائبًا؛ راجع اختيارات الغياب",
          );
        const session = await tx.dailySession.upsert({
          where: { halqaId_date: { halqaId, date: dayDate(m.date) } },
          create: { halqaId, date: dayDate(m.date) },
          update: {},
        });
        await tx.$queryRaw`SELECT id FROM "DailySession" WHERE id = ${session.id} FOR UPDATE`;
        const cutoff = dayReadOnlyReason(m.date, now);
        if (cutoff) throw new HttpError(409, cutoff);
        for (const row of before.students) {
          const e = await tx.enrollment.findUniqueOrThrow({
            where: { id: row.id },
          });
          const s = await tx.dailyStudentStatus.upsert({
            where: {
              sessionId_enrollmentId: {
                sessionId: session.id,
                enrollmentId: e.id,
              },
            },
            create: {
              sessionId: session.id,
              enrollmentId: e.id,
              halqaId,
              reviewOnly: e.reviewOnly,
            },
            update: {},
          });
          const isAbsent = absent.has(e.id);
          await tx.dailyStudentStatus.update({
            where: { id: s.id },
            data: {
              attendance: isAbsent ? "ABSENT" : "PRESENT",
              ...(isAbsent
                ? { outcome: "ABSENT" as const }
                : s.outcome === "ABSENT"
                  ? {
                      outcome: null,
                      memorizationResult: null,
                      reviewResult: null,
                    }
                  : {}),
            },
          });
          if (isAbsent && !before.attendanceOnly)
            await carryAbsentAssignment(tx, e.id, m.date, s.reviewOnly);
        }
        await tx.dailySession.update({
          where: { id: session.id },
          data: {
            attendanceConfirmedAt: now,
            attendanceRecordedBy: actor.name,
            ...(!before.attendanceOnly &&
            before.students.some(
              (s) => absent.has(s.id) !== (s.state === "ABSENT"),
            )
              ? { closedAt: null }
              : {}),
          },
        });
        const after = await read(tx, actor, halqaId, m.date, now);
        await tx.attendanceEdit.create({
          data: {
            halqaId,
            date: dayDate(m.date),
            actorKind: actor.kind,
            actorId: actor.id,
            actorName: actor.name,
            requestKey: m.requestKey,
            payloadHash,
            before: json(before),
            after: json(after),
          },
        });
      },
      { isolationLevel: "Serializable", timeout: 15000 },
    );
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      ["P2034", "P2002"].includes(e.code)
    )
      throw new HttpError(
        409,
        "تغير التسجيل أثناء الحفظ؛ حدّث القائمة ثم أعد الإرسال",
      );
    throw e;
  }
  return getAttendance(actor, halqaId, m.date, now);
}
export async function attendanceOverview(
  actor: AttendanceActor,
  date = calendarKey(),
  now = new Date(),
) {
  if (actor.kind !== "SUPERVISOR") throw new HttpError(403, "غير مسموح");
  reportDate.parse(date);
  if (date > calendarKey(now)) throw new HttpError(400, "التاريخ في المستقبل");
  return db.$transaction(
    async (tx) => {
      const ids = await tx.halqa.findMany({
        where: {
          id: { notIn: excluded() },
          OR: [
            { attendanceStartsOn: null },
            { attendanceStartsOn: { lte: dayDate(date) } },
          ],
        },
        select: { id: true },
      });
      const classes = [];
      for (const h of ids) classes.push(await read(tx, actor, h.id, date, now));
      classes.sort(
        (a, b) =>
          Number(a.confirmed) - Number(b.confirmed) || schoolClassCompare(a, b),
      );
      return {
        date,
        today: calendarKey(now),
        studyDay: isStudyDay(date),
        classes,
        summary: {
          students: classes.reduce((n, c) => n + c.students.length, 0),
          present: classes.reduce((n, c) => n + c.present, 0),
          absent: classes.reduce((n, c) => n + c.absent, 0),
          unknown: classes.reduce((n, c) => n + c.unknown, 0),
          submitted: classes.filter((c) => c.confirmed).length,
          total: classes.length,
        },
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 15000 },
  );
}
export type AttendanceOverview = Awaited<ReturnType<typeof attendanceOverview>>;
