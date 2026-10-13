import { cookies } from "next/headers";
import { db } from "./db";
import { tokenHash } from "./crypto";
export const cookieName = "halqa_session";
export async function teacherId() {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    throw new HttpError(401, "يرجى تسجيل الدخول");
  const session = await db.teacherSession.findUnique({
    where: { id: tokenHash(token) },
  });
  if (!session || session.expiresAt <= new Date())
    throw new HttpError(401, "انتهت الجلسة، يرجى تسجيل الدخول");
  return session.teacherId;
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function checkOrigin(request: Request) {
  const expected = process.env.APP_URL;
  if (!expected) throw new Error("APP_URL is required");
  if (request.headers.get("origin") !== new URL(expected).origin)
    throw new HttpError(403, "طلب غير مسموح");
}
export function apiError(error: unknown) {
  if (error instanceof HttpError)
    return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof Error && error.name === "ZodError")
    return Response.json(
      { error: "تحقق من المدخلات ومدى الآيات" },
      { status: 400 },
    );
  console.error(
    "Request failed",
    error instanceof Error ? error.name : "Unknown error",
  );
  return Response.json(
    { error: "تعذر حفظ البيانات. حاول مرة أخرى" },
    { status: 500 },
  );
}
