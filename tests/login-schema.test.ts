import { strict as assert } from "node:assert";
import { test } from "node:test";
import { loginSchema } from "../src/lib/login-schema";

test("login accepts four digits without losing leading zeroes and preserves six-digit accounts", () => {
  for (const code of ["0123", "2468", "012345"])
    assert.equal(loginSchema.parse({ code, remember: false }).code, code);
});

test("login rejects other lengths, non-digit codes, and numeric coercion", () => {
  for (const code of ["123", "12345", "1234567", "12a4", " 1234", 1234])
    assert.equal(loginSchema.safeParse({ code, remember: false }).success, false);
  assert.equal(loginSchema.safeParse({ code: "0123" }).success, false);
});
