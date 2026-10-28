import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { tokenHash } from "@/lib/crypto";
import { apiError, checkOrigin } from "@/lib/auth";
import { supervisorCookie } from "@/lib/supervisor-auth";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const jar = await cookies();
    const token = jar.get(supervisorCookie)?.value;
    if (token)
      await db.supervisorSession.deleteMany({
        where: { id: tokenHash(token) },
      });
    jar.delete(supervisorCookie);
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
