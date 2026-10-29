import { academyName, academyReportLogo } from "./branding";
import { assignmentDateLabel } from "./dates";
import {
  ayahAmount,
  rangeText,
  entryPages,
  totalPages,
  formatPages,
  rangeDescription,
} from "./quran";
import {
  assessmentLabels,
  type Assessment,
  type DayView,
  type StudentView,
} from "./types";
import {
  escapeReportText as escape,
  reportIcon,
  resultBadge,
  resultView,
  reportVisualCss,
} from "./report-visuals";

export function studentReportMarkup(
  day: DayView,
  students: StudentView[],
  fontCss: string,
) {
  const date = new Intl.DateTimeFormat("ar", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day.date}T00:00:00Z`));
  const kinds = ["MEMORIZATION", "REVIEW"] as const;
  const kindName = (kind: (typeof kinds)[number]) =>
    kind === "MEMORIZATION" ? "الحفظ الجديد" : "المراجعة";
  const pages = students
    .map((s) => {
      const outcome = resultView(s);
      const activities = s.reviewOnly
        ? kinds.filter((kind) => kind === "REVIEW")
        : kinds;
      const tiles = activities
        .map(
          (kind) =>
            `<article class="result-card ${resultView(s, kind).style}"><h2 class="section-title">${reportIcon(kind === "MEMORIZATION" ? "book" : "review")}${kindName(kind)}</h2>${resultBadge(s, kind)}<p class="total">${formatPages(totalPages(s.entries.filter((e) => e.kind === kind)))} صفحة</p></article>`,
        )
        .join("");
      const entries = activities
        .map((kind) => {
          const list = s.entries
            .filter((e) => e.kind === kind)
            .map(
              (e) =>
                `<li><span>${escape(rangeText(e))}</span><small>${formatPages(entryPages(e))} صفحة · ${ayahAmount(e)} آية${e.assessment ? ` · عند التسميع: ${escape(assessmentLabels[e.assessment as Assessment] ?? "سجل سابق")}` : ""}</small></li>`,
            )
            .join("");
          return `<div class="activity"><h3>${kindName(kind)}</h3><p class="assessment">النتيجة النهائية: ${escape(resultView(s, kind).label)}</p><ul>${list || "<li class='muted'>لا يوجد تسميع مسجل</li>"}</ul></div>`;
        })
        .join("");
      const note = s.note
        ? `<article class="note-callout teacher-note"><h2 class="section-title">${reportIcon("note")}ملاحظة المعلم</h2><p class="note">${escape(s.note)}</p></article>`
        : "";
      return `<section class="page"><div class="content"><header><div class="brand">${academyReportLogo}<span>${escape(academyName)}</span></div><p class="report-title">التقرير اليومي لأولياء الأمور</p><p>${escape(day.halqaName)} · ${escape(date)}</p></header><h1>${escape(s.name)}</h1>${s.reviewOnly ? `<p class="track-label">${reportIcon("review")}طالب حافظ · مراجعة فقط</p>` : ""}<div class="daily-status ${outcome.style}"><span class="eyebrow">خلاصة اليوم</span>${resultBadge(s)}${!s.memorizationResult && !s.reviewResult && s.outcome !== "ABSENT" ? "<small>نتيجة سابقة؛ لم تسجل نتائج مستقلة للحفظ والمراجعة</small>" : ""}</div><div class="result-grid ${s.reviewOnly ? "single" : ""}">${tiles}</div>${note}<article class="assignment"><h2 class="section-title">${reportIcon("calendar")}واجب الغد</h2><p class="subtle">موعد الواجب: ${escape(assignmentDateLabel(day.date))}</p>${!s.reviewOnly ? `<div class="homework-row"><b>${reportIcon("book")} الحفظ:</b><span>${escape(rangeDescription(s.tomorrow?.memorization))}</span></div>` : ""}<div class="homework-row"><b>${reportIcon("review")} المراجعة:</b><span>${escape(rangeDescription(s.tomorrow?.review))}</span></div>${s.tomorrow?.note ? `<div class="homework-note note-callout"><span class="note-label">${reportIcon("note")}ملاحظة الواجب</span><p class="note">${escape(s.tomorrow.note)}</p></div>` : ""}</article><article class="actual"><h2 class="section-title">${reportIcon("book")}تسميع اليوم</h2>${entries}</article></div><footer>${escape(day.teacherName)}<span>${escape(date)}</span></footer></section>`;
    })
    .join("");
  return `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><style>${fontCss}
    @page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;color:#17324d;font:15px/1.65 CairoArabic,CairoLatin,sans-serif}.page{position:relative;width:210mm;height:297mm;padding:12mm 15mm;background:#f6f5f1;break-after:page;overflow:hidden}.page:last-child{break-after:auto}.content{transform-origin:top right}header{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;border-bottom:2px solid #19786e;padding-bottom:10px;margin-bottom:13px;gap:2px 15px}header p{color:#566579;margin:0}.brand{font-size:19px;color:#19786e;font-weight:700}.report-title{font-size:14px;font-weight:700}h1{font-size:29px;line-height:1.5;margin:0 0 12px}h2{font-size:18px;margin:0 0 9px}h3{font-size:14px;margin:0 0 2px}p{margin:5px 0}.daily-status{display:flex;align-items:center;gap:14px;border:2px solid currentColor;border-radius:14px;padding:9px 17px;margin-bottom:12px;flex-wrap:wrap}.daily-status .result{font-size:30px;padding:0;background:transparent}.daily-status small{flex-basis:100%;font-size:11px}.eyebrow{font-size:14px;font-weight:700}.result-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}.result-grid.single{grid-template-columns:1fr}.track-label{color:#455464;font-weight:700;margin:0 0 10px}.result-card{margin:0;border:1px solid currentColor;padding:11px 15px}.result-card h2{font-size:16px}.result-card .result{font-size:23px;padding:0;background:transparent}.total{font-size:13px;font-weight:700;margin:2px 0 0}article{background:#fff;border-radius:12px;padding:14px 17px;margin-bottom:12px}.teacher-note p{font-weight:700;font-size:16px}.assignment{border:1px solid #9badc0}.assignment h2{color:#17324d}.homework-row{display:flex;align-items:baseline;gap:12px;margin:6px 0}.homework-row b{min-width:90px}.homework-row .report-icon{width:19px;height:19px}.homework-note{padding:9px 12px;border-radius:9px;margin-top:10px}.homework-note p{margin-bottom:0}.activity+.activity{border-top:1px solid #dfe6e2;margin-top:9px;padding-top:9px}.assessment{font-size:12px;color:#526579}ul{padding:0;list-style:none;margin:0}li{display:flex;justify-content:space-between;gap:12px;padding:4px 0;border-bottom:1px solid #eff2ef;font-size:13px}li:last-child{border:0}li small,.muted{color:#526579;font-size:11px}footer{position:absolute;bottom:8mm;left:15mm;right:15mm;border-top:1px solid #dce1df;padding-top:7px;color:#526579;font-size:11px;display:flex;justify-content:space-between;gap:12px}${reportVisualCss}
  </style><body>${pages}</body></html>`;
}
