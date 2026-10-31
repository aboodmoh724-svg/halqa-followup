import { apiError, checkOrigin } from "@/lib/auth";
import { attendanceTeacher } from "@/lib/attendance-auth";
import { studentExamView, submitPartExam } from "@/lib/exam-service";
type Context = { params: Promise<{ id: string; enrollmentId: string }> };
export async function GET(_: Request, context: Context) {
  try {
    const { id, enrollmentId } = await context.params;
    return Response.json(
      await studentExamView(await attendanceTeacher(), id, enrollmentId),
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
      await submitPartExam(
        await attendanceTeacher(),
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
