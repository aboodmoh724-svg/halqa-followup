import { strict as assert } from "node:assert";
import { test } from "node:test";
import { surahs, rangeSchema, ayahAmount, pageAmount } from "../src/lib/quran";
import { dayKey, nextDay } from "../src/lib/dates";
import { codeLookup, hashCode, verifyCode } from "../src/lib/crypto";
import { mutationSchema } from "../src/lib/types";
test("114 surahs with canonical total 6236", () => {
  assert.equal(surahs.length, 114);
  assert.equal(
    surahs.reduce((a, s) => a + s.ayahs, 0),
    6236,
  );
});
test("Al-Mulk rejects verse 31 in both endpoints", () => {
  assert.equal(
    rangeSchema.safeParse({
      startSurah: 67,
      startAyah: 31,
      endSurah: 68,
      endAyah: 1,
    }).success,
    false,
  );
  assert.equal(
    rangeSchema.safeParse({
      startSurah: 67,
      startAyah: 1,
      endSurah: 67,
      endAyah: 31,
    }).success,
    false,
  );
});
test("cross-surah range counts both endpoints", () => {
  assert.equal(
    ayahAmount({ startSurah: 67, startAyah: 29, endSurah: 68, endAyah: 3 }),
    5,
  );
});
test("reversed verses, fractions and invalid chapters rejected", () => {
  for (const range of [
    { startSurah: 67, startAyah: 20, endSurah: 67, endAyah: 10 },
    { startSurah: 0, startAyah: 1, endSurah: 1, endAyah: 7 },
    { startSurah: 67, startAyah: 1.5, endSurah: 67, endAyah: 30 },
  ])
    assert.equal(rangeSchema.safeParse(range).success, false);
});
test("layout-derived pages are versioned and custom maps still work", () => {
  const r = { startSurah: 67, startAyah: 29, endSurah: 68, endAyah: 3 };
  assert.ok(pageAmount(r)!.amount > 0);
  assert.match(pageAmount(r)!.version, /^madani-604-glyph-lines-v1-/);
  assert.deepEqual(
    pageAmount(r, {
      edition: "madani-604",
      version: "fixture",
      fraction: () => 0.1,
    }),
    { amount: 0.5, version: "fixture" },
  );
});
test("calendar rollover uses institution timezone", () => {
  assert.equal(
    dayKey(new Date("2026-10-13T21:30:00Z"), "Europe/Istanbul"),
    "2026-10-13",
  );
  assert.equal(nextDay("2026-12-31"), "2027-01-01");
  assert.equal(nextDay("2028-02-28"), "2028-02-29");
});
test("teacher codes are keyed and salted", () => {
  process.env.AUTH_SECRET = "test-secret-of-at-least-32-characters";
  const a = hashCode("123456"),
    b = hashCode("123456");
  assert.notEqual(a, b);
  assert.equal(verifyCode("123456", a), true);
  assert.equal(verifyCode("654321", a), false);
  assert.equal(a.includes("123456"), false);
  assert.equal(codeLookup("123456").length, 64);
});
test("partial memorization is never a daily outcome", () => {
  assert.equal(
    mutationSchema.safeParse({
      action: "status",
      date: "2026-10-13",
      enrollmentId: "a",
      outcome: "PARTIAL",
      note: "",
    }).success,
    false,
  );
});
