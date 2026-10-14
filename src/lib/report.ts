import { readFile } from "node:fs/promises";
import { academyName } from "./branding";
import path from "node:path";
import { chromium } from "playwright";
import { HttpError } from "./auth";
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
  labels,
  type DayView,
  type StudentView,
} from "./types";
function escape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
let active = 0;
export function reportMarkup(
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
  const pages = students
    .map((s) => {
      const entries = (kind: "MEMORIZATION" | "REVIEW") =>
        s.entries
          .filter((e) => e.kind === kind)
          .map(
            (e) =>
              `<li>${escape(rangeText(e))}<span>${formatPages(entryPages(e))} صفحة · ${ayahAmount(e)} آية${e.assessment ? ` · ${assessmentLabels[e.assessment as Assessment]}` : ""}</span></li>`,
          )
          .join("") || "<li class='muted'>لا يوجد تسميع مسجل</li>";
      return `<section class="page"><div class="content"><header><div class="brand">${escape(academyName)}</div><p>${escape(day.halqaName)} · ${escape(date)}</p></header><h1>${escape(s.name)}</h1><div class="status ${s.outcome}">${s.outcome === "ABSENT" ? "غائب" : s.memorizationResult || s.reviewResult ? "نتائج الحفظ والمراجعة" : s.outcome ? `نتيجة سابقة: ${labels[s.outcome]}` : "بانتظار النتيجة"}</div><div class="actual"><article><h2>الحفظ الذي سمعه</h2><p class="assessment">النتيجة: ${s.outcome === "ABSENT" ? "غائب" : s.memorizationResult ? assessmentLabels[s.memorizationResult as Assessment] : "لم تُسجل نتيجة مستقلة"}</p><p>الإجمالي: ${formatPages(totalPages(s.entries.filter((e) => e.kind === "MEMORIZATION")))} صفحة</p><ul>${entries("MEMORIZATION")}</ul></article><article><h2>المراجعة</h2><p class="assessment">النتيجة: ${s.outcome === "ABSENT" ? "غائب" : s.reviewResult ? assessmentLabels[s.reviewResult as Assessment] : "لم تُسجل نتيجة مستقلة"}</p><p>الإجمالي: ${formatPages(totalPages(s.entries.filter((e) => e.kind === "REVIEW")))} صفحة</p><ul>${entries("REVIEW")}</ul></article></div><article class="assignment"><h2>واجب الغد</h2><p><b>الحفظ:</b> ${escape(rangeDescription(s.tomorrow?.memorization))}</p><p><b>المراجعة:</b> ${escape(rangeDescription(s.tomorrow?.review))}</p>${s.tomorrow?.note ? `<p class="note"><b>ملاحظة الواجب:</b> ${escape(s.tomorrow.note)}</p>` : ""}</article>${s.note ? `<article><h2>ملاحظة اليوم</h2><p class="note">${escape(s.note)}</p></article>` : ""}</div><footer>${escape(day.teacherName)}<span>تقرير المتابعة اليومي · ${escape(date)}</span></footer></section>`;
    })
    .join("");
  return `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><style>${fontCss}
    @page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;color:#17324d;font:16px/1.8 CairoArabic,CairoLatin,sans-serif}.page{position:relative;width:210mm;height:297mm;padding:17mm;background:#f6f5f1;break-after:page;overflow:hidden}.page:last-child{break-after:auto}.content{transform-origin:top right}header{border-bottom:2px solid #19786e;padding-bottom:18px;margin-bottom:24px}header p{color:#667085;margin:4px 0}.brand{font-size:20px;color:#19786e;font-weight:700}h1{font-size:30px;margin:0 0 12px}h2{font-size:18px;margin:0 0 10px}p{margin:6px 0}.status{border-radius:16px;padding:14px 20px;font-size:27px;font-weight:700;margin-bottom:24px;background:#f2f3f4;color:#667085}.MEMORIZED{background:#e9f4f1;color:#19786e}.NOT_MEMORIZED{background:#fbecec;color:#a03f3f}article{background:#fff;border-radius:16px;padding:18px 22px;margin-bottom:16px}.assignment{background:#fbf4e6}.assignment h2{color:#94621b}ul{padding:0;list-style:none;margin:0}li{display:flex;justify-content:space-between;gap:16px;padding:6px 0;border-bottom:1px solid #f1f1ee}li:last-child{border:0}li span,.muted{color:#667085;font-size:13px}.note{white-space:pre-wrap;overflow-wrap:anywhere}footer{position:absolute;bottom:12mm;left:17mm;right:17mm;border-top:1px solid #dce1df;padding-top:10px;color:#667085;font-size:12px;display:flex;justify-content:space-between;gap:12px}
  </style><body>${pages}</body></html>`;
}
export async function generateReport(day: DayView, students: StudentView[]) {
  if (active >= 2)
    throw new HttpError(503, "توليد التقارير مشغول. حاول بعد قليل");
  if (!students.length) throw new HttpError(404, "لا يوجد طلاب للتقرير");
  if (students.some((s) => !s.outcome))
    throw new HttpError(409, "حدد النتيجة اليومية لكل طالب في التقرير أولًا");
  active++;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const fonts = await Promise.all(
      ["arabic", "latin"].flatMap((subset) =>
        [400, 700].map(async (weight) => {
          const buffer = await readFile(
            path.join(
              process.cwd(),
              "public",
              "fonts",
              `cairo-${subset}-${weight}-normal.woff2`,
            ),
          );
          return `@font-face{font-family:Cairo${subset === "arabic" ? "Arabic" : "Latin"};src:url(data:font/woff2;base64,${buffer.toString("base64")}) format('woff2');font-weight:${weight}}`;
        }),
      ),
    );
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.route("**/*", (route) => route.abort());
    await page.setContent(reportMarkup(day, students, fonts.join("\n")), {
      waitUntil: "load",
      timeout: 15000,
    });
    await page.evaluate(async () => {
      await document.fonts.ready;
      document.querySelectorAll<HTMLElement>(".content").forEach((content) => {
        const parent = content.parentElement!;
        const footer = parent.querySelector("footer")!;
        const available =
          footer.getBoundingClientRect().top -
          content.getBoundingClientRect().top -
          20;
        if (content.scrollHeight > available)
          content.style.transform = `scale(${available / content.scrollHeight})`;
      });
    });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
  } finally {
    await browser?.close();
    active--;
  }
}
