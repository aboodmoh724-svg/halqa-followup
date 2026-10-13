import { Prisma } from "@prisma/client";
import { db } from "./db";
import { HttpError } from "./auth";
import { dayDate, dayKey, nextDay } from "./dates";
import { mutationSchema, type DayView, type AssignmentView } from "./types";
import { rangeSchema } from "./quran";
async function serial<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let i = 0; i < 3; i++) {
    try {
      return await db.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (e) {
      if (
        !(e instanceof Prisma.PrismaClientKnownRequestError) ||
        e.code !== "P2034" ||
        i === 2
      )
        throw e;
    }
  }
  throw new Error("Transaction retry exhausted");
}
export async function ensureDay(
  teacherId: string,
  halqaId: string,
  date = dayKey(),
) {
  return serial(async (tx) => {
    const halqa = await tx.halqa.findFirst({
      where: { id: halqaId, teacherId },
      include: { enrollments: { where: { active: true } } },
    });
    if (!halqa) throw new HttpError(404, "الحلقة غير موجودة");
    const session = await tx.dailySession.upsert({
      where: { halqaId_date: { halqaId, date: dayDate(date) } },
      create: { halqaId, date: dayDate(date) },
      update: {},
    });
    await tx.$queryRaw`SELECT id FROM "DailySession" WHERE id = ${session.id} FOR UPDATE`;
    if (!session.closedAt)
      await tx.dailyStudentStatus.createMany({
        data: halqa.enrollments.map((e) => ({
          sessionId: session.id,
          enrollmentId: e.id,
          halqaId,
        })),
        skipDuplicates: true,
      });
    return session;
  });
}
function assignmentView(
  a:
    | {
        id: string;
        memorization: Prisma.JsonValue;
        review: Prisma.JsonValue;
        note: string;
        imageName: string;
      }
    | undefined,
): AssignmentView | null {
  return a
    ? {
        id: a.id,
        memorization: a.memorization ? rangeSchema.parse(a.memorization) : null,
        review: a.review ? rangeSchema.parse(a.review) : null,
        note: a.note,
        imageName: a.imageName,
      }
    : null;
}
export async function getDay(
  teacherId: string,
  halqaId: string,
  date = dayKey(),
): Promise<DayView> {
  const session = await db.dailySession.findFirst({
    where: { halqaId, date: dayDate(date), halqa: { teacherId } },
    include: {
      halqa: { include: { teacher: true } },
      statuses: {
        include: {
          entries: { orderBy: { createdAt: "asc" } },
          enrollment: {
            include: {
              student: true,
              assignments: {
                where: {
                  dueDate: { in: [dayDate(date), dayDate(nextDay(date))] },
                },
              },
            },
          },
        },
        orderBy: { enrollment: { position: "asc" } },
      },
    },
  });
  if (!session) throw new HttpError(404, "لم يبدأ يوم الحلقة");
  return {
    halqaId,
    halqaName: session.halqa.name,
    teacherName: session.halqa.teacher.name,
    date,
    timezone: process.env.APP_TIMEZONE || "Europe/Istanbul",
    closedAt: session.closedAt?.toISOString() ?? null,
    students: session.statuses.map((s) => ({
      enrollmentId: s.enrollmentId,
      name: s.enrollment.student.name,
      outcome: s.outcome,
      note: s.note,
      entries: s.entries.map((e) => ({
        id: e.id,
        kind: e.kind,
        startSurah: e.startSurah,
        startAyah: e.startAyah,
        endSurah: e.endSurah,
        endAyah: e.endAyah,
        createdAt: e.createdAt.toISOString(),
      })),
      today: assignmentView(
        s.enrollment.assignments.find(
          (a) => a.dueDate.toISOString().slice(0, 10) === date,
        ),
      ),
      tomorrow: assignmentView(
        s.enrollment.assignments.find(
          (a) => a.dueDate.toISOString().slice(0, 10) === nextDay(date),
        ),
      ),
    })),
  };
}
export async function mutateDay(
  teacherId: string,
  halqaId: string,
  input: unknown,
) {
  const m = mutationSchema.parse(input);
  if (m.date !== dayKey())
    throw new HttpError(409, "تغير اليوم. حدّث الصفحة قبل التسجيل");
  const session = await ensureDay(teacherId, halqaId);
  await serial(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "DailySession" WHERE id = ${session.id} FOR UPDATE`;
    const current = await tx.dailySession.findUniqueOrThrow({
      where: { id: session.id },
    });
    if (current.closedAt) throw new HttpError(409, "تم إنهاء يوم الحلقة");
    if (m.action === "close") {
      const pending = await tx.dailyStudentStatus.count({
        where: { sessionId: session.id, outcome: null },
      });
      if (pending)
        throw new HttpError(409, `بقي ${pending} طالب بدون نتيجة نهائية`);
      await tx.dailySession.update({
        where: { id: session.id },
        data: { closedAt: new Date() },
      });
      return;
    }
    const status = await tx.dailyStudentStatus.findFirst({
      where: { sessionId: session.id, enrollmentId: m.enrollmentId, halqaId },
      include: { entries: true },
    });
    if (!status) throw new HttpError(404, "الطالب غير موجود في هذه الحلقة");
    if (m.action === "entry") {
      if (status.outcome === "ABSENT")
        throw new HttpError(409, "ألغِ الغياب أولًا قبل التسميع");
      const existing = await tx.recitationEntry.findUnique({
        where: { requestKey: m.requestKey },
      });
      if (existing) {
        if (
          existing.dailyStatusId !== status.id ||
          existing.kind !== m.kind ||
          existing.startSurah !== m.range.startSurah ||
          existing.startAyah !== m.range.startAyah ||
          existing.endSurah !== m.range.endSurah ||
          existing.endAyah !== m.range.endAyah
        )
          throw new HttpError(409, "طلب مكرر غير صحيح");
        return;
      }
      await tx.recitationEntry.create({
        data: {
          dailyStatusId: status.id,
          kind: m.kind,
          ...m.range,
          requestKey: m.requestKey,
        },
      });
    }
    if (m.action === "status") {
      if (m.outcome === "ABSENT" && status.entries.length)
        throw new HttpError(409, "يوجد تسميع اليوم؛ اختر حفظ أو لم يحفظ");
      await tx.dailyStudentStatus.update({
        where: { id: status.id },
        data: { outcome: m.outcome, note: m.note },
      });
      if (m.carry && m.outcome === "ABSENT") {
        const today = await tx.assignment.findUnique({
          where: {
            enrollmentId_dueDate: {
              enrollmentId: m.enrollmentId,
              dueDate: dayDate(m.date),
            },
          },
        });
        if (today)
          await tx.assignment.upsert({
            where: {
              enrollmentId_dueDate: {
                enrollmentId: m.enrollmentId,
                dueDate: dayDate(nextDay(m.date)),
              },
            },
            update: {},
            create: {
              enrollmentId: m.enrollmentId,
              dueDate: dayDate(nextDay(m.date)),
              memorization: today.memorization ?? Prisma.DbNull,
              review: today.review ?? Prisma.DbNull,
              note: today.note,
              imageName: today.imageName,
              carriedFromId: today.id,
            },
          });
      }
    }
    if (m.action === "assignment") {
      const data = {
        memorization: m.memorization ?? Prisma.DbNull,
        review: m.review ?? Prisma.DbNull,
        note: m.note.trim(),
        imageName: m.imageName.trim(),
        carriedFromId: null,
      };
      await tx.assignment.upsert({
        where: {
          enrollmentId_dueDate: {
            enrollmentId: m.enrollmentId,
            dueDate: dayDate(nextDay(m.date)),
          },
        },
        create: {
          enrollmentId: m.enrollmentId,
          dueDate: dayDate(nextDay(m.date)),
          ...data,
        },
        update: data,
      });
    }
  });
  return getDay(teacherId, halqaId);
}
