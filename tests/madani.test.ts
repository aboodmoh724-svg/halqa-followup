import { strict as assert } from "node:assert";
import { test } from "node:test";
import data from "../src/data/madani-604.json";
import {
  surahs,
  pageAmount,
  entryPages,
  totalPages,
  amountText,
} from "../src/lib/quran";
import { reportMarkup } from "../src/lib/report";
import type { DayView } from "../src/lib/types";

const fatiha = { startSurah: 1, startAyah: 1, endSurah: 1, endAyah: 7 };
test("all 6236 verses exactly once, every page normalized, canonical order", () => {
  const keys: string[] = [];
  const pages = Array<number>(605).fill(0);
  for (const [s, a, portions] of data.verses) {
    keys.push(`${s}:${a}`);
    for (const part of portions as (number | string)[][]) {
      const [p, n, d] = part.map(Number);
      assert.ok(p >= 1 && p <= 604 && n > 0 && d > 0);
      pages[p] += n / d;
    }
  }
  assert.deepEqual(
    keys,
    surahs.flatMap((s) =>
      Array.from({ length: s.ayahs }, (_, i) => `${s.id}:${i + 1}`),
    ),
  );
  assert.equal(new Set(keys).size, 6236);
  for (const amount of pages.slice(1)) assert.ok(Math.abs(amount - 1) < 1e-10);
  assert.equal(
    pageAmount({ startSurah: 1, startAyah: 1, endSurah: 114, endAyah: 6 })!
      .amount,
    604,
  );
});
test("full pages, partial verses and chapter transitions", () => {
  assert.equal(pageAmount(fatiha)!.amount, 1);
  assert.equal(
    pageAmount({ startSurah: 2, startAyah: 1, endSurah: 2, endAyah: 5 })!
      .amount,
    1,
  );
  assert.equal(
    pageAmount({ startSurah: 112, startAyah: 1, endSurah: 114, endAyah: 6 })!
      .amount,
    1,
  );
  const single = pageAmount({ ...fatiha, endAyah: 1 })!.amount;
  assert.ok(single > 0 && single < 1);
  assert.equal(pageAmount({ ...fatiha, endSurah: 2, endAyah: 5 })!.amount, 2);
  assert.throws(() => pageAmount({ ...fatiha, startAyah: 8 }));
  assert.throws(() =>
    pageAmount(fatiha, {
      edition: "madani-604",
      version: "bad",
      fraction: () => NaN,
    }),
  );
});
test("repeated recitations count, persisted versions survive, old rows compute on read", () => {
  assert.equal(totalPages([fatiha, fatiha]), 2);
  assert.equal(
    entryPages({ ...fatiha, pageAmount: 0.1234, pageMappingVersion: "old" }),
    0.1234,
  );
  assert.equal(
    entryPages({ ...fatiha, pageAmount: null, pageMappingVersion: null }),
    1,
  );
  assert.throws(() =>
    entryPages({ ...fatiha, pageAmount: 1, pageMappingVersion: null }),
  );
  assert.match(amountText(fatiha), /صفحة/);
});
test("individual and collective report markup include calculated page amounts", () => {
  const student = {
    enrollmentId: "e",
    name: "طالب",
    outcome: "MEMORIZED" as const,
    note: "",
    today: null,
    tomorrow: null,
    entries: [
      {
        ...fatiha,
        id: "r",
        kind: "MEMORIZATION" as const,
        createdAt: "2026-10-13",
        pageAmount: 1,
        pageMappingVersion: data.version,
      },
    ],
  };
  const day: DayView = {
    halqaId: "h",
    halqaName: "حلقة",
    teacherName: "معلم",
    date: "2026-10-13",
    timezone: "Europe/Istanbul",
    closedAt: null,
    students: [student],
  };
  const markup = reportMarkup(
    day,
    [student, { ...student, enrollmentId: "e2" }],
    "",
  );
  assert.equal((markup.match(/class="page"/g) || []).length, 1);
  assert.equal((markup.match(/data-student=/g) || []).length, 2);
  assert.match(markup, /صفحة/);
});
