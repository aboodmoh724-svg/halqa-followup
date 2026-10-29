import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import { HttpError } from "./auth";
import { dayDate, dayKey, nextAssignmentDay } from "./dates";
import { rangeSchema, pageAmount } from "./quran";
import { independentSummary } from "./types";
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = dayDate(v);
    return (
      !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && v <= dayKey()
    );
  });
const base = { date: dateSchema, version: z.string().length(64) };
export const correctionSchema = z.discriminatedUnion("action", [
  z.object({
    ...base,
    action: z.literal("entry"),
    entryId: z.string().min(1),
    range: rangeSchema,
  }),
  z.object({
    ...base,
    action: z.literal("result"),
    kind: z.enum(["MEMORIZATION", "REVIEW"]),
    result: z.enum(["MASTERED", "NOT_MASTERED"]),
  }),
  z.object({ ...base, action: z.literal("note"), note: z.string().max(500) }),
  z.object({ ...base, action: z.literal("attendance"), absent: z.boolean() }),
  z.object({
    ...base,
    action: z.literal("assignment"),
    memorization: rangeSchema.nullable(),
    review: rangeSchema.nullable(),
    note: z.string().max(500),
    imageName: z.string().max(100),
  }),
]);
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
async function read(
  tx: Prisma.TransactionClient,
  halqaId: string,
  enrollmentId: string,
  date: string,
) {
  const status = await tx.dailyStudentStatus.findFirst({
    where: { halqaId, enrollmentId, session: { date: dayDate(date) } },
    include: {
      entries: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      session: true,
      enrollment: { select: { student: { select: { name: true } } } },
    },
  });
  if (!status) throw new HttpError(404, "لا يوجد سجل لهذا الطالب في هذا اليوم");
  const assignment = await tx.assignment.findUnique({
    where: {
      enrollmentId_dueDate: {
        enrollmentId,
        dueDate: dayDate(nextAssignmentDay(date)),
      },
    },
  });
  const snapshot = json({ status, assignment });
  return {
    status,
    assignment,
    snapshot,
    version: createHash("sha256")
      .update(JSON.stringify(snapshot))
      .digest("hex"),
  };
}
export async function getCorrection(
  halqaId: string,
  enrollmentId: string,
  date: string,
) {
  dateSchema.parse(date);
  return db.$transaction(
    async (tx) => {
      const v = await read(tx, halqaId, enrollmentId, date);
      return {
        version: v.version,
        date,
        studentName: v.status.enrollment.student.name,
        reviewOnly: v.status.reviewOnly,
        outcome: v.status.outcome,
        memorizationResult: v.status.memorizationResult,
        reviewResult: v.status.reviewResult,
        note: v.status.note,
        entries: v.status.entries.map((e) => ({
          ...e,
          pageAmount: e.pageAmount === null ? null : Number(e.pageAmount),
        })),
        assignment: v.assignment,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
export async function correctStudent(
  supervisorId: string,
  halqaId: string,
  enrollmentId: string,
  input: unknown,
) {
  const m = correctionSchema.parse(input);
  return db
    .$transaction(
      async (tx) => {
        if (
          !(await tx.supervisor.findFirst({
            where: { id: supervisorId, active: true },
          }))
        )
          throw new HttpError(403, "غير مسموح");
        const session = await tx.dailySession.findUnique({
          where: { halqaId_date: { halqaId, date: dayDate(m.date) } },
        });
        if (!session) throw new HttpError(404, "اليوم غير موجود");
        await tx.$queryRaw`SELECT id FROM "DailySession" WHERE id = ${session.id} FOR UPDATE`;
        const before = await read(tx, halqaId, enrollmentId, m.date),
          s = before.status;
        if (before.version !== m.version)
          throw new HttpError(
            409,
            "تغير السجل أثناء فتحه؛ أعد فتح التصحيح للاطلاع على آخر تعديل",
          );
        if (m.action === "entry") {
          if (s.outcome === "ABSENT")
            throw new HttpError(409, "ألغِ الغياب أولًا");
          const entry = s.entries.find((e) => e.id === m.entryId);
          if (!entry) throw new HttpError(404, "التسميع غير موجود لهذا الطالب");
          if (s.reviewOnly && entry.kind === "MEMORIZATION")
            throw new HttpError(409, "مسار الطالب مراجعة فقط");
          const pages = pageAmount(m.range)!;
          await tx.recitationEntry.update({
            where: { id: entry.id },
            data: {
              ...m.range,
              direction: m.range.direction ?? "FORWARD",
              pageAmount: pages.amount,
              pageMappingVersion: pages.version,
            },
          });
        }
        if (m.action === "result") {
          if (s.outcome === "ABSENT")
            throw new HttpError(409, "ألغِ الغياب أولًا");
          if (s.reviewOnly && m.kind === "MEMORIZATION")
            throw new HttpError(409, "مسار الطالب مراجعة فقط");
          const last = s.entries.findLast((e) => e.kind === m.kind);
          if (!last)
            throw new HttpError(409, "لا يمكن اعتماد نتيجة دون مدى تسميع مسجل");
          const memorizationResult =
              m.kind === "MEMORIZATION" ? m.result : s.memorizationResult,
            reviewResult = m.kind === "REVIEW" ? m.result : s.reviewResult;
          await tx.dailyStudentStatus.update({
            where: { id: s.id },
            data: {
              memorizationResult,
              reviewResult,
              outcome: independentSummary(
                memorizationResult,
                reviewResult,
                s.reviewOnly,
              ),
            },
          });
          if (m.kind === "MEMORIZATION")
            await tx.recitationEntry.update({
              where: { id: last.id },
              data: { masteryResult: m.result },
            });
        }
        if (m.action === "note")
          await tx.dailyStudentStatus.update({
            where: { id: s.id },
            data: { note: m.note.trim() },
          });
        if (m.action === "attendance") {
          if (m.absent && s.entries.length)
            throw new HttpError(
              409,
              "يوجد تسميع مسجل؛ لا يمكن تحويل اليوم إلى غياب",
            );
          await tx.dailyStudentStatus.update({
            where: { id: s.id },
            data: {
              outcome: m.absent
                ? "ABSENT"
                : independentSummary(
                    s.memorizationResult,
                    s.reviewResult,
                    s.reviewOnly,
                  ),
            },
          });
        }
        if (m.action === "assignment") {
          if (s.reviewOnly && m.memorization)
            throw new HttpError(409, "مسار الطالب مراجعة فقط");
          const data = {
            memorization: m.memorization ?? Prisma.DbNull,
            review: m.review ?? Prisma.DbNull,
            note: m.note.trim(),
            imageName: m.imageName.trim(),
            memorizationManual: true,
            reviewManual: true,
            autoMemorizationStatusId: null,
            autoReviewStatusId: null,
          };
          await tx.assignment.upsert({
            where: {
              enrollmentId_dueDate: {
                enrollmentId,
                dueDate: dayDate(nextAssignmentDay(m.date)),
              },
            },
            create: {
              enrollmentId,
              dueDate: dayDate(nextAssignmentDay(m.date)),
              ...data,
            },
            update: data,
          });
        }
        // Preserve historical submission state; current-day corrections reopen for teacher review.
        if (m.date === dayKey() && session.closedAt)
          await tx.dailySession.update({
            where: { id: session.id },
            data: { closedAt: null },
          });
        const after = await read(tx, halqaId, enrollmentId, m.date);
        await tx.supervisorCorrection.create({
          data: {
            supervisorId,
            halqaId,
            enrollmentId,
            date: dayDate(m.date),
            action: m.action,
            before: before.snapshot,
            after: after.snapshot,
          },
        });
      },
      { isolationLevel: "Serializable" },
    )
    .catch((error: unknown) => {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      )
        throw new HttpError(
          409,
          "تغير السجل أثناء التصحيح؛ أعد فتحه قبل الحفظ",
        );
      throw error;
    });
}
