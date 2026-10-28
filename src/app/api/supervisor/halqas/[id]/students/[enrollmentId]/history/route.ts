import { db } from "@/lib/db";
import { requireSupervisor } from "@/lib/supervisor-auth";
import { apiError, HttpError } from "@/lib/auth";
import { getStudentHistory } from "@/lib/student-history";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; enrollmentId: string }> },
) {
  try {
    await requireSupervisor();
    const { id, enrollmentId } = await context.params;
    const halqa = await db.halqa.findUnique({
      where: { id },
      select: { teacherId: true },
    });
    if (!halqa) throw new HttpError(404, "الحلقة غير موجودة");
    const data = await getStudentHistory(
      halqa.teacherId,
      id,
      enrollmentId,
      Object.fromEntries(new URL(request.url).searchParams),
    );
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return apiError(e);
  }
}
