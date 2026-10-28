import { academyName } from "./branding";
import { formatPages } from "./quran";
import type { SupervisionReport } from "./supervision-report";
const escape = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
export function supervisionReportMarkup(
  report: SupervisionReport,
  fontCss: string,
) {
  const e = escape;
  const classes = [...new Set(report.rows.map((r) => r.halqaId))];
  const sections = classes
    .map((id) => {
      const rows = report.rows.filter((r) => r.halqaId === id),
        h = rows[0];
      return `<section><table><thead><tr><th colspan="8" class="section-title">${e(h.halqaName)} <span>المعلم: ${e(h.teacherName)} · ${rows.length} طالب</span></th></tr><tr><th>الطالب</th><th>أيام مقيمة / مسجلة</th><th>حافظ / غير حافظ</th><th>غياب</th><th>الحفظ المسجل</th><th>المراجعة المسجلة</th><th>آخر تسميع في الفترة</th><th>المتابعة والملاحظة</th></tr></thead><tbody>${rows.map((r) => `<tr><td><strong>${e(r.name)}</strong><small>${r.reviewOnly ? "مراجعة فقط" : "حفظ ومراجعة"}${r.active ? "" : " · غير نشط حاليًا"}</small></td><td>${r.assessedDays} / ${r.recordedDays}<small>${r.pendingDays ? `${r.pendingDays} سجلات ناقصة` : ""}</small></td><td>${r.masteredDays} / ${r.notMasteredDays}<small>حفظ متقن: ${r.memoryMasteredDays}/${r.memoryAssessedDays}<br>مراجعة متقنة: ${r.reviewMasteredDays}/${r.reviewAssessedDays}</small><small>${r.masteryRate === null ? "لا توجد أيام مقيمة" : `إتقان ${r.masteryRate}%`}</small></td><td>${r.absentDays}${report.query.type === "absence" ? `<small>${r.absentDates.map(e).join("<br>")}</small>` : ""}</td><td>${formatPages(r.memoryPages)} صفحة</td><td>${formatPages(r.reviewPages)} صفحة</td><td>${r.lastMemory ? `<b>حفظ:</b> ${e(r.lastMemory)}<br>` : ""}${r.lastReview ? `<b>مراجعة:</b> ${e(r.lastReview)}` : ""}${!r.lastMemory && !r.lastReview ? "لا يوجد تسميع مسجل" : ""}</td><td>${r.reasons.map(e).join("<br>")}${r.latestNote ? `<p>${e(r.latestNote)}</p>` : ""}</td></tr>`).join("")}</tbody></table></section>`;
    })
    .join("");
  const details =
    report.query.type === "student"
      ? report.rows
          .map(
            (r) =>
              `<section><h2>السجل التفصيلي: ${e(r.name)}</h2>${r.days.map((d) => `<article><h3>${e(d.date)} · ${d.assessment === "ABSENT" ? "غائب" : d.assessment === "MEMORIZED" ? "حافظ" : d.assessment === "NOT_MEMORIZED" ? "غير حافظ" : "التسجيل غير مكتمل"}</h3><p>${d.entries.map((x) => `${x.kind === "MEMORIZATION" ? "حفظ" : "مراجعة"}: ${e(x.range)}`).join("<br>") || "لا يوجد تسميع مسجل"}</p>${d.note ? `<p class="note">${e(d.note)}</p>` : ""}</article>`).join("")}</section>`,
          )
          .join("")
      : "";
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>${fontCss}
 @page{size:A4 landscape;margin:12mm 10mm 16mm}*{box-sizing:border-box}body{font-family:CairoArabic,CairoLatin,sans-serif;font-size:11px;color:#17324d;line-height:1.65;margin:0}header{border-bottom:3px solid #19786e;padding-bottom:12px;margin-bottom:15px;display:flex;justify-content:space-between;align-items:center}h1{font-size:24px;margin:0}h2{font-size:19px}h3{margin:0}p{margin:5px 0}header aside{text-align:left;font-size:11px}.brand{color:#19786e;font-size:13px;font-weight:700}.summary{display:flex;gap:25px;background:#edf4f0;border:1px solid #dce6df;border-radius:10px;padding:12px;margin:12px 0}.summary strong{font-size:18px}.criteria{background:#fbf4e6;border-right:3px solid #b58a3b;padding:9px 12px;margin-bottom:15px}.explain{font-size:10px;color:#596b76}section+section{break-before:page}table{border-collapse:collapse;width:100%;table-layout:fixed}thead{display:table-header-group}th,td{padding:9px 6px;vertical-align:top;border-bottom:1px solid #dfe6e1;overflow-wrap:anywhere;text-align:right}th{background:#eaf2ee;font-size:10px}tr{break-inside:avoid}td:nth-child(1){width:15%}th:nth-child(1){width:15%}th:nth-child(2){width:8%}th:nth-child(3){width:10%}th:nth-child(4){width:6%}th:nth-child(5),th:nth-child(6){width:9%}th:nth-child(7){width:23%}th:nth-child(8){width:20%}tbody tr:nth-child(even){background:#fafbf9}.section-title{background:#174d47;color:white;font-size:15px;padding:12px}.section-title span{font-size:11px;font-weight:400;margin-right:20px}small{display:block;font-size:9px;color:#647482;margin-top:3px}td p,.note{white-space:pre-wrap}article{border-bottom:1px solid #dfe6e1;padding:12px 0;break-inside:avoid}.empty{padding:35px;text-align:center;border:1px solid #dfe6e1;border-radius:12px}.footer{margin-top:15px;color:#647482;font-size:9px}
 </style></head><body><header><div><div class="brand">${e(academyName)}</div><h1>${e(report.title)}</h1></div><aside>قسم القرآن الكريم<br>الفترة: <bdi>${e(report.query.from)} - ${e(report.query.to)}</bdi><br>تاريخ الإصدار: ${e(report.generatedAt.slice(0, 10))}</aside></header><div class="summary"><div><strong>${report.summary.students}</strong> طالب</div><div><strong>${formatPages(report.summary.memoryPages)}</strong> صفحة حفظ مسجلة</div><div><strong>${formatPages(report.summary.reviewPages)}</strong> صفحة مراجعة مسجلة</div><div><strong>${report.summary.absentDays}</strong> حالات غياب يومية</div></div><p class="criteria">${e(report.criteria)}</p><p class="explain">اليوم المقيم هو يوم اكتملت فيه نتائج الحفظ والمراجعة، أو المراجعة وحدها لمسار المراجعة فقط. نسبة الإتقان نسبة أيام «حافظ» إلى الأيام المقيمة؛ لا تقيس نسبة حفظ المصحف. لا تُفترض نتيجة للأيام دون تسجيل.</p>${sections || '<div class="empty">لا يوجد طلاب مطابقون للشروط في الفترة المحددة.</div>'}${details}<p class="footer">تقرير إشرافي للاستخدام المدرسي · كميات التسميع المتكررة لا تثبت إتمام سورة أو جزء ولا اعتماد شهادة.</p></body></html>`;
}
