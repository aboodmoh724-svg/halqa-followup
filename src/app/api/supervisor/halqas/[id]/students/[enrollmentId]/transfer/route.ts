import { requireSupervisor } from "@/lib/supervisor-auth";
import { apiError, checkOrigin } from "@/lib/auth";
import { getTransferOptions, transferStudent } from "@/lib/student-transfers";
type Context = { params: Promise<{ id: string; enrollmentId: string }> };
export async function GET(_: Request, context: Context) {
  try {
    await requireSupervisor();
    const { id, enrollmentId } = await context.params;
    return Response.json(await getTransferOptions(id, enrollmentId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    checkOrigin(request);
    const actor = await requireSupervisor();
    const { id, enrollmentId } = await context.params;
    return Response.json(
      await transferStudent(actor.id, id, enrollmentId, await request.json()),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
