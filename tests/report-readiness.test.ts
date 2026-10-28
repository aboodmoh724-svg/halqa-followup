import { strict as assert } from "node:assert";
import { test } from "node:test";
import { reportIssues, type StudentView, type DayView } from "../src/lib/types";
import { generateReport, reportMarkup } from "../src/lib/report";
const range = { startSurah: 1, startAyah: 1, endSurah: 1, endAyah: 7 };
const student: StudentView = {
  enrollmentId: "e",
  name: "طالب الفحص",
  outcome: "NOT_MEMORIZED",
  memorizationResult: "MASTERED",
  reviewResult: "NOT_MASTERED",
  note: "",
  today: null,
  tomorrow: {
    id: "a",
    memorization: range,
    review: range,
    note: "",
    imageName: "",
  },
  entries: ["MEMORIZATION", "REVIEW"].map((kind, i) => ({
    ...range,
    id: String(i),
    kind: kind as "MEMORIZATION" | "REVIEW",
    createdAt: "2026-10-14T10:00:00Z",
    pageAmount: 1,
    pageMappingVersion: "test",
  })),
};
test("parent report requires both recorded results and tomorrow assignment", () => {
  assert.deepEqual(reportIssues(student), []);
  assert.deepEqual(reportIssues({ ...student, tomorrow: null }), ["واجب الغد"]);
  assert.ok(
    reportIssues({ ...student, reviewResult: null }).includes("نتيجة المراجعة"),
  );
  assert.ok(
    reportIssues({ ...student, entries: [] }).includes("مدى الحفظ الجديد"),
  );
});
test("first-day absence needs neither homework nor recitation nor assessment", () => {
  const absent = {
    ...student,
    outcome: "ABSENT" as const,
    entries: [],
    memorizationResult: null,
    reviewResult: null,
  };
  assert.deepEqual(reportIssues(absent), []);
  assert.deepEqual(reportIssues({ ...absent, tomorrow: null }), []);
});

test("غير حافظ without recitation completes the day without invented pages or required amount", () => {
  const noRecitation: StudentView = {
    ...student,
    memorizationResult: "NOT_MASTERED",
    reviewResult: "NOT_MASTERED",
    entries: [],
  };
  assert.deepEqual(reportIssues(noRecitation), []);
  const day: DayView = {
    halqaId: "h",
    halqaName: "حلقة",
    teacherName: "معلم",
    date: "2026-10-26",
    timezone: "Europe/Istanbul",
    closedAt: null,
    students: [noRecitation],
  };
  const html = reportMarkup(day, [noRecitation], "");
  assert.match(html, /غير حافظ/);
  assert.doesNotMatch(html, /المطلوب اليوم/);
  assert.match(html, /لا يوجد تسميع مسجل/);
});
test("closed legacy reports remain readable without inventing split results", () => {
  const legacy = {
    ...student,
    memorizationResult: null,
    reviewResult: null,
    tomorrow: null,
  };
  assert.deepEqual(reportIssues(legacy, true), []);
  assert.ok(reportIssues(legacy).length > 0);
});
test("PDF generator rejects incomplete reports before rendering", async () => {
  const incomplete = { ...student, tomorrow: null };
  const day: DayView = {
    halqaId: "h",
    halqaName: "حلقة الفحص",
    teacherName: "معلم الفحص",
    date: "2026-10-14",
    timezone: "Europe/Istanbul",
    closedAt: null,
    students: [incomplete],
  };
  await assert.rejects(
    () => generateReport(day, [incomplete]),
    /التقرير غير مكتمل/,
  );
});

test("parent report distinguishes final result from earlier recitation grade", () => {
  const changed = {
    ...student,
    entries: student.entries.map((e) => ({ ...e, assessment: "NOT_MASTERED" })),
  };
  const day: DayView = {
    halqaId: "h",
    halqaName: "حلقة الفحص",
    teacherName: "معلم الفحص",
    date: "2026-10-14",
    timezone: "Europe/Istanbul",
    closedAt: null,
    students: [changed],
  };
  const html = reportMarkup(day, [changed], "");
  assert.match(html, /التقرير اليومي لأولياء الأمور/);
  assert.match(html, /النتيجة النهائية: حافظ/);
  assert.match(html, /عند التسميع: غير حافظ/);
});
