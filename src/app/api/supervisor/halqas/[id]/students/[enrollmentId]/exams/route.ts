import { apiError, checkOrigin } from "@/lib/auth";
import { requireSupervisor } from "@/lib/supervisor-auth";
import { studentExamView, setMemorizationBaseline } from "@/lib/exam-service";
type Context = { params: Promise<{ id: string; enrollmentId: string }> };
export async function GET(_: Request, context: Context) {
  try {
    const { id, enrollmentId } = await context.params;
    return Response.json(
      await studentExamView(
        { kind: "SUPERVISOR", ...(await requireSupervisor()) },
        id,
        enrollmentId,
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
    const { id, enrollmentId } = await context.params;
    return Response.json(
      await setMemorizationBaseline(
        { kind: "SUPERVISOR", ...(await requireSupervisor()) },
        id,
        enrollmentId,
        await request.json(),
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
