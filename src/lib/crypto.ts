import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
export function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32)
    throw new Error("AUTH_SECRET must contain at least 32 characters");
  return s;
}
export function codeLookup(code: string) {
  return createHmac("sha256", secret())
    .update(`teacher-code:${code}`)
    .digest("hex");
}
export function hashCode(code: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(codeLookup(code), salt, 64).toString("hex")}`;
}
export function verifyCode(code: string, stored: string) {
  const [salt, hash] = stored.split(":");
  const value = scryptSync(codeLookup(code), salt, 64);
  const expected = Buffer.from(hash, "hex");
  return value.length === expected.length && timingSafeEqual(value, expected);
}
export function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
