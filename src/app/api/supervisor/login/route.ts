import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { tokenHash } from "@/lib/crypto";
import { apiError, checkOrigin, HttpError } from "@/lib/auth";
import {
  supervisorCookie,
  supervisorLoginSchema,
  verifySupervisorPassword,
} from "@/lib/supervisor-auth";
import { limitSupervisorLogin } from "@/lib/login-rate-limit";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const input = supervisorLoginSchema.parse(await request.json());
    await limitSupervisorLogin(request, input.username);
    const supervisor = await db.supervisor.findUnique({
      where: { username: input.username },
    });
    const valid = verifySupervisorPassword(
      input.password,
      supervisor?.passwordHash ?? `${"0".repeat(32)}:${"0".repeat(128)}`,
    );
    if (!supervisor?.active || !valid)
      throw new HttpError(401, "بيانات الدخول غير صحيحة");
    const token = randomBytes(32).toString("hex"),
      seconds = 12 * 3600;
    await db.supervisorSession.create({
      data: {
        id: tokenHash(token),
        supervisorId: supervisor.id,
        expiresAt: new Date(Date.now() + seconds * 1000),
      },
    });
    await db.supervisorSession.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    (await cookies()).set(supervisorCookie, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: seconds,
    });
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
