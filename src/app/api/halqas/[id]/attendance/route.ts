import { checkOrigin } from "@/lib/auth";
import { attendanceTeacher, attendanceError } from "@/lib/attendance-auth";
import { getAttendance, confirmAttendance } from "@/lib/attendance-service";
type Context = { params: Promise<{ id: string }> };
export async function GET(req: Request, c: Context) {
  try {
    const actor = await attendanceTeacher(),
      { id } = await c.params;
    return Response.json(
      await getAttendance(
        actor,
        id,
        new URL(req.url).searchParams.get("date") ?? undefined,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return attendanceError(e);
  }
}
export async function POST(req: Request, c: Context) {
  try {
    checkOrigin(req);
    const actor = await attendanceTeacher(),
      { id } = await c.params;
    return Response.json(await confirmAttendance(actor, id, await req.json()), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return attendanceError(e);
  }
}
