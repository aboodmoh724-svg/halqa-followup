import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { tokenHash } from "@/lib/crypto";
import { apiError, checkOrigin, cookieName } from "@/lib/auth";
import { supervisorCookie } from "@/lib/supervisor-auth";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const jar = await cookies();
    const token = jar.get(cookieName)?.value;
    if (token)
      await db.teacherSession.deleteMany({ where: { id: tokenHash(token) } });
    jar.delete(cookieName);
    const supervisorToken = jar.get(supervisorCookie)?.value;
    if (supervisorToken)
      await db.supervisorSession.deleteMany({
        where: { id: tokenHash(supervisorToken) },
      });
    jar.delete(supervisorCookie);
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
