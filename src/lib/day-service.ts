import { Prisma } from "@prisma/client";
import { db } from "./db";
import { HttpError } from "./auth";
import { dayDate, dayKey, nextDay, dayReadOnlyReason } from "./dates";
import {
  mutationSchema,
  independentSummary,
  reportIssues,
  type DayView,
  type AssignmentView,
} from "./types";
import { rangeSchema, pageAmount } from "./quran";
import { suggestAssignment } from "./assignment-suggestions";
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
          reviewOnly: e.reviewOnly,
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
        autoMemorizationStatusId: string | null;
        memorizationManual: boolean;
      }
    | undefined,
  reviewOnly = false,
): AssignmentView | null {
  return a
    ? {
        id: a.id,
        memorization:
          !reviewOnly && a.memorization
            ? rangeSchema.parse(a.memorization)
            : null,
        review: a.review ? rangeSchema.parse(a.review) : null,
        note: a.note,
        imageName: a.imageName,
        autoMemorizationStatusId: a.autoMemorizationStatusId,
        memorizationManual: a.memorizationManual,
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
  const since = dayDate(date);
  since.setUTCDate(since.getUTCDate() - 13);
  // One bounded query for the whole class, restricted to this teacher's halqa.
  const history =
    session.closedAt && date !== dayKey()
      ? []
      : await db.dailyStudentStatus.findMany({
          where: {
            halqaId,
            session: {
              date: { gte: since, lte: dayDate(date) },
              halqa: { teacherId },
            },
          },
          include: {
            session: { select: { date: true } },
            entries: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
          },
        });
  const histories = new Map<string, Parameters<typeof suggestAssignment>[0]>();
  for (const h of history) {
    if (h.outcome === "ABSENT") continue;
    const days = histories.get(h.enrollmentId) ?? [];
    days.push({
      date: h.session.date.toISOString().slice(0, 10),
      entries: h.entries
        .filter(
          (e) =>
            (e.kind === "MEMORIZATION"
              ? h.memorizationResult
              : h.reviewResult) === "MASTERED",
        )
        .map((e) => ({
          ...e,
          createdAt: e.createdAt.toISOString(),
          pageAmount: e.pageAmount === null ? null : Number(e.pageAmount),
        })),
    });
    histories.set(h.enrollmentId, days);
  }
  return {
    halqaId,
    halqaName: session.halqa.name,
    teacherName: session.halqa.teacher.name,
    date,
    timezone: process.env.APP_TIMEZONE || "Europe/Istanbul",
    closedAt: session.closedAt?.toISOString() ?? null,
    readOnlyReason: dayReadOnlyReason(date),
    students: session.statuses.map((s) => ({
      enrollmentId: s.enrollmentId,
      reviewOnly: s.reviewOnly,
      suggestions: {
        memorization:
          s.reviewOnly ||
          s.outcome === "ABSENT" ||
          s.memorizationResult === "NOT_MASTERED"
            ? null
            : suggestAssignment(
                histories.get(s.enrollmentId) ?? [],
                "MEMORIZATION",
              ),
        review:
          s.outcome === "ABSENT" || s.reviewResult === "NOT_MASTERED"
            ? null
            : suggestAssignment(histories.get(s.enrollmentId) ?? [], "REVIEW"),
      },
      name: s.enrollment.student.name,
      outcome: s.outcome,
      memorizationResult: s.memorizationResult,
      reviewResult: s.reviewResult,
      note: s.note,
      entries: s.entries.map((e) => ({
        id: e.id,
        kind: e.kind,
        assessment: e.assessment,
        ...(e.direction === "REVERSE" ? { direction: "REVERSE" as const } : {}),
        startSurah: e.startSurah,
        startAyah: e.startAyah,
        endSurah: e.endSurah,
        endAyah: e.endAyah,
        createdAt: e.createdAt.toISOString(),
        pageAmount: e.pageAmount === null ? null : Number(e.pageAmount),
        pageMappingVersion: e.pageMappingVersion,
      })),
      today: assignmentView(
        s.enrollment.assignments.find(
          (a) => a.dueDate.toISOString().slice(0, 10) === date,
        ),
        s.reviewOnly,
      ),
      tomorrow: assignmentView(
        s.enrollment.assignments.find(
          (a) => a.dueDate.toISOString().slice(0, 10) === nextDay(date),
        ),
        s.reviewOnly,
      ),
    })),
  };
}
export async function mutateDay(
  teacherId: string,
  halqaId: string,
  input: unknown,
  now?: Date,
) {
  const m = mutationSchema.parse(input);
  if (m.date !== dayKey(now))
    throw new HttpError(409, "تغير اليوم. حدّث الصفحة قبل التسجيل");
  const reason = dayReadOnlyReason(m.date, now);
  if (reason) throw new HttpError(409, reason);
  const session = await ensureDay(teacherId, halqaId, m.date);
  await serial(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "DailySession" WHERE id = ${session.id} FOR UPDATE`;
    const current = await tx.dailySession.findUniqueOrThrow({
      where: { id: session.id },
    });
    const cutoff = dayReadOnlyReason(m.date, now);
    if (cutoff) throw new HttpError(409, cutoff);
    if (m.action === "close") {
      const students = await tx.dailyStudentStatus.findMany({
        where: { sessionId: session.id },
        include: {
          entries: true,
          enrollment: {
            include: {
              student: true,
              assignments: { where: { dueDate: dayDate(nextDay(m.date)) } },
            },
          },
        },
      });
      const pending = students.filter(
        (s) =>
          reportIssues({
            enrollmentId: s.enrollmentId,
            reviewOnly: s.reviewOnly,
            name: s.enrollment.student.name,
            outcome: s.outcome,
            memorizationResult: s.memorizationResult,
            reviewResult: s.reviewResult,
            note: s.note,
            entries: s.entries.map((e) => ({
              ...e,
              createdAt: e.createdAt.toISOString(),
              pageAmount: e.pageAmount === null ? null : Number(e.pageAmount),
            })),
            today: null,
            tomorrow: assignmentView(s.enrollment.assignments[0]),
          }).length,
      );
      if (pending.length)
        throw new HttpError(
          409,
          `بقي ${pending.length} تقرير غير مكتمل: أكمل نتيجتي الحفظ والمراجعة ومدى التسميع وواجب الغد`,
        );
      await tx.dailySession.update({
        where: { id: session.id },
        data: { closedAt: new Date() },
      });
      return;
    }
    // Editing today's submitted report reopens it; past-day/time cutoffs still apply.
    if (current.closedAt)
      await tx.dailySession.update({
        where: { id: session.id },
        data: { closedAt: null },
      });
    const status = await tx.dailyStudentStatus.findFirst({
      where: { sessionId: session.id, enrollmentId: m.enrollmentId, halqaId },
      include: { entries: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
    });
    if (!status) throw new HttpError(404, "الطالب غير موجود في هذه الحلقة");
    if (
      status.reviewOnly &&
      (((m.action === "entry" || m.action === "assessment") &&
        m.kind === "MEMORIZATION") ||
        (m.action === "assignment" && m.memorization != null))
    )
      throw new HttpError(409, "الطالب حافظ؛ مساره مراجعة فقط دون حفظ جديد");
    if (m.action === "edit-entry") {
      if (status.outcome === "ABSENT")
        throw new HttpError(409, "ألغِ الغياب أولًا قبل تعديل التسميع");
      const entry = status.entries.find((e) => e.id === m.entryId);
      if (!entry)
        throw new HttpError(404, "التسميع غير موجود لهذا الطالب في هذا اليوم");
      if (status.reviewOnly && entry.kind === "MEMORIZATION")
        throw new HttpError(409, "الطالب حافظ؛ مساره مراجعة فقط دون حفظ جديد");
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
      const lastMemory = [...status.entries]
        .reverse()
        .find((e) => e.kind === "MEMORIZATION");
      if (
        entry.kind === "MEMORIZATION" &&
        lastMemory?.id === entry.id &&
        status.memorizationResult === "NOT_MASTERED"
      ) {
        await tx.assignment.updateMany({
          where: {
            enrollmentId: m.enrollmentId,
            dueDate: dayDate(nextDay(m.date)),
            autoMemorizationStatusId: status.id,
            memorizationManual: false,
          },
          data: { memorization: m.range },
        });
      }
    }
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
          existing.direction !== (m.range.direction ?? "FORWARD") ||
          existing.assessment !== (m.assessment ?? null) ||
          existing.startSurah !== m.range.startSurah ||
          existing.startAyah !== m.range.startAyah ||
          existing.endSurah !== m.range.endSurah ||
          existing.endAyah !== m.range.endAyah
        )
          throw new HttpError(409, "طلب مكرر غير صحيح");
        return;
      }
      const pages = pageAmount(m.range)!;
      await tx.recitationEntry.create({
        data: {
          dailyStatusId: status.id,
          kind: m.kind,
          assessment: m.assessment,
          ...m.range,
          direction: m.range.direction ?? "FORWARD",
          requestKey: m.requestKey,
          pageAmount: pages.amount,
          pageMappingVersion: pages.version,
        },
      });
    }
    if (
      m.action === "assessment" &&
      m.assessment === "MASTERED" &&
      !status.entries.some((e) => e.kind === m.kind)
    )
      throw new HttpError(409, "سجل مدى التسميع أولًا قبل تعديل النتيجة");
    if (m.action === "assessment" || (m.action === "entry" && m.assessment)) {
      if (status.outcome === "ABSENT")
        throw new HttpError(409, "ألغِ الغياب أولًا قبل تسجيل النتيجة");
      const memory =
        m.kind === "MEMORIZATION" ? m.assessment! : status.memorizationResult;
      const review = m.kind === "REVIEW" ? m.assessment! : status.reviewResult;
      await tx.dailyStudentStatus.update({
        where: { id: status.id },
        data: {
          memorizationResult: memory,
          reviewResult: review,
          outcome: independentSummary(memory, review, status.reviewOnly),
        },
      });
    }
    if (
      (m.action === "assessment" || m.action === "entry") &&
      m.kind === "MEMORIZATION" &&
      m.assessment
    ) {
      const where = {
        enrollmentId_dueDate: {
          enrollmentId: m.enrollmentId,
          dueDate: dayDate(nextDay(m.date)),
        },
      };
      const tomorrow = await tx.assignment.findUnique({ where });
      if (m.assessment === "NOT_MASTERED") {
        const today = await tx.assignment.findUnique({
          where: {
            enrollmentId_dueDate: {
              enrollmentId: m.enrollmentId,
              dueDate: dayDate(m.date),
            },
          },
        });
        const last = [...status.entries]
          .reverse()
          .find((e) => e.kind === "MEMORIZATION");
        const candidate =
          m.action === "entry"
            ? m.range
            : last
              ? {
                  ...(last.direction === "REVERSE"
                    ? { direction: "REVERSE" as const }
                    : {}),
                  startSurah: last.startSurah,
                  startAyah: last.startAyah,
                  endSurah: last.endSurah,
                  endAyah: last.endAyah,
                }
              : today?.memorization;
        const range = rangeSchema.safeParse(candidate);
        if (
          range.success &&
          !tomorrow?.memorizationManual &&
          (!tomorrow ||
            tomorrow.autoMemorizationStatusId === status.id ||
            (today && tomorrow.carriedFromId === today.id))
        ) {
          await tx.assignment.upsert({
            where,
            create: {
              enrollmentId: m.enrollmentId,
              dueDate: dayDate(nextDay(m.date)),
              memorization: range.data,
              autoMemorizationStatusId: status.id,
            },
            update: {
              memorization: range.data,
              autoMemorizationStatusId: status.id,
              memorizationManual: false,
              carriedFromId: null,
            },
          });
        }
      } else if (
        tomorrow?.autoMemorizationStatusId === status.id &&
        !tomorrow.memorizationManual
      ) {
        await tx.assignment.update({
          where,
          data: { memorization: Prisma.DbNull, autoMemorizationStatusId: null },
        });
      }
    }
    if (m.action === "note") {
      await tx.dailyStudentStatus.update({
        where: { id: status.id },
        data: { note: m.note.trim() },
      });
    }
    if (m.action === "status") {
      // Older clients sent the whole student snapshot when saving a note.
      // Preserve the authoritative results unless explicitly changing attendance.
      const attendanceChange =
        m.outcome === "ABSENT" ||
        (status.outcome === "ABSENT" && m.outcome === null);
      if (m.outcome === "ABSENT" && status.entries.length)
        throw new HttpError(
          409,
          "يوجد تسميع اليوم؛ لا يمكن تسجيل الغياب بعد التسميع",
        );
      await tx.dailyStudentStatus.update({
        where: { id: status.id },
        data: {
          ...(attendanceChange ? { outcome: m.outcome } : {}),
          note: m.note,
          ...(status.outcome === "ABSENT" && m.outcome === null
            ? { memorizationResult: null, reviewResult: null }
            : {}),
        },
      });
      if (m.outcome === "ABSENT") {
        const today = await tx.assignment.findUnique({
          where: {
            enrollmentId_dueDate: {
              enrollmentId: m.enrollmentId,
              dueDate: dayDate(m.date),
            },
          },
        });
        if (
          today &&
          (status.reviewOnly
            ? today.review
            : today.memorization || today.review)
        )
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
              memorization: status.reviewOnly
                ? Prisma.DbNull
                : (today.memorization ?? Prisma.DbNull),
              review: today.review ?? Prisma.DbNull,
              note: today.note,
              imageName: today.imageName,
              carriedFromId: today.id,
            },
          });
      }
    }
    if (m.action === "assignment") {
      const where = {
        enrollmentId_dueDate: {
          enrollmentId: m.enrollmentId,
          dueDate: dayDate(nextDay(m.date)),
        },
      };
      const previous = await tx.assignment.findUnique({ where });
      const memory =
        m.memorization === undefined ? previous?.memorization : m.memorization;
      const review = m.review === undefined ? previous?.review : m.review;
      if (status.reviewOnly ? !review : !memory && !review)
        throw new HttpError(
          409,
          status.reviewOnly
            ? "حدد مدى المراجعة لواجب الغد"
            : "اختر واجب الحفظ أو المراجعة أولًا",
        );
      const data = {
        ...(m.memorization !== undefined
          ? {
              memorization: m.memorization ?? Prisma.DbNull,
              autoMemorizationStatusId: null,
              memorizationManual: true,
            }
          : {}),
        ...(m.review !== undefined
          ? { review: m.review ?? Prisma.DbNull }
          : {}),
        ...(m.note !== undefined ? { note: m.note.trim() } : {}),
        ...(m.imageName !== undefined ? { imageName: m.imageName.trim() } : {}),
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
