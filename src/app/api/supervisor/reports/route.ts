import { requireSupervisor } from "@/lib/supervisor-auth";
import { apiError } from "@/lib/auth";
import { getSupervisionReport } from "@/lib/supervision-report";
import { supervisionReportMarkup } from "@/lib/supervision-report-pdf";
import { generateHtmlPdf } from "@/lib/report";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    await requireSupervisor();
    const data = await getSupervisionReport(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (data.query.format === "pdf") {
      const pdf = await generateHtmlPdf((font) =>
        supervisionReportMarkup(data, font),
      );
      return new Response(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="supervision-${data.query.type}-${data.query.from}-${data.query.to}.pdf"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return apiError(e);
  }
}
