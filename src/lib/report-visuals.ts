import {
  assessmentLabels,
  labels,
  type Assessment,
  type StudentView,
} from "./types";

export const escapeReportText = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

// Inline vector shapes remain sharp in WhatsApp and work without emoji fonts
// or colour. Every status also has an explicit Arabic text label.
const paths = {
  check: '<circle cx="12" cy="12" r="9"/><path d="m7.5 12 3 3 6-6"/>',
  attention: '<path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5m0 3v.1"/>',
  absent: '<circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/>',
  pending: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  book: '<path d="M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1Zm0 0v15"/>',
  review: '<path d="M20 7a9 9 0 1 0 1 8M20 3v5h-5"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18m-13 5h3m2 0h3"/>',
  note: '<path d="M4 3h16v14H9l-5 4V3Z"/><path d="M12 6v5m0 3v.1"/>',
};
export function reportIcon(name: keyof typeof paths) {
  return `<svg class="report-icon" data-icon="${name}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}
export function resultView(
  student: StudentView,
  kind?: "MEMORIZATION" | "REVIEW",
) {
  if (student.outcome === "ABSENT")
    return { style: "absent", icon: "absent" as const, label: "غائب" };
  const result = kind
    ? kind === "MEMORIZATION"
      ? student.memorizationResult
      : student.reviewResult
    : student.outcome;
  if (result === "MASTERED" || result === "MEMORIZED")
    return { style: "mastered", icon: "check" as const, label: "حافظ" };
  if (result === "NOT_MASTERED" || result === "NOT_MEMORIZED")
    return {
      style: "not-mastered",
      icon: "attention" as const,
      label: "غير حافظ",
    };
  return {
    style: "pending",
    icon: "pending" as const,
    label: kind
      ? (assessmentLabels[result as Assessment] ?? "لم تسجل النتيجة")
      : student.outcome
        ? labels[student.outcome]
        : "بانتظار النتيجة",
  };
}
export function resultBadge(
  student: StudentView,
  kind?: "MEMORIZATION" | "REVIEW",
) {
  const result = resultView(student, kind);
  return `<span class="result ${result.style}" data-label="${escapeReportText(result.label)}">${reportIcon(result.icon)}<span>${escapeReportText(result.label)}</span></span>`;
}
export const reportVisualCss = `.report-icon{display:inline-block;width:1.35em;height:1.35em;vertical-align:middle;flex-shrink:0}.result{display:inline-flex;align-items:center;gap:.45em;padding:.2em .6em;border-radius:8px;font-weight:700;line-height:1.6;white-space:nowrap}.mastered{background:#e2f2e9;color:#165b3d}.not-mastered{background:#fff0e9;color:#91371d}.absent,.pending{background:#edf0f3;color:#455464}.section-title{display:flex;align-items:center;gap:9px}.legend{display:flex;gap:12px;flex-wrap:wrap}.note-callout{border:2px solid #c68a24!important;background:#fff8e8!important;color:#503b16}.note-callout h2,.note-label{color:#795013}.note{white-space:pre-wrap;overflow-wrap:anywhere}.note-label{display:flex;gap:8px;align-items:center;font-weight:700}`;
