import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import { HttpError } from "./auth";
import { calendarKey, dayDate, dailyWindow } from "./dates";
const excluded = () =>
  (process.env.SUPERVISOR_EXCLUDED_HALQA_IDS ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
async function membership(
  tx: Prisma.TransactionClient,
  id: string,
  halqaId: string,
) {
  const source = await tx.enrollment.findFirst({
    where: { id, halqaId, halqa: { attendanceOnly: false } },
    include: { student: true, halqa: { select: { name: true } } },
  });
  if (!source || excluded().includes(halqaId))
    throw new HttpError(404, "الطالب غير موجود في الحلقة");
  const active = await tx.enrollment.findMany({
    where: { studentId: source.studentId, active: true },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const last = await tx.studentTransfer.findFirst({
    where: { studentId: source.studentId },
    orderBy: { sequence: "desc" },
    select: { id: true },
  });
  const version = createHash("sha256")
    .update(
      JSON.stringify({
        id: source.id,
        halqaId,
        active,
        reviewOnly: source.reviewOnly,
        last,
      }),
    )
    .digest("hex");
  return { source, active, version };
}
export const transferSchema = z.object({
  targetHalqaId: z.string().min(1),
  version: z.string().length(64),
  requestKey: z.string().uuid(),
});
export async function getTransferOptions(
  halqaId: string,
  enrollmentId: string,
) {
  return db.$transaction(
    async (tx) => {
      const v = await membership(tx, enrollmentId, halqaId);
      if (
        !v.source.active ||
        v.active.length !== 1 ||
        v.active[0].id !== enrollmentId
      )
        throw new HttpError(409, "تغيرت حلقة الطالب؛ حدّث قائمة الحلقات");
      const destinations = await tx.halqa.findMany({
        where: {
          attendanceOnly: false,
          id: { notIn: [halqaId, ...excluded()] },
        },
        select: { id: true, name: true, teacher: { select: { name: true } } },
        orderBy: { name: "asc" },
      });
      return {
        version: v.version,
        studentName: v.source.student.name,
        sourceName: v.source.halqa.name,
        reviewOnly: v.source.reviewOnly,
        destinations,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
async function transferTransaction<T>(
  run: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(run, { isolationLevel: "Serializable" });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2034", "P2002"].includes(e.code) &&
        attempt < 2
      )
        continue;
      throw e;
    }
  }
  throw new Error("Transfer retry exhausted");
}
export async function transferStudent(
  supervisorId: string,
  halqaId: string,
  enrollmentId: string,
  input: unknown,
  now = new Date(),
) {
  const m = transferSchema.parse(input);
  return transferTransaction(async (tx) => {
    if (
      !(await tx.supervisor.findFirst({
        where: { id: supervisorId, active: true },
      }))
    )
      throw new HttpError(403, "غير مسموح");
    const existing = await tx.studentTransfer.findUnique({
      where: { requestKey: m.requestKey },
    });
    if (existing) {
      if (
        existing.supervisorId !== supervisorId ||
        existing.sourceEnrollmentId !== enrollmentId ||
        existing.sourceHalqaId !== halqaId ||
        existing.targetHalqaId !== m.targetHalqaId
      )
        throw new HttpError(409, "طلب النقل مستخدم سابقًا");
      return {
        halqaId: existing.targetHalqaId,
        enrollmentId: existing.targetEnrollmentId,
      };
    }
    const source = await tx.enrollment.findFirst({
      where: { id: enrollmentId, halqaId },
      select: { studentId: true },
    });
    if (!source) throw new HttpError(404, "الطالب غير موجود في الحلقة");
    await tx.$queryRaw`SELECT id FROM "Student" WHERE id = ${source.studentId} FOR UPDATE`;
    const v = await membership(tx, enrollmentId, halqaId);
    if (
      v.version !== m.version ||
      !v.source.active ||
      v.active.length !== 1 ||
      v.active[0].id !== enrollmentId
    )
      throw new HttpError(409, "تغيرت حلقة الطالب؛ أعد فتح النقل");
    if (m.targetHalqaId === halqaId || excluded().includes(m.targetHalqaId))
      throw new HttpError(400, "اختر حلقة أخرى من الحلقات المتاحة");
    if (
      !(await tx.halqa.findUnique({
        where: { id: m.targetHalqaId, attendanceOnly: false },
      }))
    )
      throw new HttpError(404, "الحلقة الجديدة غير موجودة");
    const previousTarget = await tx.enrollment.findUnique({
      where: {
        studentId_halqaId: {
          studentId: source.studentId,
          halqaId: m.targetHalqaId,
        },
      },
    });
    const cutoff = dayDate(calendarKey(now)),
      window = dailyWindow(now);
    const today = window.writable
      ? await tx.dailyStudentStatus.findFirst({
          where: { enrollmentId, session: { date: cutoff } },
          include: { entries: true, session: true },
        })
      : null;
    const assignments = await tx.assignment.findMany({
      where: { enrollmentId, dueDate: { gte: cutoff } },
      orderBy: { dueDate: "asc" },
    });
    if (previousTarget) {
      if (
        window.writable &&
        (await tx.dailyStudentStatus.findFirst({
          where: {
            enrollmentId: previousTarget.id,
            session: { date: cutoff },
          },
        }))
      )
        throw new HttpError(
          409,
          "يوجد سجل آخر لهذا اليوم في الحلقة الجديدة؛ راجعه قبل النقل",
        );
      if (
        assignments.length &&
        (await tx.assignment.findFirst({
          where: {
            enrollmentId: previousTarget.id,
            dueDate: { in: assignments.map((a) => a.dueDate) },
          },
        }))
      )
        throw new HttpError(
          409,
          "يوجد واجب بنفس الموعد في الحلقة الجديدة؛ راجعه قبل النقل",
        );
    }
    const max = await tx.enrollment.aggregate({
      where: { halqaId: m.targetHalqaId },
      _max: { position: true },
    });
    const target = await tx.enrollment.upsert({
      where: {
        studentId_halqaId: {
          studentId: source.studentId,
          halqaId: m.targetHalqaId,
        },
      },
      create: {
        studentId: source.studentId,
        halqaId: m.targetHalqaId,
        reviewOnly: v.source.reviewOnly,
        position: (max._max.position ?? -1) + 1,
      },
      update: {
        active: true,
        reviewOnly: v.source.reviewOnly,
        position: (max._max.position ?? -1) + 1,
      },
    });
    await tx.enrollment.update({
      where: { id: enrollmentId },
      data: { active: false },
    });
    let movedSessionId: string | null = null;
    if (window.writable)
      await tx.dailySession.updateMany({
        where: { halqaId, date: cutoff },
        data: { attendanceConfirmedAt: null, attendanceRecordedBy: null },
      });
    if (window.writable) {
      const destination = await tx.dailySession.upsert({
        where: { halqaId_date: { halqaId: m.targetHalqaId, date: cutoff } },
        create: { halqaId: m.targetHalqaId, date: cutoff },
        update: {},
      });
      for (const id of [today?.sessionId, destination.id]
        .filter((id): id is string => !!id)
        .sort())
        await tx.$queryRaw`SELECT id FROM "DailySession" WHERE id = ${id} FOR UPDATE`;
      if (today) {
        await tx.dailyStudentStatus.update({
          where: { id: today.id },
          data: {
            enrollmentId: target.id,
            halqaId: m.targetHalqaId,
            sessionId: destination.id,
          },
        });
        movedSessionId = destination.id;
      }
      // Joining an already submitted class requires its teacher to review the new roster.
      await tx.dailySession.update({
        where: { id: destination.id },
        data: {
          closedAt: null,
          attendanceConfirmedAt: null,
          attendanceRecordedBy: null,
        },
      });
    }
    if (assignments.length)
      await tx.assignment.updateMany({
        where: { id: { in: assignments.map((a) => a.id) } },
        data: { enrollmentId: target.id },
      });
    await tx.studentTransfer.create({
      data: {
        studentId: source.studentId,
        sourceEnrollmentId: enrollmentId,
        targetEnrollmentId: target.id,
        sourceHalqaId: halqaId,
        targetHalqaId: m.targetHalqaId,
        supervisorId,
        requestKey: m.requestKey,
        createdAt: now,
        before: json({
          source: v.source,
          target: previousTarget,
          today,
          assignments,
        }),
        after: json({
          target,
          sourceActive: false,
          movedStatusId: today?.id ?? null,
          movedSessionId,
          assignmentIds: assignments.map((a) => a.id),
        }),
      },
    });
    return { halqaId: m.targetHalqaId, enrollmentId: target.id };
  }).catch((e: unknown) => {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      ["P2034", "P2002"].includes(e.code)
    )
      throw new HttpError(
        409,
        "تغيرت البيانات أثناء النقل؛ حدّث الصفحة ثم تحقق من حلقة الطالب",
      );
    throw e;
  });
}
