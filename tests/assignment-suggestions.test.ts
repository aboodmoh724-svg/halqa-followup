import { strict as assert } from "node:assert";
import { test } from "node:test";
import { suggestAssignment } from "../src/lib/assignment-suggestions";
import { pageAmount, rangeSegments, surahs } from "../src/lib/quran";
import type { EntryView } from "../src/lib/types";

const history = (surah = 2) =>
  Array.from({ length: 5 }, (_, i) => ({
    date: `2026-10-${[22, 23, 26, 27, 28][i]}`,
    entries: [
      {
        id: String(i),
        kind: "MEMORIZATION",
        assessment: "MASTERED",
        createdAt: `2026-10-${[22, 23, 26, 27, 28][i]}T09:00:00Z`,
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
  unstable[0].entries = [
    { ...unstable[0].entries[0], startAyah: 1, endAyah: 286 },
  ];
  assert.equal(suggestAssignment(unstable, "MEMORIZATION"), null);
});
test("repeats and overlapping attempts do not inflate the suggested daily amount", () => {
  const days = history(),
    baseline = suggestAssignment(days, "MEMORIZATION")!;
  days[2].entries.push({ ...days[2].entries[0], id: "repeat", startAyah: 18 });
  assert.equal(
    suggestAssignment(days, "MEMORIZATION")?.averagePages,
    baseline.averagePages,
  );
  const four = history().slice(0, 4);
  assert.equal(
    suggestAssignment(
      [
        ...four,
        { ...four[0], entries: [{ ...four[0].entries[0], id: "same-day" }] },
      ],
      "MEMORIZATION",
    ),
    null,
  );
});
test("five prior school days set the average while today's partial entry only advances the start", () => {
  const prior = history(),
    baseline = suggestAssignment(prior, "MEMORIZATION")!;
  const today = {
    date: "2026-10-29",
    entries: [
      {
        ...prior[0].entries[0],
        id: "today",
        createdAt: "2026-10-29T09:00:00Z",
        startAyah: 38,
        endAyah: 39,
      },
    ],
  };
  const proposal = suggestAssignment([...prior, today], "MEMORIZATION", {
    beforeDate: today.date,
    throughDate: today.date,
  })!;
  assert.equal(proposal.averagePages, baseline.averagePages);
  assert.equal(proposal.range.startAyah, 40);
  assert.equal(
    suggestAssignment(
      [
        ...prior,
        {
          ...today,
          entries: today.entries.map((e) => ({
            ...e,
            assessment: "NOT_MASTERED",
          })),
        },
      ],
      "MEMORIZATION",
      { beforeDate: today.date },
    ),
    null,
  );
});
test("recent difficult days are not silently replaced by older successes; kinds stay independent", () => {
  const days = history();
  const older = {
    ...days[0],
    date: "2026-10-21",
    entries: days[0].entries.map((e) => ({ ...e, id: "older" })),
  };
  days[2].entries[0].assessment = "NOT_MASTERED";
  assert.equal(suggestAssignment([older, ...days], "MEMORIZATION"), null);
  const review = history().map((d) => ({
    ...d,
    entries: d.entries.map((e) => ({
      ...e,
      id: "review" + e.id,
      kind: "REVIEW" as const,
    })),
  }));
  assert(suggestAssignment([...days, ...review], "REVIEW"));
});
test("a disproportionately long next verse is not proposed as a usual small amount", () => {
  const tiny = history().map((d) => ({
    ...d,
    entries: d.entries.map((e) => ({ ...e, startAyah: 280, endAyah: 281 })),
  }));
  assert.equal(suggestAssignment(tiny, "MEMORIZATION"), null);
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
