import { apiError, teacherId, HttpError } from "@/lib/auth";
import { requireSupervisor } from "@/lib/supervisor-auth";
export async function GET() {
  try {
    let role: "SUPERVISOR" | "TEACHER" | null = null;
    try {
      await requireSupervisor();
      role = "SUPERVISOR";
    } catch (e) {
      if (!(e instanceof HttpError) || e.status !== 401) throw e;
    }
    if (!role)
      try {
        await teacherId();
        role = "TEACHER";
      } catch (e) {
        if (!(e instanceof HttpError) || e.status !== 401) throw e;
      }
    return Response.json(
      { role },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
