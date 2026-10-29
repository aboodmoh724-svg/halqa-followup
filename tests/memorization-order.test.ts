import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  replayMemorySequence,
  validateMemoryCandidate,
  nextMemoryRange,
} from "../src/lib/memorization-order";
const r = (s: number, a: number, b: number, e = s) => ({
  startSurah: s,
  startAyah: a,
  endSurah: e,
  endAyah: b,
});
test("Baqara continues to Al Imran only after its remaining verses", () => {
  const start = { surah: 2, ayah: 280 };
  let state = replayMemorySequence(start, null, [
    { range: r(2, 280, 285), mastered: true },
  ]);
  assert.deepEqual(state.next, { surah: 2, ayah: 286 });
  assert(validateMemoryCandidate(state, r(3, 1, 5)));
  state = replayMemorySequence(start, null, [
    { range: r(2, 280, 286), mastered: true },
  ]);
  assert.equal(state.direction, "FORWARD");
  assert.deepEqual(state.next, { surah: 3, ayah: 1 });
  assert(validateMemoryCandidate(state, r(4, 1, 5)));
});
test("Nas determines reverse order; verses inside each chapter remain ascending", () => {
  const start = { surah: 114, ayah: 1 };
  const state = replayMemorySequence(start, null, [
    { range: r(114, 1, 6), mastered: true },
    { range: r(113, 1, 5), mastered: true },
  ]);
  assert.equal(state.direction, "REVERSE");
  assert.deepEqual(state.next, { surah: 112, ayah: 1 });
  assert.throws(
    () =>
      replayMemorySequence(start, null, [
        { range: r(114, 1, 6), mastered: true },
        { range: r(111, 1, 5), mastered: true },
      ]),
    /الموضع التالي/,
  );
});
test("middle chapters defer direction without guessing; only a completed adjacent transition establishes it", () => {
  const start = { surah: 67, ayah: 10 };
  const part = { range: r(67, 10, 20), mastered: true };
  assert.throws(
    () =>
      replayMemorySequence(start, null, [
        part,
        { range: r(66, 1, 5), mastered: true },
      ]),
    /الموضع التالي/,
  );
  const complete = { range: r(67, 21, 30), mastered: true };
  const boundary = replayMemorySequence(start, null, [part, complete]);
  assert.equal(boundary.direction, null);
  assert.deepEqual(boundary.adjacentSurahs, [66, 68]);
  assert.equal(nextMemoryRange(boundary, null).startSurah, 0);
  assert.deepEqual(nextMemoryRange(boundary, r(66, 1, 5)), r(66, 1, 5));
  assert.equal(nextMemoryRange(boundary, r(66, 2, 5)).startSurah, 0);
  const reverse = replayMemorySequence(start, null, [
    part,
    complete,
    { range: r(66, 1, 5), mastered: true },
  ]);
  assert.equal(reverse.direction, "REVERSE");
  assert.deepEqual(reverse.next, { surah: 66, ayah: 6 });
  const forward = replayMemorySequence(start, null, [
    part,
    complete,
    { range: r(68, 1, 5), mastered: true },
  ]);
  assert.equal(forward.direction, "FORWARD");
  assert.deepEqual(forward.next, { surah: 68, ayah: 6 });
});
test("failed attempts never advance; repeated actual ranges do not duplicate sequence progress", () => {
  const start = { surah: 2, ayah: 1 };
  assert.deepEqual(
    replayMemorySequence(start, null, [{ range: r(2, 1, 5), mastered: false }])
      .next,
    start,
  );
  const state = replayMemorySequence(start, null, [
    { range: r(2, 1, 5), mastered: true },
    { range: r(2, 1, 5), mastered: true },
  ]);
  assert.deepEqual(state.next, { surah: 2, ayah: 6 });
  assert(validateMemoryCandidate(state, r(2, 7, 10)));
  assert.equal(validateMemoryCandidate(state, r(2, 3, 8)), null);
  assert.deepEqual(nextMemoryRange(state, r(2, 1, 10)), r(2, 6, 10));
});
test("cross-chapter ranges include all intervening verses; reverse path ends at Baqara", () => {
  const state = replayMemorySequence({ surah: 67, ayah: 29 }, null, [
    { range: r(67, 29, 2, 65), mastered: true },
  ]);
  assert.equal(state.direction, "REVERSE");
  assert.deepEqual(state.next, { surah: 65, ayah: 3 });
  const end = replayMemorySequence({ surah: 2, ayah: 1 }, "REVERSE", [
    { range: r(2, 1, 286), mastered: true },
  ]);
  assert.equal(end.complete, true);
  assert.equal(end.next, null);
});

test("a later failed repetition reopens its gap without discarding later mastered coverage", () => {
  const start = { surah: 2, ayah: 1 },
    passed = { range: r(2, 1, 10), mastered: true },
    failed = { range: r(2, 3, 5), mastered: false };
  const state = replayMemorySequence(start, null, [passed, failed]);
  assert.deepEqual(state.next, { surah: 2, ayah: 3 });
  assert.deepEqual(
    replayMemorySequence(start, null, [
      passed,
      failed,
      { range: r(2, 3, 5), mastered: true },
    ]).next,
    { surah: 2, ayah: 11 },
  );
  assert.deepEqual(
    replayMemorySequence(start, null, [
      passed,
      { range: r(2, 3, 5), mastered: null },
    ]).next,
    { surah: 2, ayah: 11 },
  );
});
