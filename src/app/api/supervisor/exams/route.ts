import { apiError } from "@/lib/auth";
import { requireSupervisor } from "@/lib/supervisor-auth";
import { examOverview } from "@/lib/exam-service";
export async function GET() {
  try {
    return Response.json(
      await examOverview({
        kind: "SUPERVISOR",
        ...(await requireSupervisor()),
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
