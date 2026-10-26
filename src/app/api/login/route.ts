import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { loginSchema } from "@/lib/login-schema";
import { db } from "@/lib/db";
import { codeLookup, verifyCode, tokenHash } from "@/lib/crypto";
import { apiError, checkOrigin, cookieName, HttpError } from "@/lib/auth";
export const runtime = "nodejs";
async function bucket(key: string, limit: number) {
  const now = new Date();
  const window = Math.floor(now.getTime() / 900000);
  const id = `${key}:${window}`;
  const rows = await db.$queryRaw<
    { attempts: number }[]
  >`INSERT INTO "LoginBucket" (key, attempts, "expiresAt") VALUES (${id}, 1, ${new Date((window + 1) * 900000)}) ON CONFLICT (key) DO UPDATE SET attempts = "LoginBucket".attempts + 1 RETURNING attempts`;
  return rows[0].attempts <= limit;
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const input = loginSchema.parse(await request.json());
    const lookup = codeLookup(input.code);
    const ip =
      process.env.TRUST_PROXY === "true"
        ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          "unknown"
        : "shared";
    const allowed = await Promise.all([
      bucket(`code:${lookup}`, 8),
      bucket(
        `client:${tokenHash(ip)}`,
        process.env.TRUST_PROXY === "true" ? 30 : 100,
      ),
      bucket("global", 300),
    ]);
    if (allowed.includes(false))
      throw new HttpError(429, "محاولات كثيرة. انتظر 15 دقيقة قبل المحاولة");
    const teacher = await db.teacher.findUnique({
      where: { codeLookup: lookup },
    });
    // Equalize the expensive verification path when no teacher matches.
    const valid = verifyCode(
      input.code,
      teacher?.codeHash ?? `${"0".repeat(32)}:${"0".repeat(128)}`,
    );
    if (!teacher || !valid) throw new HttpError(401, "الرمز غير صحيح");
    const token = randomBytes(32).toString("hex");
    const seconds = input.remember ? 30 * 86400 : 12 * 3600;
    await db.teacherSession.create({
      data: {
        id: tokenHash(token),
        teacherId: teacher.id,
        expiresAt: new Date(Date.now() + seconds * 1000),
      },
    });
    await db.loginBucket.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    await db.teacherSession.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    (await cookies()).set(cookieName, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      ...(input.remember ? { maxAge: seconds } : {}),
    });
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
