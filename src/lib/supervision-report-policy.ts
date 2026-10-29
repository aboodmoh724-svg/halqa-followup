import { z } from "zod";
export const reportTitles = {
  comprehensive: "التقرير الموحد الشامل",
  support: "طلاب يحتاجون متابعة",
  excellent: "الطلاب المتميزون",
  absence: "تقرير الغياب",
  student: "تقرير الطالب",
} as const;
export const reportDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + "T00:00:00Z");
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  });
export const supervisionReportQuery = z
  .object({
    type: z
      .enum(["comprehensive", "support", "excellent", "absence", "student"])
      .default("comprehensive"),
    from: reportDate,
    to: reportDate,
    halqaId: z.string().min(1).max(100).optional(),
    enrollmentId: z.string().min(1).max(100).optional(),
    minDays: z.coerce.number().int().min(1).max(93).default(3),
    mastery: z.coerce.number().min(0).max(100).optional(),
    absenceMin: z.coerce.number().int().min(1).max(93).default(3),
    maxAbsences: z.coerce.number().int().min(0).max(93).default(0),
    format: z.enum(["json", "pdf"]).default("json"),
  })
  .refine(
    (q) =>
      q.from <= q.to && (Date.parse(q.to) - Date.parse(q.from)) / 86400000 < 93,
    { message: "اختر فترة صحيحة لا تتجاوز ٩٣ يومًا" },
  )
  .refine(
    (q) =>
      q.type !== "support" ||
      (new Date(q.from + "T00:00:00Z").getUTCDay() === 1 &&
        (Date.parse(q.to) - Date.parse(q.from)) / 86400000 === 4),
    { message: "تقرير المتابعة يحتاج أسبوعًا كاملًا من الاثنين إلى الجمعة" },
  )
  .refine((q) => q.type !== "student" || !!q.enrollmentId, {
    message: "اختر الطالب",
  })
  .transform((q) => ({
    ...q,
    mastery: q.mastery ?? (q.type === "excellent" ? 90 : 70),
  }));
export type SupervisionReportQuery = z.infer<typeof supervisionReportQuery>;
export function reportCriteria(q: SupervisionReportQuery) {
  if (q.type === "support")
    return "معيار المدرسة للحفظ الجديد المتقن خلال أسبوع كامل: أقل من 2 صفحة للصفين الأول والثاني، وأقل من 5 صفحات للصفوف الثالث إلى السادس. طلاب المراجعة فقط خارج المعيار. الغياب أو تكرار غير حافظ ليس معيارًا بديلًا للمقدار؛ التنبيهات مستقلة. لا يُصنف الطالب عند نقص بيانات الحفظ أو الحضور خلال الأسبوع.";
  if (q.type === "excellent")
    return `إتقان ${q.mastery}% فأكثر بعد ${q.minDays} أيام مقيمة على الأقل، وغياب لا يزيد عن ${q.maxAbsences} أيام، دون سجلات ناقصة خلال الفترة. هذه شروط التقرير المختارة وليست اعتمادًا لشهادة.`;
  if (q.type === "absence")
    return `طلاب لديهم يوم غياب مسجل واحد على الأقل خلال الفترة. الأيام دون تسجيل لا تعد غيابًا.`;
  return "الحفظ والمراجعة منفصلان. الكميات مجموع التسميع المسجل المتكرر، ولا تثبت إتمام سورة أو جزء. الأيام دون تسجيل لا تعد غيابًا أو غير حافظ.";
}
export type ReportMetric = {
  assessedDays: number;
  masteredDays: number;
  absentDays: number;
  pendingDays: number;
};
export function reportReasons(
  m: ReportMetric,
  q: SupervisionReportQuery,
): string[] {
  const rate = m.assessedDays ? (m.masteredDays / m.assessedDays) * 100 : null;
  // Weekly page thresholds are evaluated with the pupil's full-week memory data.
  if (q.type === "support") return [];
  if (q.type === "excellent")
    return rate !== null &&
      m.assessedDays >= q.minDays &&
      rate >= q.mastery &&
      m.absentDays <= q.maxAbsences &&
      m.pendingDays === 0
      ? [
          `إتقان ${Math.round(rate)}% في ${m.assessedDays} أيام مقيمة؛ غياب ${m.absentDays}`,
        ]
      : [];
  if (q.type === "absence")
    return m.absentDays ? [`غياب ${m.absentDays} أيام`] : [];
  return [];
}
export function reportPeriod(preset: string, today: string) {
  const end = new Date(today + "T00:00:00Z"),
    start = new Date(end);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (preset === "week" || preset === "previous-week") {
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    if (preset === "previous-week") {
      end.setTime(start.getTime() - 3 * 86400000);
      start.setUTCDate(start.getUTCDate() - 7);
    } else {
      const friday = new Date(start);
      friday.setUTCDate(friday.getUTCDate() + 4);
      if (end > friday) end.setTime(friday.getTime());
    }
  } else if (preset === "month") start.setUTCDate(1);
  else if (preset === "previous-month") {
    end.setUTCDate(0);
    start.setTime(end.getTime());
    start.setUTCDate(1);
  }
  return { from: iso(start), to: iso(end) };
}
