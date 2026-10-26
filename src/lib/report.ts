import { collectiveReportMarkup } from "./collective-report";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { HttpError } from "./auth";
import { reportIssues, type DayView, type StudentView } from "./types";
import { studentReportMarkup } from "./student-report";
let active = 0;
export function reportMarkup(
  day: DayView,
  students: StudentView[],
  fontCss: string,
  collective = students.length > 1,
) {
  if (collective) return collectiveReportMarkup(day, students, fontCss);
  return studentReportMarkup(day, students, fontCss);
}
export async function generateReport(
  day: DayView,
  students: StudentView[],
  collective = students.length > 1,
) {
  if (active >= 2)
    throw new HttpError(503, "توليد التقارير مشغول. حاول بعد قليل");
  if (!students.length) throw new HttpError(404, "لا يوجد طلاب للتقرير");
  const pending = students.filter(
    (s) => reportIssues(s, !!day.closedAt).length,
  );
  if (pending.length)
    throw new HttpError(
      409,
      `التقرير غير مكتمل: بقي ${pending.length} طالب. أكمل نتيجتي الحفظ والمراجعة وواجب الغد؛ ولنتيجة حافظ سجل التسميع؛ وللغائب حدد واجب الغد.`,
    );
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
    await page.setContent(
      reportMarkup(day, students, fonts.join("\n"), collective),
      {
        waitUntil: "load",
        timeout: 15000,
      },
    );
    await page.evaluate(async () => {
      await document.fonts.ready;
      if (document.querySelector("table")) {
        const content = document.querySelector<HTMLElement>(".content")!;
        const footer = content.parentElement!.querySelector("footer")!;
        const available =
          footer.getBoundingClientRect().top -
          content.getBoundingClientRect().top -
          20;
        for (let size = 13; size >= 10; size -= 0.25) {
          document.documentElement.style.setProperty(
            "--table-font-size",
            `${size}px`,
          );
          if (content.scrollHeight <= available) break;
        }
      }
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
