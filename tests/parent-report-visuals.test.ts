import { strict as assert } from "node:assert";
import { test } from "node:test";
import { reportMarkup } from "../src/lib/report";
import type { DayView, StudentView } from "../src/lib/types";

const student: StudentView = {
  enrollmentId: "e",
  name: "طالب",
  outcome: "NOT_MEMORIZED",
  memorizationResult: "MASTERED",
  reviewResult: "NOT_MASTERED",
  note: "تثبيت آخر الآيات <script>",
  today: null,
  tomorrow: null,
  entries: [],
};
const day: DayView = {
  halqaId: "h",
  halqaName: "حلقة",
  teacherName: "معلم",
  date: "2026-10-26",
  timezone: "Europe/Istanbul",
  closedAt: null,
  students: [student],
};

test("parent PDF shows daily outcome and independent shapes, homework and prominent escaped note", () => {
  const html = reportMarkup(day, [student], "");
  assert.match(html, /daily-status not-mastered/);
  assert.match(html, /data-icon="check"/);
  assert.match(html, /data-icon="attention"/);
  assert.match(html, /data-label="حافظ"/);
  assert.match(html, /data-label="غير حافظ"/);
  assert.match(html, /data-icon="calendar"/);
  assert.match(html, /note-callout teacher-note/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|المطلوب اليوم|ممتاز|ضعيف/);
  assert.ok(
    html.indexOf('class="note-callout teacher-note"') <
      html.indexOf('class="actual"'),
  );
});

test("absence overrides historical results; legacy overall result never invents independent grades", () => {
  const absent = { ...student, outcome: "ABSENT" as const };
  const html = reportMarkup(day, [absent], "");
  assert.match(html, /data-icon="absent"/);
  assert.doesNotMatch(html, /data-label="حافظ"|data-label="غير حافظ"/);
  const legacy = {
    ...student,
    outcome: "MEMORIZED" as const,
    memorizationResult: null,
    reviewResult: null,
  };
  const oldHtml = reportMarkup(day, [legacy], "");
  assert.match(oldHtml, /daily-status mastered/);
  assert.equal((oldHtml.match(/data-label="حافظ"/g) ?? []).length, 1);
  assert.equal((oldHtml.match(/data-icon="pending"/g) ?? []).length, 2);
});
