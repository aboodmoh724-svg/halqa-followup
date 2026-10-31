import { test } from "node:test";
import { strict as assert } from "node:assert";
import { schoolClassCompare } from "../src/lib/report-format";
test("school class lists follow preparatory then grades 1-6 and section letters, independently of recorded status", () => {
  const names = [
    "السادس",
    "الثاني ب",
    "الأول ج",
    "الخامس",
    "التأهيلي ب",
    "الثالث",
    "الأول ب",
    "الرابع",
    "حلقة أخرى",
    "التأهيلي أ",
    "الثاني أ",
    "الأول أ",
  ];
  const rows = names.map((name, i) => ({ name, confirmed: i % 2 === 0 }));
  assert.deepEqual(
    rows.sort(schoolClassCompare).map((x) => x.name),
    [
      "التأهيلي أ",
      "التأهيلي ب",
      "الأول أ",
      "الأول ب",
      "الأول ج",
      "الثاني أ",
      "الثاني ب",
      "الثالث",
      "الرابع",
      "الخامس",
      "السادس",
      "حلقة أخرى",
    ],
  );
});
