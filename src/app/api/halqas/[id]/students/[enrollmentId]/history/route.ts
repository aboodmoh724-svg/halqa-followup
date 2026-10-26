import { apiError, teacherId } from "@/lib/auth";
import { getStudentHistory } from "@/lib/student-history";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; enrollmentId: string }> },
) {
  try {
    const teacher = await teacherId();
    const { id, enrollmentId } = await context.params;
    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams);
    return Response.json(
      await getStudentHistory(teacher, id, enrollmentId, query),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
