import { db } from "@/lib/db";
import { teacherId, apiError } from "@/lib/auth";
export async function GET() {
  try {
    const id = await teacherId();
    const teacher = await db.teacher.findUniqueOrThrow({
      where: { id },
      select: {
        name: true,
        halqas: {
          select: { id: true, name: true, attendanceOnly: true },
          orderBy: { name: "asc" },
        },
      },
    });
    return Response.json(teacher, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return apiError(e);
  }
}
