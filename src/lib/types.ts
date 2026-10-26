import { z } from "zod";
import { rangeSchema, type QuranRange } from "./quran";
export const labels = {
  MEMORIZED: "حافظ",
  NOT_MEMORIZED: "غير حافظ",
  ABSENT: "غائب",
} as const;
export type Outcome = keyof typeof labels;
export const assessmentLabels = {
  MASTERED: "حافظ",
  NOT_MASTERED: "غير حافظ",
  NOT_REQUIRED: "غير مطلوب اليوم",
} as const;
export type Assessment = keyof typeof assessmentLabels;
export function independentSummary(
  memory: string | null | undefined,
  review: string | null | undefined,
  reviewOnly = false,
): Outcome | null {
  if (reviewOnly)
    return review === "MASTERED"
      ? "MEMORIZED"
      : review === "NOT_MASTERED"
        ? "NOT_MEMORIZED"
        : null;
  if (!memory || !review) return null;
  return memory === "NOT_MASTERED" || review === "NOT_MASTERED"
    ? "NOT_MEMORIZED"
    : "MEMORIZED";
}
export type AssignmentView = {
  autoMemorizationStatusId?: string | null;
  memorizationManual?: boolean;
  id: string;
  memorization: QuranRange | null;
  review: QuranRange | null;
  note: string;
  imageName: string;
};
export type EntryView = QuranRange & {
  assessment?: string | null;
  id: string;
  kind: "MEMORIZATION" | "REVIEW";
  createdAt: string;
  pageAmount: number | null;
  pageMappingVersion: string | null;
};
export type StudentView = {
  reviewOnly?: boolean;
  suggestions?: {
    memorization: AssignmentSuggestion | null;
    review: AssignmentSuggestion | null;
  };
  memorizationResult?: string | null;
  reviewResult?: string | null;
  enrollmentId: string;
  name: string;
  outcome: Outcome | null;
  note: string;
  entries: EntryView[];
  today: AssignmentView | null;
  tomorrow: AssignmentView | null;
};
export type AssignmentSuggestion = {
  range: QuranRange;
  sampleDays: number;
  averagePages: number;
};
export type DayView = {
  halqaId: string;
  halqaName: string;
  teacherName: string;
  date: string;
  timezone: string;
  closedAt: string | null;
  readOnlyReason?: string | null;
  students: StudentView[];
};
export const mutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("track"),
    enrollmentId: z.string().min(1),
    date: z.string(),
    reviewOnly: z.boolean(),
  }),
  z.object({
    action: z.literal("note"),
    enrollmentId: z.string().min(1),
    date: z.string(),
    note: z.string().max(500),
  }),
  z.object({
    action: z.literal("edit-entry"),
    enrollmentId: z.string().min(1),
    date: z.string(),
    entryId: z.string().min(1),
    range: rangeSchema,
  }),
  z.object({
    action: z.literal("entry"),
    enrollmentId: z.string().min(1),
    date: z.string(),
    kind: z.enum(["MEMORIZATION", "REVIEW"]),
    assessment: z.enum(["MASTERED", "NOT_MASTERED"]).optional(),
    range: rangeSchema,
    requestKey: z.string().uuid(),
  }),
  z.object({
    action: z.literal("assessment"),
    enrollmentId: z.string().min(1),
    date: z.string(),
    kind: z.enum(["MEMORIZATION", "REVIEW"]),
    assessment: z.enum(["MASTERED", "NOT_MASTERED"]),
  }),
  z.object({
    action: z.literal("status"),
    enrollmentId: z.string().min(1),
    date: z.string(),
    outcome: z.enum(["MEMORIZED", "NOT_MEMORIZED", "ABSENT"]).nullable(),
    note: z.string().max(500),
    carry: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("assignment"),
    enrollmentId: z.string().min(1),
    date: z.string(),
    memorization: rangeSchema.nullable(),
    review: rangeSchema.nullable(),
    note: z.string().max(500),
    imageName: z.string().max(100),
  }),
  z.object({ action: z.literal("close"), date: z.string() }),
]);

export function reportIssues(
  student: StudentView,
  legacyClosed = false,
): string[] {
  if (
    legacyClosed &&
    student.outcome &&
    !student.memorizationResult &&
    !student.reviewResult
  )
    return [];
  const issues: string[] = [];
  if (student.outcome !== "ABSENT") {
    if (
      !student.reviewOnly &&
      (!student.memorizationResult ||
        !["MASTERED", "NOT_MASTERED"].includes(student.memorizationResult))
    )
      issues.push("نتيجة الحفظ الجديد");
    if (
      !student.reviewResult ||
      !["MASTERED", "NOT_MASTERED"].includes(student.reviewResult)
    )
      issues.push("نتيجة المراجعة");
    if (
      !student.reviewOnly &&
      student.memorizationResult === "MASTERED" &&
      !student.entries.some((e) => e.kind === "MEMORIZATION")
    )
      issues.push("مدى الحفظ الجديد");
    if (
      student.reviewResult === "MASTERED" &&
      !student.entries.some((e) => e.kind === "REVIEW")
    )
      issues.push("مدى المراجعة");
  }
  if (
    student.reviewOnly
      ? !student.tomorrow?.review
      : !student.tomorrow?.memorization && !student.tomorrow?.review
  )
    issues.push("واجب الغد");
  return issues;
}
