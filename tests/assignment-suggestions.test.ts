import { strict as assert } from "node:assert";
import { test } from "node:test";
import { suggestAssignment } from "../src/lib/assignment-suggestions";
import { pageAmount, rangeSegments, surahs } from "../src/lib/quran";
import type { EntryView } from "../src/lib/types";

const history = (surah = 2) =>
  Array.from({ length: 5 }, (_, i) => ({
    date: `2026-10-${10 + i}`,
    entries: [
      {
        id: String(i),
        kind: "MEMORIZATION",
        assessment: "MASTERED",
        createdAt: `2026-10-${10 + i}T09:00:00Z`,
        pageAmount: null,
        pageMappingVersion: null,
        startSurah: surah,
        endSurah: surah,
        startAyah: [1, 6, 17, 25, 30][i],
        endAyah: [5, 16, 24, 29, 37][i],
      } as EntryView,
    ],
  }));

test("suggestions need five actual study days, never five attempts on one day", () => {
  assert.equal(suggestAssignment(history().slice(0, 4), "MEMORIZATION"), null);
  assert.equal(
    suggestAssignment(
      [{ date: "2026-10-14", entries: history().flatMap((d) => d.entries) }],
      "MEMORIZATION",
    ),
    null,
  );
  assert.equal(suggestAssignment(history(), "REVIEW"), null);
  assert.equal(
    suggestAssignment(
      history().map((d) => ({
        ...d,
        entries: d.entries.map((e) => ({ ...e, assessment: "NOT_MASTERED" })),
      })),
      "MEMORIZATION",
    ),
    null,
  );
});

test("proposed range starts after latest entry and approximates daily average", () => {
  const days = history();
  const proposal = suggestAssignment(days, "MEMORIZATION")!;
  assert.ok(proposal);
  assert.equal(proposal.range.startSurah, 2);
  assert.equal(proposal.range.startAyah, 38);
  assert.equal(proposal.sampleDays, 5);
  assert.ok(
    Math.abs(pageAmount(proposal.range)!.amount - proposal.averagePages) < 0.2,
  );
  assert.deepEqual(history(), days); // no writes/mutation
});

test("unknown chapter direction and unstable daily amounts produce no guess", () => {
  const unknown = history(67).map((d) => ({
    ...d,
    entries: d.entries.map((e) => ({ ...e, startAyah: 26, endAyah: 30 })),
  }));
  assert.equal(suggestAssignment(unknown, "MEMORIZATION"), null);
  const unstable = history();
  unstable[0].entries = Array.from(
    { length: 12 },
    () => unstable[0].entries[0],
  );
  assert.equal(suggestAssignment(unstable, "MEMORIZATION"), null);
});

test("reverse chapter movement keeps ascending verses and does not repeat the last range", () => {
  const days = history().map((d, i) => ({
    ...d,
    entries: [
      {
        ...d.entries[0],
        startSurah: 69 - i,
        endSurah: 69 - i,
        startAyah: 1,
        endAyah: surahs[69 - i - 1].ayahs,
      },
    ],
  }));
  const proposal = suggestAssignment(days, "MEMORIZATION")!;
  assert.ok(proposal);
  assert.equal(proposal.range.startSurah, 64);
  assert.equal(proposal.range.startAyah, 1);
  assert.ok(
    rangeSegments(proposal.range).every((s) => s.endAyah >= s.startAyah),
  );
});
