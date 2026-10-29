import { strict as assert } from "node:assert";
import { test } from "node:test";
import { latestMemoryGap, type GapEntry } from "../src/lib/supervision-gaps";
const e = (id: string, s: number, a: number, b: number, end = s): GapEntry => ({
  id,
  date: "2026-10-29",
  range: { startSurah: s, startAyah: a, endSurah: end, endAyah: b },
});
test("supervisor gap advice identifies exact skipped verses and resolves after recording/correction", () => {
  const before = e("a", 2, 1, 20),
    after = e("b", 2, 23, 30);
  const gap = latestMemoryGap([before, after])!;
  assert.equal(gap.missingCount, 2);
  assert.match(gap.message, /21.*22/);
  assert.equal(latestMemoryGap([before, after, e("fill", 2, 21, 22)]), null);
  assert.equal(
    latestMemoryGap([
      before,
      { ...after, range: { ...after.range, startAyah: 21 } },
    ]),
    null,
  );
});
test("Fatiha, repeats, overlap and cross-chapter ranges do not create false gaps", () => {
  assert.equal(latestMemoryGap([e("a", 1, 1, 7), e("b", 2, 1, 20)]), null);
  assert.equal(
    latestMemoryGap([e("a", 2, 1, 20), e("b", 2, 1, 20), e("c", 2, 10, 25)]),
    null,
  );
  assert.equal(
    latestMemoryGap([e("a", 2, 280, 280), e("b", 2, 281, 5, 4)]),
    null,
  );
});
test("cross-chapter jumps include unfinished verses and skipped chapters in both directions", () => {
  assert.equal(
    latestMemoryGap([e("a", 2, 280, 285), e("b", 3, 1, 5)])?.missingCount,
    1,
  );
  assert.equal(
    latestMemoryGap([e("a", 114, 1, 6), e("b", 112, 1, 4)])?.missingCount,
    5,
  );
  assert.equal(latestMemoryGap([e("a", 114, 1, 6), e("b", 113, 1, 5)]), null);
  assert.equal(
    latestMemoryGap([e("a", 67, 1, 20), e("b", 66, 1, 5)])?.missingCount,
    10,
  );
});
