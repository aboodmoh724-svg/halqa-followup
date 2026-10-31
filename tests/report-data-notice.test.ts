import { test } from "node:test";
import { strict as assert } from "node:assert";
import { reportDataNotice } from "../src/lib/report-data-notice";
import type { SupervisionReport } from "../src/lib/supervision-report";

test("report notices distinguish incomplete coverage, unclassified pupils and evidence-based ranking", () => {
  const base = {
    query: { type: "comprehensive" },
    summary: {
      expectedStudyDays: 795,
      recordedStudyDays: 5,
      completedStudyDays: 4,
    },
    supportUnassessedCount: 152,
  } as SupervisionReport;
  assert.match(reportDataNotice(base)!, /5 من 795/);
  assert.match(reportDataNotice(base)!, /عدم التسجيل لا يعني غيابًا أو ضعفًا/);
  assert.equal(
    reportDataNotice({
      ...base,
      summary: {
        ...base.summary,
        recordedStudyDays: 795,
        completedStudyDays: 795,
      },
    }),
    null,
  );
  const support = {
    ...base,
    query: { ...base.query, type: "support" as const },
  };
  assert.match(reportDataNotice(support)!, /لم يُصنف 152/);
  assert.equal(
    reportDataNotice({ ...support, supportUnassessedCount: 0 }),
    null,
  );
  assert.match(
    reportDataNotice({ ...base, query: { ...base.query, type: "excellent" } })!,
    /لا تُملأ المراكز/,
  );
  assert.equal(
    reportDataNotice({ ...base, query: { ...base.query, type: "absence" } }),
    null,
  );
});
