import { strict as assert } from "node:assert";
import { test } from "node:test";
import { reportMarkup } from "../src/lib/report";
import type { DayView, StudentView } from "../src/lib/types";
const range = { startSurah: 1, startAyah: 1, endSurah: 1, endAyah: 7 };
const student: StudentView = {
  enrollmentId: "e",
  name: "طالب الفحص",
  outcome: "NOT_MEMORIZED",
  memorizationResult: "MASTERED",
  reviewResult: "NOT_MASTERED",
  note: "ملاحظة اليوم <script>",
  today: {
    id: "a",
    memorization: range,
    review: range,
    note: "ملاحظة واجب اليوم",
    imageName: "",
  },
  tomorrow: {
    id: "b",
    memorization: range,
    review: range,
    note: "ملاحظة واجب الغد",
    imageName: "",
  },
  entries: [
    {
      ...range,
      id: "r",
      kind: "MEMORIZATION",
      createdAt: "2026-10-14T12:00:00Z",
      assessment: "NOT_MASTERED",
      pageAmount: 1,
      pageMappingVersion: "fixture",
    },
    {
      ...range,
      id: "r2",
      kind: "REVIEW",
      createdAt: "2026-10-14T12:00:00Z",
      assessment: "NOT_MASTERED",
      pageAmount: 1,
      pageMappingVersion: "fixture",
    },
  ],
};
const students = Array.from({ length: 19 }, (_, i) => ({
  ...student,
  enrollmentId: `e${i}`,
  name: `طالب الفحص ${i + 1}`,
}));
const day: DayView = {
  halqaId: "h",
  halqaName: "حلقة الفحص",
  teacherName: "معلم الفحص",
  date: "2026-10-14",
  timezone: "Europe/Istanbul",
  closedAt: null,
  students,
};
test("collective report has one page and all 19 rows, duties, independent final results and escaped notes", () => {
  const html = reportMarkup(day, students, "");
  assert.equal((html.match(/class="page"/g) || []).length, 1);
  assert.equal((html.match(/data-student=/g) || []).length, 19);
  for (const s of students) assert.ok(html.includes(s.name));
  assert.match(html, /المطلوب اليوم/);
  assert.match(html, /واجب الغد/);
  assert.match(html, /ملاحظة واجب اليوم/);
  assert.match(html, /ملاحظة واجب الغد/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /class="result mastered">حافظ/);
  assert.match(html, /class="result not-mastered">غير حافظ/);
});
test("repeated ranges are labelled without losing page totals; absent rows are clear", () => {
  const repeated = {
    ...student,
    entries: [...student.entries, student.entries[0]],
  };
  const absent = {
    ...student,
    enrollmentId: "absent",
    outcome: "ABSENT" as const,
    entries: [],
  };
  const html = reportMarkup(day, [repeated, absent], "");
  assert.match(html, /2 تسميعات/);
  assert.match(html, /2 صفحة/);
  assert.match(html, /class="result absent">غائب/);
  assert.match(html, /لم يحضر/);
});
test("individual reports retain their detailed layout and a one-student class can use the collective layout", () => {
  assert.doesNotMatch(reportMarkup(day, [student], ""), /<table>/);
  assert.match(reportMarkup(day, [student], "", true), /<table>/);
});

test("legacy overall outcomes are not presented as invented independent grades", () => {
  const legacy = {
    ...student,
    memorizationResult: null,
    reviewResult: null,
    outcome: "MEMORIZED" as const,
  };
  const html = reportMarkup(day, [legacy], "", true);
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)![1];
  assert.match(body, /لم تسجل النتيجة/);
  assert.doesNotMatch(body, /class="result mastered"/);
});
