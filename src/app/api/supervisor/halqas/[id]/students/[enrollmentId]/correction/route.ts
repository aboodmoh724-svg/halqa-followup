import { requireSupervisor } from "@/lib/supervisor-auth";
import { apiError, checkOrigin } from "@/lib/auth";
import { getCorrection, correctStudent } from "@/lib/supervisor-corrections";
type Context = { params: Promise<{ id: string; enrollmentId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    await requireSupervisor();
    const { id, enrollmentId } = await context.params;
    return Response.json(
      await getCorrection(
        id,
        enrollmentId,
        new URL(request.url).searchParams.get("date") ?? "",
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    checkOrigin(request);
    const supervisor = await requireSupervisor();
    const { id, enrollmentId } = await context.params;
    await correctStudent(supervisor.id, id, enrollmentId, await request.json());
    return Response.json(
      { saved: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
