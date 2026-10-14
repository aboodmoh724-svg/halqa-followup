import { strict as assert } from "node:assert";
import { test } from "node:test";
import { dayKey, dailyWindow, dayReadOnlyReason } from "../src/lib/dates";
test("teacher day opens at 06:00 and locks at midnight in Istanbul", () => {
  const cases = [
    ["2026-10-14T20:59:59Z", "2026-10-14", true],
    ["2026-10-14T21:00:00Z", "2026-10-14", false],
    ["2026-10-15T02:59:59Z", "2026-10-14", false],
    ["2026-10-15T03:00:00Z", "2026-10-15", true],
  ] as const;
  for (const [iso, date, writable] of cases)
    assert.deepEqual(dailyWindow(new Date(iso), "Europe/Istanbul"), {
      date,
      writable,
    });
  assert.ok(
    dayReadOnlyReason(
      "2026-10-14",
      new Date("2026-10-15T03:00:00Z"),
      "Europe/Istanbul",
    ),
  );
  assert.equal(
    dayReadOnlyReason(
      "2026-10-15",
      new Date("2026-10-15T03:00:00Z"),
      "Europe/Istanbul",
    ),
    null,
  );
});
test("06:00 rollover handles month, year and leap-day boundaries", () => {
  assert.equal(
    dayKey(new Date("2027-01-01T02:00:00Z"), "Europe/Istanbul"),
    "2026-12-31",
  );
  assert.equal(
    dayKey(new Date("2028-03-01T02:00:00Z"), "Europe/Istanbul"),
    "2028-02-29",
  );
  assert.equal(
    dayKey(new Date("2028-03-01T03:00:00Z"), "Europe/Istanbul"),
    "2028-03-01",
  );
});
