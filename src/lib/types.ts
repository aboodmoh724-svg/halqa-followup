import { z } from "zod";
import { rangeSchema, type QuranRange } from "./quran";
export const labels = {
  MEMORIZED: "حفظ",
  NOT_MEMORIZED: "لم يحفظ",
  ABSENT: "غائب",
} as const;
export type Outcome = keyof typeof labels;
export type AssignmentView = {
  id: string;
  memorization: QuranRange | null;
  review: QuranRange | null;
  note: string;
  imageName: string;
};
export type EntryView = QuranRange & {
  id: string;
  kind: "MEMORIZATION" | "REVIEW";
  createdAt: string;
};
export type StudentView = {
  enrollmentId: string;
  name: string;
  outcome: Outcome | null;
  note: string;
  entries: EntryView[];
  today: AssignmentView | null;
  tomorrow: AssignmentView | null;
};
export type DayView = {
  halqaId: string;
  halqaName: string;
  teacherName: string;
  date: string;
  timezone: string;
  closedAt: string | null;
  students: StudentView[];
};
export const mutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("entry"),
    enrollmentId: z.string().min(1),
    date: z.string(),
    kind: z.enum(["MEMORIZATION", "REVIEW"]),
    range: rangeSchema,
    requestKey: z.string().uuid(),
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
