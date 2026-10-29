import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  suggestMemorySequence,
  memoryRangeAdvice,
  nextMemoryRange,
  type MemoryAttempt,
} from "../src/lib/memorization-order";
const r = (s: number, a: number, b: number, e = s) => ({
  startSurah: s,
  startAyah: a,
  endSurah: e,
  endAyah: b,
});
const attempt = (
  s: number,
  a: number,
  b: number,
  date = "2026-10-01",
  mastered: boolean | null = true,
  e = s,
): MemoryAttempt => ({ range: r(s, a, b, e), date, mastered });
test("Fatiha suggests Baqara without fixing direction; Baqara 1-20 suggests 21 immediately", () => {
  const first = suggestMemorySequence([attempt(1, 1, 7)])!;
  assert.equal(first.direction, null);
  assert.equal(first.learning, true);
  assert.deepEqual(first.next, { surah: 2, ayah: 1 });
  assert.equal(memoryRangeAdvice(first, r(2, 1, 20)), null);
  const second = suggestMemorySequence([attempt(1, 1, 7), attempt(2, 1, 20)])!;
  assert.deepEqual(second.next, { surah: 2, ayah: 21 });
  assert.equal(second.learning, true);
  assert.match(memoryRangeAdvice(second, r(2, 23, 30))!, /21.*يمكنك حفظ/);
  assert.doesNotThrow(() =>
    suggestMemorySequence([
      attempt(1, 1, 7),
      attempt(2, 1, 20),
      attempt(2, 23, 30),
    ]),
  );
  assert.deepEqual(
    suggestMemorySequence([attempt(2, 1, 20), attempt(2, 23, 30)])!.next,
    { surah: 2, ayah: 31 },
  );
});
test("direction stays in learning for a week and distinct study days, not repeated attempts", () => {
  const oneDay = Array.from({ length: 20 }, () => attempt(2, 1, 20));
  assert.equal(suggestMemorySequence(oneDay)!.learning, true);
  const week = ["01", "02", "03", "04", "05"].map((d, i) =>
    attempt(2, i + 1, i + 1, "2026-10-" + d),
  );
  assert.equal(suggestMemorySequence(week)!.learning, true);
  const established = suggestMemorySequence([
    ...week,
    attempt(2, 6, 6, "2026-10-08"),
  ])!;
  assert.equal(established.learning, false);
  assert.equal(established.direction, "FORWARD");
  assert.match(memoryRangeAdvice(established, r(20, 1, 5))!, /يمكنك حفظ/);
});
test("middle surahs need consistent adjacent observations; contradictory movement resumes learning", () => {
  const dates = ["01", "02", "03", "04", "08"];
  const middle = dates.map((d) => attempt(67, 1, 30, "2026-10-" + d));
  assert.equal(suggestMemorySequence(middle)!.direction, null);
  const reverse = [
    ...middle,
    attempt(66, 1, 12, "2026-10-09"),
    attempt(65, 1, 12, "2026-10-10"),
  ];
  assert.equal(suggestMemorySequence(reverse)!.direction, "REVERSE");
  assert.equal(suggestMemorySequence(reverse)!.learning, false);
  const changed = suggestMemorySequence([
    ...reverse,
    attempt(66, 1, 5, "2026-10-11"),
  ])!;
  assert.equal(changed.direction, null);
  assert.equal(changed.learning, true);
});
test("failed attempts suggest their start, unknown grades do not advance, review is outside this history", () => {
  const failed = suggestMemorySequence([
    attempt(2, 1, 20),
    attempt(2, 21, 25, "2026-10-02", false),
  ])!;
  assert.deepEqual(failed.next, { surah: 2, ayah: 21 });
  assert.deepEqual(
    suggestMemorySequence([
      attempt(2, 1, 20),
      attempt(2, 30, 40, "2026-10-02", null),
    ])!.next,
    { surah: 2, ayah: 21 },
  );
  assert.deepEqual(
    suggestMemorySequence([
      attempt(2, 1, 20),
      attempt(2, 21, 25, "2026-10-02", false),
      attempt(2, 21, 25, "2026-10-02"),
    ])!.next,
    { surah: 2, ayah: 26 },
  );
});
test("verse order stays ascending inside reverse surahs and completion never forbids another range", () => {
  const reverse = suggestMemorySequence([
    attempt(114, 1, 6),
    attempt(113, 1, 5),
  ])!;
  assert.equal(reverse.direction, "REVERSE");
  assert.deepEqual(reverse.next, { surah: 112, ayah: 1 });
  const end = suggestMemorySequence([
    attempt(3, 1, 200),
    attempt(2, 1, 286, "2026-10-02"),
  ])!;
  assert.equal(end.complete, true);
  assert.equal(memoryRangeAdvice(end, r(67, 1, 5)), null);
  assert.deepEqual(nextMemoryRange(end, r(67, 1, 5)), r(67, 1, 5));
});
test("prefill trims completed verses, preserves a different teacher assignment and never alters its source", () => {
  const view = suggestMemorySequence([attempt(2, 1, 20)])!;
  const assignment = r(2, 1, 30);
  assert.deepEqual(nextMemoryRange(view, assignment), r(2, 21, 30));
  assert.equal(assignment.startAyah, 1);
  assert.deepEqual(nextMemoryRange(view, r(2, 25, 30)), r(2, 25, 30));
  assert.deepEqual(nextMemoryRange(view, r(67, 10, 20), true), r(2, 21, 21));
  assert.deepEqual(nextMemoryRange(view, r(2, 1, 20)), r(2, 21, 21));
  assert.equal(nextMemoryRange(undefined, null).startSurah, 0);
});
