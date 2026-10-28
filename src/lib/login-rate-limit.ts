import { db } from "./db";
import { tokenHash } from "./crypto";
import { HttpError } from "./auth";
async function bucket(key: string, limit: number) {
  const window = Math.floor(Date.now() / 900000);
  const id = `${key}:${window}`;
  const rows = await db.$queryRaw<
    { attempts: number }[]
  >`INSERT INTO "LoginBucket" (key, attempts, "expiresAt") VALUES (${id}, 1, ${new Date((window + 1) * 900000)}) ON CONFLICT (key) DO UPDATE SET attempts = "LoginBucket".attempts + 1 RETURNING attempts`;
  return rows[0].attempts <= limit;
}
export async function limitSupervisorLogin(request: Request, username: string) {
  const ip =
    process.env.TRUST_PROXY === "true"
      ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        "unknown"
      : "shared";
  const allowed = await Promise.all([
    bucket(`supervisor-account:${tokenHash(username)}`, 8),
    bucket(
      `supervisor-client:${tokenHash(ip)}`,
      process.env.TRUST_PROXY === "true" ? 30 : 100,
    ),
    bucket("supervisor-global", 100),
  ]);
  if (allowed.includes(false))
    throw new HttpError(429, "محاولات كثيرة. انتظر 15 دقيقة قبل المحاولة");
}
