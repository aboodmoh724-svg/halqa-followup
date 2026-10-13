import { apiError, teacherId, HttpError } from "@/lib/auth";
import { getDay } from "@/lib/day-service";
import { dayKey } from "@/lib/dates";
import { generateReport } from "@/lib/report";
import { db } from "@/lib/db";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const teacher = await teacherId();
    const { id } = await context.params;
    const url = new URL(request.url);
    const date = url.searchParams.get("date") || dayKey();
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
    )
      throw new HttpError(400, "التاريخ غير صحيح");
    const day = await getDay(teacher, id, date);
    const student = url.searchParams.get("student");
    const students = student
      ? day.students.filter((s) => s.enrollmentId === student)
      : day.students;
    const window = Math.floor(Date.now() / 60000);
    const key = `pdf:${teacher}:${window}`;
    const bucket = await db.loginBucket.upsert({
      where: { key },
      create: { key, attempts: 1, expiresAt: new Date((window + 1) * 60000) },
      update: { attempts: { increment: 1 } },
    });
    if (bucket.attempts > 6)
      throw new HttpError(429, "انتظر دقيقة قبل توليد المزيد من التقارير");
    const pdf = await generateReport(day, students);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="halqa-${date}${student ? "-student" : ""}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
