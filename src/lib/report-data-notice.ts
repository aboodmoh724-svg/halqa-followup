import type { SupervisionReport } from "./supervision-report";
export function reportDataNotice(report: SupervisionReport): string | null {
  const s = report.summary;
  if (
    report.query.type === "comprehensive" &&
    s.completedStudyDays < s.expectedStudyDays
  )
    return `بيانات الفترة غير مكتملة: سُجل ${s.recordedStudyDays} من ${s.expectedStudyDays} يوم طالب متوقعًا، واكتمل ${s.completedStudyDays} فقط. عدم التسجيل لا يعني غيابًا أو ضعفًا؛ لا تعتمد هذه البيانات وحدها لتقييم مستوى القسم.`;
  if (report.query.type === "support" && report.supportUnassessedCount > 0)
    return `بيانات غير كافية للتصنيف: لم يُصنف ${report.supportUnassessedCount} طالبًا لنقص بيانات الأسبوع أو عدم تحديد الصف. عدم ظهورهم في القائمة لا يعني بلوغ الحد الأسبوعي، ولا يعني ضعفهم.`;
  if (report.query.type === "excellent")
    return "الترتيب حسب البيانات المتاحة: تُعرض أعلى مقادير التسميع المتقن المسجلة فقط. لا يعني غياب الطالب أو الحلقة عن القوائم انخفاض المستوى، ولا تُملأ المراكز بطلاب دون إنجاز مسجل.";
  return null;
}
