import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { HttpError } from "./auth";
import { calendarKey, dayDate, dayReadOnlyReason } from "./dates";
import { rangeSchema, rangeSegments, type QuranRange } from "./quran";
import {
  completionProof,
  progressionProblem,
  verseIndex,
  type CoverageEntry,
} from "./completion";
import {
  EXAM_POLICY,
  questionsSchema,
  scoreExam,
  examGrade,
  retryStudyDate,
} from "./exam-policy";
import metadata from "../data/juz-boundaries.json";
type Tx = Prisma.TransactionClient;
export type ExamActor = {
  kind: "TEACHER" | "SUPERVISOR";
  id: string;
  name: string;
};
const excluded = () =>
  (process.env.SUPERVISOR_EXCLUDED_HALQA_IDS ?? "").split(",").filter(Boolean);
function canonical(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
    );
  return v;
}
const hash = (v: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(v)))
    .digest("hex");
const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const versionSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const examSubmitSchema = z
  .object({
    version: versionSchema,
    juz: z.number().int().min(1).max(30),
    questions: questionsSchema,
    confirmed: z.literal(true),
    requestKey: z.string().uuid(),
  })
  .strict();
export const baselineSchema = z
  .object({
    version: versionSchema,
    ranges: z.array(rangeSchema).min(1).max(114),
    note: z.string().trim().min(3).max(500),
    confirmed: z.literal(true),
    requestKey: z.string().uuid(),
  })
  .strict();
export const examDecisionSchema = z
  .object({
    version: versionSchema,
    action: z.enum(["APPROVE", "RETRY", "REVOKE", "RESCHEDULE"]),
    note: z.string().trim().max(500),
    requestKey: z.string().uuid(),
  })
  .strict();
async function membership(
  tx: Tx,
  actor: ExamActor,
  halqaId: string,
  enrollmentId: string,
) {
  const e = await tx.enrollment.findFirst({
    where: {
      id: enrollmentId,
      halqaId,
      active: true,
      halqa: {
        attendanceOnly: false,
        ...(actor.kind === "TEACHER"
          ? { teacherId: actor.id }
          : { id: { notIn: excluded() } }),
      },
    },
    include: { student: true, halqa: { include: { teacher: true } } },
  });
  if (!e) throw new HttpError(404, "الطالب غير موجود في هذه الحلقة");
  return e;
}
export async function loadExamEvidence(
  tx: Tx,
  studentIds: string[],
  date = calendarKey(),
) {
  const [baselines, records, exams] = await Promise.all([
    tx.memorizationBaseline.findMany({
      where: { studentId: { in: studentIds } },
    }),
    tx.recitationEntry.findMany({
      where: {
        dailyStatus: {
          enrollment: { studentId: { in: studentIds } },
          session: { date: { lte: dayDate(date) } },
          OR: [{ outcome: null }, { outcome: { not: "ABSENT" } }],
        },
      },
      include: {
        dailyStatus: {
          include: {
            enrollment: { select: { studentId: true } },
            session: { select: { date: true } },
          },
        },
      },
      orderBy: [
        { dailyStatus: { session: { date: "asc" } } },
        { createdAt: "asc" },
        { id: "asc" },
      ],
    }),
    tx.partExam.findMany({
      where: { studentId: { in: studentIds } },
      orderBy: [{ attempt: "desc" }, { id: "asc" }],
      include: { actions: { orderBy: { createdAt: "asc" } } },
    }),
  ]);
  const last = new Map<string, string>();
  for (const r of records) last.set(`${r.dailyStatusId}:${r.kind}`, r.id);
  return new Map(
    studentIds.map((id) => {
      const baseline = baselines.find((b) => b.studentId === id) ?? null;
      const ranges = baseline
        ? z.array(rangeSchema).parse(baseline.ranges)
        : [];
      const entries: CoverageEntry[] = records
        .filter(
          (r) =>
            r.dailyStatus.enrollment.studentId === id &&
            !(r.kind === "MEMORIZATION" && r.dailyStatus.reviewOnly),
        )
        .map((r) => {
          const fallback =
            last.get(`${r.dailyStatusId}:${r.kind}`) === r.id
              ? r.kind === "MEMORIZATION"
                ? r.dailyStatus.memorizationResult
                : r.dailyStatus.reviewResult
              : null;
          return {
            id: r.id,
            kind: r.kind,
            range: rangeSchema.parse(r),
            mastered:
              (r.masteryResult ?? fallback ?? r.assessment) === "MASTERED",
            date: r.dailyStatus.session.date.toISOString().slice(0, 10),
            createdAt: r.createdAt.toISOString(),
          };
        });
      const attempts = exams.filter((e) => e.studentId === id),
        proof = completionProof(ranges, entries);
      const version = hash({
        baseline,
        entries,
        exams: attempts.map((e) => ({
          id: e.id,
          updatedAt: e.updatedAt,
          state: e.state,
          retryOn: e.retryOn,
        })),
      });
      return [id, { baseline, ranges, entries, attempts, proof, version }];
    }),
  );
}
type Evidence =
  Awaited<ReturnType<typeof loadExamEvidence>> extends Map<string, infer V>
    ? V
    : never;
function latest(e: Evidence, juz: number) {
  return e.attempts.find((a) => a.juz === juz);
}
function ready(e: Evidence, juz: number) {
  const p = e.proof.parts[juz - 1];
  return p.eligible && !p.pendingSurahs.length;
}
function approved(e: Evidence, juz: number) {
  return latest(e, juz)?.state === "APPROVED" && ready(e, juz);
}
function publicView(
  e: Evidence,
  actor: ExamActor,
  reviewOnly: boolean,
  now: Date,
) {
  const today = calendarKey(now),
    readOnlyReason = dayReadOnlyReason(today, now);
  return {
    version: e.version,
    today,
    timezone: process.env.APP_TIMEZONE || "Europe/Istanbul",
    readOnlyReason,
    reviewOnly,
    baseline: e.baseline
      ? {
          ranges: e.ranges,
          note: e.baseline.note,
          supervisorName: e.baseline.supervisorName,
          createdAt: e.baseline.createdAt.toISOString(),
        }
      : null,
    baselineAllowed:
      actor.kind === "SUPERVISOR" &&
      !reviewOnly &&
      !e.baseline &&
      !e.attempts.length,
    previousParts: e.proof.parts
      .filter((p) => p.previous === p.total)
      .map((p) => p.number),
    surahs: e.proof.chapters
      .filter((s) => s.complete && !s.fullRecited)
      .map((s) => ({ number: s.number, name: s.name })),
    parts: e.proof.parts
      .filter((p) => p.eligible || e.attempts.some((a) => a.juz === p.number))
      .map((p) => {
        const a = latest(e, p.number),
          valid = ready(e, p.number);
        const retryOn = a?.retryOn?.toISOString().slice(0, 10) ?? null;
        const state =
          a?.state === "APPROVED" && !valid
            ? "CHANGED"
            : (a?.state ?? (p.pendingSurahs.length ? "SURAH_REVIEW" : "READY"));
        return {
          number: p.number,
          name: p.name,
          text: p.text,
          complete: p.complete,
          pendingSurahs: p.pendingSurahs,
          state,
          retryOn,
          overdue: state === "RETRY" && !!retryOn && today > retryOn,
          canSubmit:
            !reviewOnly &&
            !readOnlyReason &&
            valid &&
            (!a || (a.state === "RETRY" && retryOn === today)),
          attempts: e.attempts
            .filter((a) => a.juz === p.number)
            .map((a) => ({
              id: a.id,
              attempt: a.attempt,
              state: a.state,
              submittedAt: a.submittedAt.toISOString(),
              teacherName: a.teacherName,
              questions: questionsSchema.parse(a.questions),
              decidedAt: a.decidedAt?.toISOString() ?? null,
              decidedByName: a.decidedByName,
              decisionNote: a.decisionNote,
              retryOn: a.retryOn?.toISOString().slice(0, 10) ?? null,
              ...(actor.kind === "SUPERVISOR"
                ? {
                    score: a.scoreHalfPoints / 2,
                    rating: examGrade(a.scoreHalfPoints).rating,
                    passed: a.scoreHalfPoints >= 150,
                    policyVersion: a.policyVersion,
                    actions: a.actions.map((action) => ({
                      action: action.action,
                      supervisorName: action.supervisorName,
                      createdAt: action.createdAt.toISOString(),
                      note: String(
                        (action.after as Prisma.JsonObject).decisionNote ?? "",
                      ),
                    })),
                  }
                : {}),
            })),
        };
      }),
  };
}
export async function studentExamView(
  actor: ExamActor,
  halqaId: string,
  enrollmentId: string,
  now = new Date(),
) {
  return db.$transaction(
    async (tx) => {
      const m = await membership(tx, actor, halqaId, enrollmentId);
      const e = (
        await loadExamEvidence(tx, [m.studentId], calendarKey(now))
      ).get(m.studentId)!;
      return {
        ...publicView(e, actor, m.reviewOnly, now),
        studentName: m.student.name,
        halqaName: m.halqa.name,
        currentTeacherName: m.halqa.teacher.name,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
export type StudentExamView = Awaited<ReturnType<typeof studentExamView>>;
async function serial<T>(callback: (tx: Tx) => Promise<T>) {
  try {
    return await db.$transaction(callback, {
      isolationLevel: "Serializable",
      timeout: 30000,
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      ["P2034", "P2002"].includes(e.code)
    )
      throw new HttpError(
        409,
        "تغير السجل أثناء الحفظ؛ حدّث الصفحة ثم أعد المحاولة",
      );
    throw e;
  }
}
async function supervisor(tx: Tx, actor: ExamActor) {
  if (
    actor.kind !== "SUPERVISOR" ||
    !(await tx.supervisor.findFirst({ where: { id: actor.id, active: true } }))
  )
    throw new HttpError(403, "غير مسموح");
}
export async function setMemorizationBaseline(
  actor: ExamActor,
  halqaId: string,
  enrollmentId: string,
  input: unknown,
  now = new Date(),
) {
  const m = baselineSchema.parse(input),
    payloadHash = hash({ actor, halqaId, enrollmentId, m });
  await serial(async (tx) => {
    await supervisor(tx, actor);
    const member = await membership(tx, actor, halqaId, enrollmentId);
    if (member.reviewOnly)
      throw new HttpError(409, "الطالب حافظ؛ لا يحتاج تأسيس مسار حفظ جديد");
    await tx.$queryRaw`SELECT id FROM "Student" WHERE id=${member.studentId} FOR UPDATE`;
    const existing = await tx.memorizationBaseline.findUnique({
      where: { studentId: member.studentId },
    });
    if (existing) {
      if (existing.payloadHash === payloadHash) return;
      throw new HttpError(
        409,
        "المحفوظ السابق معتمد بالفعل؛ لا يمكن إعادة تأسيسه أو استبداله",
      );
    }
    const e = (
      await loadExamEvidence(tx, [member.studentId], calendarKey(now))
    ).get(member.studentId)!;
    if (e.version !== m.version)
      throw new HttpError(409, "تغير سجل الطالب؛ حدّث الصفحة قبل الاعتماد");
    if (e.attempts.length)
      throw new HttpError(
        409,
        "بدأت اختبارات الطالب؛ لا يمكن تغيير أساس محفوظها السابق",
      );
    await tx.memorizationBaseline.create({
      data: {
        studentId: member.studentId,
        ranges: json(m.ranges),
        note: m.note,
        supervisorId: actor.id,
        supervisorName: actor.name,
        requestKey: m.requestKey,
        payloadHash,
      },
    });
  });
  return studentExamView(actor, halqaId, enrollmentId, now);
}
export async function submitPartExam(
  actor: ExamActor,
  halqaId: string,
  enrollmentId: string,
  input: unknown,
  now = new Date(),
) {
  if (actor.kind !== "TEACHER")
    throw new HttpError(403, "تسجيل الاختبار من حساب معلم الحلقة");
  const m = examSubmitSchema.parse(input),
    reason = dayReadOnlyReason(calendarKey(now), now);
  if (reason) throw new HttpError(409, reason);
  const payloadHash = hash({ actor, halqaId, enrollmentId, m });
  await serial(async (tx) => {
    const member = await membership(tx, actor, halqaId, enrollmentId);
    if (member.reviewOnly)
      throw new HttpError(409, "هذه الاختبارات لإتمام أجزاء الحفظ الجديد");
    await tx.$queryRaw`SELECT id FROM "Student" WHERE id=${member.studentId} FOR UPDATE`;
    const replay = await tx.partExam.findUnique({
      where: { requestKey: m.requestKey },
    });
    if (replay) {
      if (replay.payloadHash !== payloadHash)
        throw new HttpError(409, "طلب الاختبار مستخدم لبيانات أخرى");
      return;
    }
    const e = (
      await loadExamEvidence(tx, [member.studentId], calendarKey(now))
    ).get(member.studentId)!;
    if (e.version !== m.version)
      throw new HttpError(409, "تغير السجل؛ حدّث الصفحة قبل إرسال الاختبار");
    if (!ready(e, m.juz))
      throw new HttpError(
        409,
        "يجب إثبات إتمام الجزء وتسميع السور المكتملة كاملة قبل الاختبار",
      );
    const old = latest(e, m.juz);
    if (old && old.state !== "RETRY")
      throw new HttpError(409, "الاختبار مرسل أو معتمد بالفعل");
    if (old?.retryOn?.toISOString().slice(0, 10) !== calendarKey(now) && old)
      throw new HttpError(
        409,
        "الإعادة في موعدها المحدد بعد يومين دراسيين؛ عند فواته يرجع للمشرف",
      );
    const result = scoreExam(m.questions);
    const part = e.proof.parts[m.juz - 1];
    const snapshot = {
      part,
      metadataSha256: metadata.sha256,
      baseline: e.baseline,
      entries: e.entries.filter(
        (entry) =>
          entry.mastered &&
          rangeSegments(entry.range).some(
            (seg) =>
              verseIndex(seg.surah, seg.startAyah) <= part.end &&
              verseIndex(seg.surah, seg.endAyah) >= part.start,
          ),
      ),
    };
    await tx.partExam.create({
      data: {
        studentId: member.studentId,
        juz: m.juz,
        attempt: (old?.attempt ?? 0) + 1,
        teacherId: actor.id,
        teacherName: actor.name,
        halqaId,
        enrollmentId,
        questions: json(m.questions),
        scoreHalfPoints: result.halfPoints,
        policyVersion: EXAM_POLICY,
        evidenceHash: hash(snapshot),
        evidenceSnapshot: json(snapshot),
        submittedAt: now,
        requestKey: m.requestKey,
        payloadHash,
      },
    });
  });
  return studentExamView(actor, halqaId, enrollmentId, now);
}
export async function decidePartExam(
  actor: ExamActor,
  examId: string,
  input: unknown,
  now = new Date(),
) {
  const m = examDecisionSchema.parse(input),
    payloadHash = hash({ actor, examId, m });
  return serial(async (tx) => {
    await supervisor(tx, actor);
    const a = await tx.partExam.findUnique({ where: { id: examId } });
    if (!a) throw new HttpError(404, "الاختبار غير موجود");
    await tx.$queryRaw`SELECT id FROM "Student" WHERE id=${a.studentId} FOR UPDATE`;
    const current = await tx.enrollment.findFirst({
      where: {
        studentId: a.studentId,
        active: true,
        halqa: { attendanceOnly: false, id: { notIn: excluded() } },
      },
    });
    if (!current) throw new HttpError(404, "لا يوجد قيد نشط لهذا الطالب");
    const replay = await tx.examAction.findUnique({
      where: { requestKey: m.requestKey },
    });
    if (replay) {
      if (replay.payloadHash !== payloadHash)
        throw new HttpError(409, "طلب القرار مستخدم لبيانات أخرى");
      return { halqaId: current.halqaId, enrollmentId: current.id };
    }
    const e = (await loadExamEvidence(tx, [a.studentId], calendarKey(now))).get(
      a.studentId,
    )!;
    if (e.version !== m.version)
      throw new HttpError(
        409,
        "تغير سجل الطالب أو الاختبار؛ حدّث الصفحة قبل القرار",
      );
    if (latest(e, a.juz)?.id !== a.id)
      throw new HttpError(409, "يوجد اختبار أحدث لهذا الجزء");
    if (m.action === "APPROVE") {
      if (
        a.state !== "SUBMITTED" ||
        a.scoreHalfPoints < 150 ||
        !ready(e, a.juz)
      )
        throw new HttpError(
          409,
          "لا يعتمد إلا اختبار مرسل ناجح بإتمام موثق وتسميع السور المكتملة كاملة",
        );
    } else {
      if (m.note.length < 3)
        throw new HttpError(
          400,
          "اكتب سبب الإعادة أو إلغاء الاعتماد أو إعادة الموعد",
        );
      const allowed =
        m.action === "RETRY"
          ? a.state === "SUBMITTED"
          : m.action === "REVOKE"
            ? a.state === "APPROVED"
            : a.state === "RETRY" &&
              !!a.retryOn &&
              a.retryOn < dayDate(calendarKey(now));
      if (!allowed)
        throw new HttpError(409, "هذا الإجراء غير متاح لحالة الاختبار الحالية");
    }
    const after = await tx.partExam.update({
      where: { id: examId },
      data: {
        state: m.action === "APPROVE" ? "APPROVED" : "RETRY",
        decidedAt: now,
        decidedById: actor.id,
        decidedByName: actor.name,
        decisionNote: m.note,
        retryOn:
          m.action === "APPROVE"
            ? null
            : dayDate(retryStudyDate(calendarKey(now))),
      },
    });
    await tx.examAction.create({
      data: {
        examId,
        supervisorId: actor.id,
        supervisorName: actor.name,
        action: m.action,
        before: json(a),
        after: json(after),
        requestKey: m.requestKey,
        payloadHash,
      },
    });
    return { halqaId: current.halqaId, enrollmentId: current.id };
  });
}
// Called within the same transaction as memorization writes, so a pending
// exam cannot be bypassed by another tab, edit or result change.
export async function enforceExamProgression(
  tx: Tx,
  studentId: string,
  range: QuranRange,
  mastered: boolean,
  date: string,
) {
  await tx.$queryRaw`SELECT id FROM "Student" WHERE id=${studentId} FOR UPDATE`;
  const e = (await loadExamEvidence(tx, [studentId], date)).get(studentId)!;
  const approvals = new Set(
    e.proof.parts.filter((p) => approved(e, p.number)).map((p) => p.number),
  );
  const problem = progressionProblem(
    e.ranges,
    e.entries,
    range,
    approvals,
    mastered,
    new Set(
      e.proof.parts
        .filter(
          (p) =>
            latest(e, p.number)?.state === "APPROVED" && !ready(e, p.number),
        )
        .map((p) => p.number),
    ),
  );
  if (problem) throw new HttpError(409, problem);
}
export async function examOverview(actor: ExamActor, now = new Date()) {
  if (actor.kind !== "SUPERVISOR") throw new HttpError(403, "غير مسموح");
  return db.$transaction(
    async (tx) => {
      const members = await tx.enrollment.findMany({
        where: {
          active: true,
          reviewOnly: false,
          halqa: { attendanceOnly: false, id: { notIn: excluded() } },
        },
        include: { student: true, halqa: { include: { teacher: true } } },
        orderBy: { position: "asc" },
      });
      const evidence = await loadExamEvidence(
        tx,
        members.map((e) => e.studentId),
        calendarKey(now),
      );
      const students = members.map((m) => {
        const e = evidence.get(m.studentId)!;
        return {
          halqaId: m.halqaId,
          halqaName: m.halqa.name,
          enrollmentId: m.id,
          studentName: m.student.name,
          teacherName: m.halqa.teacher.name,
          ...publicView(e, actor, false, now),
        };
      });
      return {
        today: calendarKey(now),
        students: students.filter((s) => s.parts.length || s.surahs.length),
        summary: {
          ready: students.reduce(
            (n, s) => n + s.parts.filter((p) => p.state === "READY").length,
            0,
          ),
          submitted: students.reduce(
            (n, s) => n + s.parts.filter((p) => p.state === "SUBMITTED").length,
            0,
          ),
          retry: students.reduce(
            (n, s) => n + s.parts.filter((p) => p.state === "RETRY").length,
            0,
          ),
          approved: students.reduce(
            (n, s) => n + s.parts.filter((p) => p.state === "APPROVED").length,
            0,
          ),
          changed: students.reduce(
            (n, s) => n + s.parts.filter((p) => p.state === "CHANGED").length,
            0,
          ),
          surahs: students.reduce((n, s) => n + s.surahs.length, 0),
        },
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 30000 },
  );
}
export type ExamOverview = Awaited<ReturnType<typeof examOverview>>;

export async function completionNotices(tx: Tx, ids: string[], date: string) {
  const evidence = await loadExamEvidence(tx, ids, date);
  return new Map(
    [...evidence].map(([id, e]) => {
      const notices: string[] = [];
      for (const s of e.proof.chapters.filter(
        (s) => s.complete && !s.fullRecited,
      ))
        notices.push(`أتم سورة ${s.name}؛ يلزم تسميعها كاملة`);
      for (const p of e.proof.parts.filter(
        (p) => p.eligible || e.attempts.some((a) => a.juz === p.number),
      )) {
        const a = latest(e, p.number);
        if (!a) {
          if (!p.pendingSurahs.length)
            notices.push(`${p.name} مكتمل؛ ينتظر الاختبار`);
          continue;
        }
        if (a.state === "SUBMITTED")
          notices.push(`${p.name}؛ اختبار ينتظر اعتماد المشرف`);
        else if (a.state === "RETRY")
          notices.push(
            `${p.name}؛ إعادة الاختبار ${a.retryOn?.toISOString().slice(0, 10) ?? ""}`,
          );
        else if (!ready(e, p.number))
          notices.push(`${p.name}؛ تغير دليل الإتمام بعد الاعتماد`);
      }
      return [id, notices];
    }),
  );
}
