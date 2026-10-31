import { apiError, checkOrigin } from "@/lib/auth";
import { requireSupervisor } from "@/lib/supervisor-auth";
import { decidePartExam, studentExamView } from "@/lib/exam-service";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    checkOrigin(request);
    const actor = {
        kind: "SUPERVISOR" as const,
        ...(await requireSupervisor()),
      },
      { id } = await context.params;
    const result = await decidePartExam(actor, id, await request.json());
    return Response.json(
      await studentExamView(actor, result.halqaId, result.enrollmentId),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
