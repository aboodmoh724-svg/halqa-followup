import { academyName, academyReportLogo } from "./branding";
import {
  englishDigits,
  reportNumber as n,
  reportPercent as percent,
} from "./report-format";
import type { SupervisionReport } from "./supervision-report";
import { reportDataNotice } from "./report-data-notice";
const escape = (v: unknown) =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const dataWarning = (report: SupervisionReport) => {
  const notice = reportDataNotice(report);
  return notice
    ? `<aside class="data-warning"><strong>تنبيه عند قراءة النتائج</strong><p>${escape(notice)}</p></aside>`
    : "";
};
type Row = SupervisionReport["rows"][number];
type Class = SupervisionReport["classes"][number];
const ratio = (part: number, total: number) =>
  total
    ? `<span class="nowrap">${n(part)} من ${n(total)}</span>`
    : '<span class="muted">لم تُسجل</span>';
const rate = (
  label: string,
  part: number,
  total: number,
  explanation: string,
) =>
  `<div class="rate"><div><b>${label}</b><strong>${percent(part, total)}</strong></div><div class="track"><i style="width:${total ? Math.min(100, (part / total) * 100) : 0}%"></i></div><small>${explanation}</small></div>`;
const metric = (label: string, value: number, unit = "") =>
  `<div class="metric"><span>${label}</span><strong>${n(value)}</strong><small>${unit}</small></div>`;
const rangeDate = (report: SupervisionReport) =>
  `<bdi>${escape(report.query.from)} — ${escape(report.query.to)}</bdi>`;
const heading = (report: SupervisionReport, title: string, kicker: string) =>
  `<header><div class="identity">${academyReportLogo}<div><strong>${escape(academyName)}</strong><small>قسم القرآن الكريم</small></div></div><div class="titles"><p class="eyebrow">${escape(kicker)}</p><h1>${escape(title)}</h1><p class="period">${rangeDate(report)} · ${n(report.studyDays)} أيام دراسية</p></div></header>`;
const rateCell = (part: number, total: number) =>
  `<b>${percent(part, total)}</b><small>${ratio(part, total)}</small>`;
const notesText = (row: Row) =>
  row.weeklyNotes.map((x) => `${x.date}: ${x.note}`).join("\n");
const noteCell = (row: Row) => {
  const text = notesText(row);
  return text.length > 180
    ? "ملاحظات مفصلة بعد الجدول"
    : text
      ? escape(text).replaceAll("\n", "<br>")
      : '<span class="muted">—</span>';
};
const notesAppendix = (rows: Row[]) => {
  const detailed = rows.filter((r) => notesText(r).length > 180);
  return detailed.length
    ? `<div class="notes-appendix"><h3>ملاحظات الفترة المفصلة · ${escape(rows[0]?.halqaName ?? "")}</h3>${detailed.map((r) => `<article><h4>${escape(r.name)}</h4>${r.weeklyNotes.map((x) => `<p><bdi>${escape(x.date)}</bdi> · ${escape(x.note)}</p>`).join("")}</article>`).join("")}</div>`
    : "";
};
function classMetrics(c: Class) {
  return `<div class="class-metrics">${metric("طالبًا", c.students)}${metric("صفحة حفظ", c.memoryPages)}${metric("صفحة مراجعة", c.reviewPages)}<div><strong>${percent(c.completedStudyDays, c.expectedStudyDays)}</strong><span>اكتمال التسجيل · ${ratio(c.completedStudyDays, c.expectedStudyDays)}</span></div><div><strong>${percent(c.memoryMasteredDays, c.memoryAssessedDays)}</strong><span>حافظ في الحفظ · ${ratio(c.memoryMasteredDays, c.memoryAssessedDays)}</span></div><div><strong>${percent(c.reviewMasteredDays, c.reviewAssessedDays)}</strong><span>حافظ في المراجعة · ${ratio(c.reviewMasteredDays, c.reviewAssessedDays)}</span></div></div>`;
}
function overview(report: SupervisionReport) {
  const s = report.summary;
  return `<section class="overview">${heading(report, report.title, "ملخص الإدارة · جميع الحلقات")}${dataWarning(report)}<div class="metrics">${metric("الطلاب الفريدون", s.students, `${n(report.classes.length)} حلقات · دون تكرار الطالب المنقول`)}${metric("أيام الطالب المسجلة", s.recordedStudyDays, `من ${n(s.expectedStudyDays)} يوم طالب متوقعًا`)}${metric("الحفظ المسجل", s.memoryPages, "صفحة · مجموع التسميع المتكرر")}${metric("المراجعة المسجلة", s.reviewPages, "صفحة · تشمل مسار المراجعة فقط")}</div><div class="rates">${rate("اكتمال التسجيل", s.completedStudyDays, s.expectedStudyDays, `${n(s.completedStudyDays)} سجل مكتمل من ${n(s.expectedStudyDays)} يوم طالب`)}${rate("الحضور المسجل", s.presentDays, s.presentDays + s.absentDays, `${n(s.presentDays)} حضورًا من ${n(s.presentDays + s.absentDays)} يوم له حضور أو غياب`)}${rate("حافظ في الحفظ", s.memoryMasteredDays, s.memoryAssessedDays, `${n(s.memoryMasteredDays)} من ${n(s.memoryAssessedDays)} يومًا مقيمًا للحفظ`)}${rate("حافظ في المراجعة", s.reviewMasteredDays, s.reviewAssessedDays, `${n(s.reviewMasteredDays)} من ${n(s.reviewAssessedDays)} يومًا مقيمًا للمراجعة`)}</div><h2>الحلقات خلال الفترة</h2><table class="summary-table"><colgroup><col style="width:10%"><col style="width:15%"><col style="width:6%"><col style="width:11%"><col style="width:8%"><col style="width:8%"><col style="width:8%"><col style="width:13%"><col style="width:13%"><col style="width:8%"></colgroup><thead><tr><th>الحلقة</th><th>المعلم</th><th>الطلاب</th><th>التسجيل<br>مسجل / متوقع</th><th>الاكتمال</th><th>الحفظ<br>صفحة</th><th>المراجعة<br>صفحة</th><th>حافظ في الحفظ</th><th>حافظ في المراجعة</th><th>الغياب<br>أيام</th></tr></thead><tbody>${report.classes.map((c) => `<tr><th>${escape(c.name)}</th><td>${escape(c.teacherName)}</td><td>${n(c.students)}</td><td>${ratio(c.recordedStudyDays, c.expectedStudyDays)}</td><td>${percent(c.completedStudyDays, c.expectedStudyDays)}</td><td>${n(c.memoryPages)}</td><td>${n(c.reviewPages)}</td><td>${rateCell(c.memoryMasteredDays, c.memoryAssessedDays)}</td><td>${rateCell(c.reviewMasteredDays, c.reviewAssessedDays)}</td><td>${n(c.absentDays)}</td></tr>`).join("")}</tbody><tfoot><tr><th colspan="2">القسم كاملًا</th><td>${n(s.students)}</td><td>${ratio(s.recordedStudyDays, s.expectedStudyDays)}</td><td>${percent(s.completedStudyDays, s.expectedStudyDays)}</td><td>${n(s.memoryPages)}</td><td>${n(s.reviewPages)}</td><td>${rateCell(s.memoryMasteredDays, s.memoryAssessedDays)}</td><td>${rateCell(s.reviewMasteredDays, s.reviewAssessedDays)}</td><td>${n(s.absentDays)}</td></tr></tfoot></table><p class="overview-explain">اكتمال التسجيل يشمل النتائج والمديات وواجب الحصة التالية؛ الغياب لا يتطلب واجبًا سابقًا. النسب من السجلات المتاحة ولا تقيس نسبة حفظ المصحف.</p><p class="footnote">الطالب المنقول يُحسب مرة واحدة في إجمالي القسم؛ يظهر سجل كل حلقة تحتها. المقادير بالصفحات مقربة لمنزلتين، ولا تثبت اعتماد شهادة.</p></section>`;
}
function unifiedClass(report: SupervisionReport, c: Class) {
  const rows = report.rows.filter((r) => r.halqaId === c.id);
  return `<section class="class-sheet">${heading(report, c.name, "متابعة الحلقة · جميع الطلاب")}<p class="class-meta">المعلم: ${escape(c.teacherName)}</p>${classMetrics(c)}<p class="legend">مثال: 3 من 4 تعني حافظ في 3 أيام من 4 أيام مقيمة. الغائب وغير المسجل لا يدخلان في مقام نسبة حافظ. «مراجعة فقط» لا تُعد نقصًا.</p><table class="pupils"><colgroup><col style="width:4%"><col style="width:19%"><col style="width:8%"><col style="width:9%"><col style="width:12%"><col style="width:12%"><col style="width:6%"><col style="width:10%"><col style="width:20%"></colgroup><thead><tr><th colspan="9" class="continued">${escape(c.name)} · ${escape(c.teacherName)} · ${rangeDate(report)}</th></tr><tr><th>م</th><th>اسم الطالب</th><th>الحفظ<br>صفحة</th><th>المراجعة<br>صفحة</th><th>حافظ في الحفظ<br>أيام من المقيمة</th><th>حافظ في المراجعة<br>أيام من المقيمة</th><th>الغياب<br>أيام</th><th>التسجيل<br>أيام من المتوقعة</th><th>ملاحظات الفترة</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td>${n(i + 1)}</td><th>${escape(r.name)}${!r.active ? "<small>سجل حلقة سابقة</small>" : ""}</th><td>${r.reviewOnly ? '<span class="track-only">مراجعة فقط</span>' : n(r.memoryPages)}</td><td>${n(r.reviewPages)}</td><td>${r.reviewOnly ? "—" : ratio(r.memoryMasteredDays, r.memoryAssessedDays)}</td><td>${ratio(r.reviewMasteredDays, r.reviewAssessedDays)}</td><td>${r.absentDays ? n(r.absentDays) : "—"}</td><td>${ratio(r.recordedStudyDays, r.expectedStudyDays)}</td><td class="note">${noteCell(r)}</td></tr>`).join("") || '<tr><td colspan="9">لا يوجد طلاب أو سجلات في هذه الحلقة خلال الفترة.</td></tr>'}</tbody><tfoot><tr><th colspan="2">إجمالي الحلقة</th><td>${n(c.memoryPages)}</td><td>${n(c.reviewPages)}</td><td>${ratio(c.memoryMasteredDays, c.memoryAssessedDays)}</td><td>${ratio(c.reviewMasteredDays, c.reviewAssessedDays)}</td><td>${n(c.absentDays)}</td><td>${ratio(c.recordedStudyDays, c.expectedStudyDays)}</td><td>${n(c.missingStudyDays)} يوم طالب دون تسجيل</td></tr></tfoot></table>${notesAppendix(rows)}</section>`;
}
function specialized(report: SupervisionReport) {
  if (report.query.type === "excellent") {
    const sections = [...report.classes]
      .sort(
        (a, b) =>
          Number(report.rows.some((r) => r.halqaId === b.id)) -
          Number(report.rows.some((r) => r.halqaId === a.id)),
      )
      .map((c) => {
        const members = report.rows.filter((r) => r.halqaId === c.id);
        if (!members.length)
          return `<section class="excellence-class empty-class"><h2>${escape(c.name)} <small>المعلم: ${escape(c.teacherName)}</small></h2><p class="muted">لا يوجد تسميع متقن مسجل يؤهل لقائمتي الحفظ أو المراجعة في هذه الفترة.</p></section>`;
        const table = (kind: "memory" | "review") => {
          const winners = members
            .filter(
              (r) => (kind === "memory" ? r.memoryRank : r.reviewRank) !== null,
            )
            .sort((a, b) =>
              kind === "memory"
                ? a.memoryRank! - b.memoryRank!
                : a.reviewRank! - b.reviewRank!,
            );
          return `<div class="leaderboard"><h3>${kind === "memory" ? "الأكثر حفظًا" : "الأكثر مراجعة"}</h3><table><thead><tr><th>الترتيب</th><th>الطالب</th><th>الصفحات المتقنة</th></tr></thead><tbody>${winners.map((r) => `<tr><td>${n(kind === "memory" ? r.memoryRank! : r.reviewRank!)}</td><th>${escape(r.name)}${r.reviewOnly ? "<small>مراجعة فقط</small>" : ""}</th><td><b>${n(kind === "memory" ? r.masteredMemoryPages : r.masteredReviewPages)}</b></td></tr>`).join("") || '<tr><td colspan="3">لا يوجد إنجاز متقن مسجل لهذا المسار.</td></tr>'}</tbody></table></div>`;
        };
        return `<section class="excellence-class"><h2>${escape(c.name)} <small>المعلم: ${escape(c.teacherName)}</small></h2>${table("memory")}${table("review")}</section>`;
      })
      .join("");
    return `${heading(report, report.title, "روّاد الحلقات · الحفظ والمراجعة")}${dataWarning(report)}<div class="metrics">${metric("طلاب متميزون دون تكرار", report.summary.students)}${metric("قوائم الحلقات", report.classes.length)}${metric("متميزون في الحفظ", report.rows.filter((r) => r.memoryRank !== null).length)}${metric("متميزون في المراجعة", report.rows.filter((r) => r.reviewRank !== null).length)}</div><p class="criteria">${escape(report.criteria)}</p><p class="explain">المقادير مجموع أنشطة التسميع المتقنة المسجلة، مع التصحيحات. الأيام الناقصة لا تعد صفرًا؛ الترتيب يعكس البيانات المتاحة فقط. الأرقام مقربة للعرض، والترتيب يستخدم دقة الحساب الأصلية.</p>${sections || '<p class="empty">لا توجد حلقات في النطاق المختار.</p>'}`;
  }
  const s = report.summary;
  const lead =
    report.query.type === "absence"
      ? "الغياب المسجل وتواريخه"
      : report.query.type === "support"
        ? "أسباب المتابعة ونتائج الطالب"
        : "سجل الطالب خلال الفترة";
  const sections = report.classes
    .map((c) => {
      const rows = report.rows.filter((r) => r.halqaId === c.id);
      if (report.query.type === "student")
        return `<section class="special-class"><h2>${escape(c.name)} <small>المعلم: ${escape(c.teacherName)}</small></h2>${rows.map((r) => `<h3>${escape(r.name)}</h3>${r.days.map((d) => `<article class="student-day"><h4><bdi>${escape(d.date)}</bdi> · ${!d.recorded ? "لم يُسجل" : d.assessment === "ABSENT" ? "غائب" : d.assessment === "MEMORIZED" ? "حافظ" : d.assessment === "NOT_MEMORIZED" ? "غير حافظ" : "النتيجة غير مكتملة"}</h4>${d.entries.map((x) => `<p><b>${x.kind === "MEMORIZATION" ? "حفظ" : "مراجعة"}:</b> ${escape(x.range)}</p>`).join("") || '<p class="muted">لا يوجد تسميع مسجل.</p>'}${d.note ? `<p class="note">${escape(d.note)}</p>` : ""}</article>`).join("")}`).join("")}</section>`;
      const head =
        report.query.type === "absence"
          ? "<th>الطالب</th><th>أيام الغياب</th><th>التواريخ</th><th>ملاحظات الفترة</th>"
          : report.query.type === "support"
            ? "<th>الطالب</th><th>سبب المتابعة</th><th>الحفظ المتقن<br>صفحة</th><th>الحد الأسبوعي<br>صفحة</th>"
            : "<th>الطالب</th><th>الحفظ<br>صفحة</th><th>المراجعة<br>صفحة</th><th>حافظ في الحفظ</th><th>حافظ في المراجعة</th>";
      const body = rows
        .map((r) =>
          report.query.type === "absence"
            ? `<tr><th>${escape(r.name)}</th><td>${n(r.absentDays)}</td><td>${r.absentDates.map((d) => `<bdi>${escape(d)}</bdi>`).join("<br>")}</td><td class="note">${noteCell(r)}</td></tr>`
            : report.query.type === "support"
              ? `<tr><th>${escape(r.name)}${r.reviewOnly ? "<small>مراجعة فقط</small>" : ""}</th><td class="note">${r.reasons.map(escape).join("<br>")}${r.latestNote ? `<p>${escape(r.latestNote)}</p>` : ""}</td><td>${n(r.masteredMemoryPages)}</td><td>${r.weeklyMinimumPages ?? "—"}</td></tr>`
              : `<tr><th>${escape(r.name)}${r.reviewOnly ? "<small>مراجعة فقط</small>" : ""}</th><td>${r.reviewOnly ? "—" : n(r.memoryPages)}</td><td>${n(r.reviewPages)}</td><td>${r.reviewOnly ? "—" : ratio(r.memoryMasteredDays, r.memoryAssessedDays)}</td><td>${ratio(r.reviewMasteredDays, r.reviewAssessedDays)}</td></tr>`,
        )
        .join("");
      return `<section class="special-class"><table><thead><tr><th colspan="4" class="continued">${escape(c.name)} · ${escape(c.teacherName)}</th></tr><tr>${head}</tr></thead><tbody>${body}</tbody></table>${notesAppendix(rows)}</section>`;
    })
    .join("");
  return `${heading(report, report.title, lead)}${dataWarning(report)}<div class="metrics">${metric("الطلاب", s.students)}${metric(report.query.type === "support" ? "الحفظ الجديد المتقن · صفحة" : "الحفظ · صفحة", report.query.type === "support" ? s.masteredMemoryPages : s.memoryPages)}${metric("المراجعة · صفحة", s.reviewPages)}${metric("الغياب · أيام", s.absentDays)}</div><p class="criteria">${escape(report.criteria)}</p><p class="explain">شروط التقرير المختارة لا تعني اعتماد شهادة أو تشخيصًا نهائيًا لمستوى الطالب. النسب لا تقيس نسبة حفظ المصحف.</p>${sections || (report.query.type === "support" && report.supportUnassessedCount > 0 ? '<p class="empty">لا توجد حالات مثبتة، مع وجود طلاب لم تكف بياناتهم للتصنيف.</p>' : '<p class="empty">لا يوجد طلاب مطابقون للشروط في الفترة المحددة.</p>')}`;
}
export function supervisionReportMarkup(
  report: SupervisionReport,
  fontCss: string,
) {
  const unified = report.query.type === "comprehensive";
  return englishDigits(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>${fontCss}
@page{size:A4 ${unified ? "landscape" : "portrait"};margin:10mm 10mm 15mm}*{box-sizing:border-box}body{margin:0;color:#17324d;font:11px/1.6 CairoArabic,CairoLatin,sans-serif}header{display:flex;align-items:center;gap:20px;border-bottom:2px solid #19786e;padding-bottom:10px;margin-bottom:13px}.identity{display:flex;align-items:center;gap:9px;min-width:190px}.identity strong{font-size:16px}.identity small{display:block}.titles{flex:1}h1{font-size:23px;margin:0;line-height:1.5}h2{font-size:15px;margin:10px 0 7px}h3{font-size:13px;margin:12px 0 5px}h4{font-size:11px;margin:6px 0}p{margin:4px 0}.eyebrow{font-size:10px;color:#19786e;font-weight:700}.period,small,.muted{color:#6b7e8b}.period{font-size:10px}small{display:block;font-size:8px;line-height:1.4}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:13px;margin:10px 0}.metric{padding:0 10px 5px;border-right:2px solid #dfebe8}.metric>span{font-size:10px}.metric strong{display:block;font-size:26px;line-height:1.35}.rates{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;background:#f2f8f6;padding:9px 12px;border-radius:5px;margin:10px 0 12px}.rate>div:first-child{display:flex;justify-content:space-between;align-items:center}.rate b{font-size:10px}.rate strong{font-size:21px;color:#19786e}.rate small{font-size:8px}.track{height:4px;background:#dce8e5;margin:5px 0}.track i{display:block;height:100%;background:#19786e}table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:10.5px;line-height:1.5}thead{display:table-header-group}thead th{background:#173e50;color:white;font-size:10px;padding:7px 5px}th,td{padding:4px 6px;text-align:center;border-bottom:1px solid #dfe7eb;vertical-align:middle;overflow-wrap:anywhere}tbody th{text-align:right;font-weight:700}tbody tr:nth-child(even){background:#f5f8fa}tr{break-inside:avoid}tfoot{display:table-row-group;background:#e5f1ed;font-weight:700}tfoot th{font-size:10px}.nowrap,bdi{white-space:nowrap}.explain-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:11px;font-size:9px}.memo{background:#f4f8f6;border-right:3px solid #19786e;padding:7px 10px}.explain{font-size:9px;color:#637a88}.footnote,.legend{font-size:8px;color:#6c818c;margin:7px 0}.class-sheet{break-before:page}.class-meta{font-size:10px;color:#647b87;margin-top:-7px;margin-bottom:9px}.class-metrics{display:grid;grid-template-columns:repeat(6,1fr);background:#f3f8f6;padding:8px 0;margin-bottom:11px}.class-metrics>div{text-align:center;border-left:1px solid #dce8e4;padding:0 5px}.class-metrics strong{font-size:20px;display:block;line-height:1.4}.class-metrics span{display:block;font-size:8px;color:#647a87}.class-metrics .metric{border-right:0;margin:0}.continued{font-size:10px;text-align:right;padding:6px;background:#285567}.pupils{font-size:11px;line-height:1.25}.pupils td,.pupils tbody th{padding:1px 5px}.class-sheet header{padding-bottom:6px;margin-bottom:8px}.class-sheet .class-metrics{padding:5px 0;margin-bottom:6px}.class-sheet .legend{margin:4px 0 6px}.data-warning{border:1px solid #ba8a39;border-right:4px solid #ad7926;background:#fff7e8;padding:8px 12px;margin:10px 0;font-size:11px;break-inside:avoid}.data-warning strong{color:#7b5416}.data-warning p{margin:3px 0}.pupils .note{font-size:9px}.note{text-align:right;white-space:pre-wrap}.track-only{font-size:9px;color:#19786e}.notes-appendix article{border-bottom:1px solid #e0e8ec;padding:5px 0}.notes-appendix p{white-space:pre-wrap;font-size:10px;overflow-wrap:anywhere;break-inside:avoid}.criteria{border-right:3px solid #ad8747;background:#fbf6e9;padding:9px 12px;font-size:10px}.excellence-class{margin-top:18px;break-inside:avoid}.excellence-class+.excellence-class{border-top:1px solid #dfe7eb;padding-top:12px}.empty-class{margin-top:10px;padding:8px 10px;background:#f5f8fa}.empty-class h2{margin:0 0 4px}.leaderboard{margin:12px 0 20px}.leaderboard h3{color:#19786e}.leaderboard th:first-child{width:18%}.leaderboard th:last-child{width:24%}.special-class{margin-top:18px}.special-class+.special-class{break-before:page}.student-day{border-bottom:1px solid #dfe7eb;padding:10px 0;break-inside:avoid}.student-day p{font-size:11px;overflow-wrap:anywhere;white-space:pre-wrap}.empty{text-align:center;padding:30px}.special-class table{font-size:11px}.special-class td,.special-class th{padding:8px 6px}.summary-table td,.summary-table tbody th,.summary-table tfoot th{padding:2px 5px;line-height:1.2}.summary-table small{line-height:1.1}.overview header{padding-bottom:6px;margin-bottom:8px}.overview .data-warning{padding:5px 10px;margin:6px 0;font-size:10px}.overview-explain{font-size:8px;line-height:1.4;margin:6px 0}.overview .metric strong{font-size:24px}.overview .rate strong{font-size:18px}.overview .metrics{margin:7px 0}.overview .rates{margin:8px 0}.overview .explain-grid{margin-top:8px}h2,h3,h4{break-after:avoid}.notes-appendix article{break-inside:avoid}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}
</style></head><body>${unified ? overview(report) + report.classes.map((c) => unifiedClass(report, c)).join("") : specialized(report)}<p class="footnote">تقرير إشرافي للاستخدام المدرسي · إصدار ${escape(report.generatedAt.slice(0, 10))} · جميع المقادير محسوبة من الآيات وفق المصحف المدني 604 صفحة.</p></body></html>`);
}
