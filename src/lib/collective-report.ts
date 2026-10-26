import { academyName } from "./branding";
import { rangeText, rangeDescription, totalPages, formatPages } from "./quran";
import {
  assessmentLabels,
  type Assessment,
  type DayView,
  type StudentView,
} from "./types";
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function collectiveReportMarkup(
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
  const assignment = (a: StudentView["today"]) =>
    `<div><b>حفظ:</b> ${escape(rangeDescription(a?.memorization))}</div><div><b>مراجعة:</b> ${escape(rangeDescription(a?.review))}</div>`;
  const actual = (s: StudentView, kind: "MEMORIZATION" | "REVIEW") => {
    const result =
      kind === "MEMORIZATION" ? s.memorizationResult : s.reviewResult;
    const absent = s.outcome === "ABSENT";
    const label = absent
      ? "غائب"
      : result
        ? assessmentLabels[result as Assessment]
        : "لم تسجل النتيجة";
    const style = absent
      ? "absent"
      : result === "MASTERED"
        ? "mastered"
        : result === "NOT_MASTERED"
          ? "not-mastered"
          : "pending";
    const entries = s.entries.filter((e) => e.kind === kind);
    const ranges = new Map<string, number>();
    for (const e of entries) {
      const text = rangeText(e);
      ranges.set(text, (ranges.get(text) ?? 0) + 1);
    }
    return `<span class="result ${style}">${escape(label)}</span>${absent ? '<div class="muted">لم يحضر</div>' : Array.from(ranges, ([text, count]) => `<div>${escape(text)}${count > 1 ? ` <span class="muted">(${count} تسميعات)</span>` : ""}</div>`).join("") || '<div class="muted">لا يوجد تسميع</div>'}${!absent ? `<div class="amount">${formatPages(totalPages(entries))} صفحة</div>` : ""}`;
  };
  const rows = students
    .map((s, i) => {
      const notes = [
        s.note,
        s.tomorrow?.note ? `واجب الغد: ${s.tomorrow.note}` : "",
      ].filter(Boolean);
      return `<tr data-student="${escape(s.enrollmentId)}"><td class="student"><span class="number">${i + 1}</span>${escape(s.name)}</td><td>${actual(s, "MEMORIZATION")}</td><td>${actual(s, "REVIEW")}</td><td class="homework">${assignment(s.tomorrow)}</td><td class="notes">${notes.length ? notes.map((n) => `<div>${escape(n!)}</div>`).join("") : "—"}</td></tr>`;
    })
    .join("");
  return `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><style>${fontCss}
 @page{size:A3 portrait;margin:0}*{box-sizing:border-box}body{margin:0;color:#183b50;font:14px/1.65 CairoArabic,CairoLatin,sans-serif}.page{position:relative;width:297mm;height:420mm;padding:10mm;background:#fff;overflow:hidden}.content{transform-origin:top right}header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #19786e;padding-bottom:10px;margin-bottom:12px}.brand{font-size:23px;font-weight:700;color:#19786e}h1{font-size:23px;margin:2px 0 5px}p{margin:3px 0}.meta{color:#64748b;font-size:13px}table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:var(--table-font-size,13px);line-height:1.5}th{background:#19786e;color:white;font-size:14px;font-weight:700;padding:10px 8px;text-align:right}td{padding:5px 7px;border:1px solid #dce5e3;vertical-align:middle;overflow-wrap:anywhere}tbody tr:nth-child(even){background:#f6f8f7}.student{font-weight:700;font-size:inherit}.number{display:inline-block;color:#19786e;font-size:12px;margin-inline-end:7px}.result{display:inline-block;padding:2px 9px;border-radius:6px;font-size:.95em;font-weight:700;margin-bottom:3px}.mastered{background:#dff3e7;color:#176241}.not-mastered{background:#fce3e3;color:#a12d35}.absent,.pending{background:#edf0f3;color:#596574}.amount{color:#19786e;font-size:.9em;font-weight:700;margin-top:2px}.muted{color:#76828f;font-size:.9em}.homework{background:#fbf6e9}.notes{white-space:pre-wrap;font-size:inherit;color:#465363}.notes div+div{margin-top:4px}footer{position:absolute;bottom:7mm;left:10mm;right:10mm;}col.name{width:17%}col.actual{width:23%}col.tomorrow{width:22%}col.note{width:15%}
 </style><body><section class="page"><div class="content"><header><div><div class="brand">${escape(academyName)}</div><h1>التقرير اليومي لأولياء الأمور</h1><p class="meta">${escape(day.halqaName)} · ${escape(date)}</p></div><div class="meta">المعلم<br><strong>${escape(day.teacherName)}</strong></div></header><table><colgroup><col class="name"><col class="actual"><col class="actual"><col class="tomorrow"><col class="note"></colgroup><thead><tr><th>اسم الطالب</th><th>الحفظ الذي سمّعه</th><th>المراجعة التي سمّعها</th><th>واجب الغد</th><th>الملاحظات</th></tr></thead><tbody>${rows}</tbody></table></div><footer aria-hidden="true"></footer></section></body></html>`;
}
