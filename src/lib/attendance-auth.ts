import { db } from "./db";
import { teacherId, apiError } from "./auth";
import type { AttendanceActor } from "./attendance-service";
export async function attendanceTeacher(): Promise<AttendanceActor> {
  const id = await teacherId();
  const t = await db.teacher.findUniqueOrThrow({
    where: { id },
    select: { name: true },
  });
  return { kind: "TEACHER", id, name: t.name };
}
export function attendanceError(e: unknown) {
  return e instanceof Error && e.name === "ZodError"
    ? Response.json({ error: "تحقق من التاريخ وقائمة الغياب" }, { status: 400 })
    : apiError(e);
}
