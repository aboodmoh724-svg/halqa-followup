import { cookies } from "next/headers";
import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { db } from "./db";
import { secret, tokenHash } from "./crypto";
import { HttpError } from "./auth";
export const supervisorCookie = "halqa_supervisor";
function keyed(password: string) {
  return createHmac("sha256", secret())
    .update(`supervisor-password:${password}`)
    .digest("hex");
}
export function hashSupervisorPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(keyed(password), salt, 64).toString("hex")}`;
}
export function verifySupervisorPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  const value = scryptSync(keyed(password), salt, 64),
    expected = Buffer.from(hash, "hex");
  return expected.length === value.length && timingSafeEqual(value, expected);
}
export async function requireSupervisor() {
  const token = (await cookies()).get(supervisorCookie)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    throw new HttpError(401, "يرجى دخول الإشراف");
  const session = await db.supervisorSession.findUnique({
    where: { id: tokenHash(token) },
    include: { supervisor: true },
  });
  if (!session || session.expiresAt <= new Date() || !session.supervisor.active)
    throw new HttpError(401, "انتهت جلسة الإشراف؛ سجل الدخول مجددًا");
  return { id: session.supervisor.id, name: session.supervisor.name };
}

export function supervisorCodeLookup(code: string) {
  return createHmac("sha256", secret())
    .update(`supervisor-code:${code}`)
    .digest("hex");
}
export function hashSupervisorCode(code: string) {
  return hashSupervisorPassword(`code:${code}`);
}
export function verifySupervisorCode(code: string, hash: string) {
  return verifySupervisorPassword(`code:${code}`, hash);
}
