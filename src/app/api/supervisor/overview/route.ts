import { requireSupervisor } from "@/lib/supervisor-auth";
import { apiError } from "@/lib/auth";
import { getSupervisorOverview } from "@/lib/supervisor-service";
export async function GET() {
  try {
    const supervisor = await requireSupervisor();
    return Response.json(
      { supervisor, ...(await getSupervisorOverview()) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
