import { requireSupervisor } from "@/lib/supervisor-auth";
import { attendanceError } from "@/lib/attendance-auth";
import { attendanceOverview } from "@/lib/attendance-service";
export async function GET(req: Request) {
  try {
    const actor = {
      ...(await requireSupervisor()),
      kind: "SUPERVISOR" as const,
    };
    return Response.json(
      await attendanceOverview(
        actor,
        new URL(req.url).searchParams.get("date") ?? undefined,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return attendanceError(e);
  }
}
