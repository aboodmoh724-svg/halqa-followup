import { apiError, checkOrigin, teacherId } from "@/lib/auth";
import { ensureDay, getDay, mutateDay } from "@/lib/day-service";
type Context = { params: Promise<{ id: string }> };
export async function GET(_: Request, context: Context) {
  try {
    const teacher = await teacherId();
    const { id } = await context.params;
    await ensureDay(teacher, id);
    return Response.json(await getDay(teacher, id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    checkOrigin(request);
    const teacher = await teacherId();
    const { id } = await context.params;
    return Response.json(await mutateDay(teacher, id, await request.json()), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return apiError(e);
  }
}
