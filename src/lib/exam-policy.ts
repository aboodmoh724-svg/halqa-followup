import { z } from "zod";
import { nextStudyDay } from "./dates";
export const EXAM_POLICY = "school-juz-v1-2026-10-31";
export const questionSchema = z
  .object({
    prompting: z.number().int().min(0).max(100),
    warning: z.number().int().min(0).max(100),
    tajweed: z.number().int().min(0).max(100),
  })
  .strict();
export const questionsSchema = z.array(questionSchema).length(3);
export type ExamQuestion = z.infer<typeof questionSchema>;
export function examGrade(halfPoints: number) {
  const score = halfPoints / 2;
  return {
    halfPoints,
    score,
    passed: score >= 75,
    rating:
      score < 75
        ? "غير ناجح"
        : score < 80
          ? "ناجح · ضعيف"
          : score < 85
            ? "جيد"
            : score < 90
              ? "جيد جدًا"
              : "ممتاز",
  };
}
// Integer half-points avoid rounding either the 0.5 deduction or grade edges.
export function scoreExam(input: unknown) {
  const questions = questionsSchema.parse(input);
  const halfPoints = Math.max(
    0,
    200 -
      questions.reduce(
        (n, q) => n + 4 * q.prompting + 2 * q.warning + q.tajweed,
        0,
      ),
  );
  return examGrade(halfPoints);
}
export function retryStudyDate(decisionDate: string) {
  return nextStudyDay(nextStudyDay(decisionDate));
}
