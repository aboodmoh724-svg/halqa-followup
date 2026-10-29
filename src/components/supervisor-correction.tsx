"use client";
import { useEffect, useState } from "react";
import { RangeFields } from "./recitation-sheet";
import { assignmentDateLabel } from "@/lib/dates";
import type { QuranRange } from "@/lib/quran";
import { rangeSchema, rangeText } from "@/lib/quran";
import { assessmentLabels, type Assessment } from "@/lib/types";
import type { getCorrection } from "@/lib/supervisor-corrections";
type View = Awaited<ReturnType<typeof getCorrection>>;
const initial: QuranRange = {
  startSurah: 1,
  startAyah: 1,
  endSurah: 1,
  endAyah: 7,
};
export default function SupervisorCorrection({
  halqaId,
  enrollmentId,
  date,
  onClose,
  onSaved,
}: {
  halqaId: string;
  enrollmentId: string;
  date: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [data, setData] = useState<View | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [action, setAction] = useState(""),
    [range, setRange] = useState<QuranRange>(initial),
    [entryId, setEntryId] = useState(""),
    [kind, setKind] = useState("MEMORIZATION"),
    [result, setResult] = useState("MASTERED"),
    [note, setNote] = useState("");
  const [memory, setMemory] = useState<QuranRange | null>(null),
    [review, setReview] = useState<QuranRange | null>(null),
    [imageName, setImageName] = useState("");
  const url = `/api/supervisor/halqas/${halqaId}/students/${enrollmentId}/correction`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${url}?date=${date}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw Error(body.error);
        return body as View;
      })
      .then((v) => {
        setData(v);
        setNote(v.note);
        setMemory(
          v.assignment?.memorization
            ? rangeSchema.parse(v.assignment.memorization)
            : null,
        );
        setReview(
          v.assignment?.review ? rangeSchema.parse(v.assignment.review) : null,
        );
        setImageName(v.assignment?.imageName ?? "");
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [url, date]);
  async function save() {
    if (!data) return;
    setBusy(true);
    setError("");
    try {
      const payload =
        action === "entry"
          ? { entryId, range }
          : action === "result"
            ? { kind: data.reviewOnly ? "REVIEW" : kind, result }
            : action === "note"
              ? { note }
              : action === "attendance"
                ? { absent: data.outcome !== "ABSENT" }
                : { memorization: memory, review, note, imageName };
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          version: data.version,
          action,
          ...payload,
        }),
      });
      const body = await r.json();
      if (!r.ok) throw Error(body.error);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="record-homework supervisor-correction"
      aria-label="تصحيح سجل الطالب"
    >
      <div className="history-section-title">
        <h3>تصحيح سجل {date}</h3>
        <button className="text-button" onClick={onClose} disabled={busy}>
          إغلاق
        </button>
      </div>
      <p className="subtle">
        يُحفظ أثر التصحيح داخليًا. تعديل اليوم القديم لا يرحّل واجباته تلقائيًا
        إلى الأيام التالية.
      </p>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">جارٍ فتح التسجيل…</p>}
      {data && (
        <>
          <label>
            ما الذي تريد تصحيحه؟
            <select
              value={action}
              disabled={busy}
              onChange={(e) => {
                setAction(e.target.value);
                setNote(
                  e.target.value === "assignment"
                    ? (data.assignment?.note ?? "")
                    : data.note,
                );
              }}
            >
              <option value="">اختر التصحيح</option>
              <option value="entry">مدى تسميع مسجل</option>
              <option value="result">نتيجة الحفظ أو المراجعة</option>
              <option value="attendance">الغياب والحضور</option>
              <option value="note">ملاحظة اليوم</option>
              <option value="assignment">واجب اليوم التالي</option>
            </select>
          </label>
          {action === "entry" && (
            <>
              <label>
                التسميع
                <select
                  value={entryId}
                  onChange={(e) => {
                    setEntryId(e.target.value);
                    const entry = data.entries.find(
                      (x) => x.id === e.target.value,
                    );
                    if (entry) setRange(rangeSchema.parse(entry));
                  }}
                >
                  <option value="">اختر التسميع</option>
                  {data.entries.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.kind === "MEMORIZATION" ? "حفظ" : "مراجعة"} ·{" "}
                      {rangeText(e)}
                    </option>
                  ))}
                </select>
              </label>
              {entryId && (
                <RangeFields
                  title="تصحيح المدى"
                  value={range}
                  onChange={setRange}
                />
              )}
            </>
          )}
          {action === "result" && (
            <>
              <label>
                النشاط
                <select
                  value={data.reviewOnly ? "REVIEW" : kind}
                  onChange={(e) => setKind(e.target.value)}
                >
                  {!data.reviewOnly && (
                    <option value="MEMORIZATION">الحفظ الجديد</option>
                  )}
                  <option value="REVIEW">المراجعة</option>
                </select>
              </label>
              <p className="subtle">
                النتيجة الحالية:{" "}
                {assessmentLabels[
                  (data.reviewOnly || kind === "REVIEW"
                    ? data.reviewResult
                    : data.memorizationResult) as Assessment
                ] ?? "لم تسجل"}
              </p>
              <label>
                النتيجة الصحيحة
                <select
                  value={result}
                  onChange={(e) => setResult(e.target.value)}
                >
                  <option value="MASTERED">حافظ</option>
                  <option value="NOT_MASTERED">غير حافظ</option>
                </select>
              </label>
            </>
          )}
          {action === "attendance" && (
            <p className="notice">
              {data.outcome === "ABSENT"
                ? "سيُلغى الغياب؛ تبقى نتائج التسميع كما هي إن وجدت."
                : "سيُسجل الطالب غائبًا. لا يمكن ذلك عند وجود تسميع مسجل."}
            </p>
          )}
          {action === "assignment" && (
            <>
              <p className="subtle">موعد الواجب: {assignmentDateLabel(date)}</p>
              {!data.reviewOnly && (
                <>
                  <label>
                    <input
                      type="checkbox"
                      checked={!!memory}
                      onChange={(e) =>
                        setMemory(e.target.checked ? initial : null)
                      }
                    />{" "}
                    واجب حفظ
                  </label>
                  {memory && (
                    <RangeFields
                      title="واجب الحفظ"
                      value={memory}
                      onChange={setMemory}
                    />
                  )}
                </>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={!!review}
                  onChange={(e) => setReview(e.target.checked ? initial : null)}
                />{" "}
                واجب مراجعة
              </label>
              {review && (
                <RangeFields
                  title="واجب المراجعة"
                  value={review}
                  onChange={setReview}
                />
              )}
              <label>
                اسم الصورة كنص
                <input
                  value={imageName}
                  maxLength={100}
                  onChange={(e) => setImageName(e.target.value)}
                />
              </label>
            </>
          )}
          {(action === "note" || action === "assignment") && (
            <label>
              الملاحظة
              <textarea
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          )}
          {action && (
            <button
              className="primary"
              disabled={
                busy ||
                (action === "entry" &&
                  (!entryId || !rangeSchema.safeParse(range).success))
              }
              onClick={() => {
                void save();
              }}
            >
              {busy ? "جارٍ حفظ التصحيح…" : "حفظ التصحيح"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
