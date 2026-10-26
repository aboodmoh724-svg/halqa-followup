"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  amountText,
  formatPages,
  rangeSchema,
  rangeText,
  surahs,
  type QuranRange,
} from "@/lib/quran";
import {
  assessmentLabels,
  type Assessment,
  type StudentView,
} from "@/lib/types";
export type Mode =
  | "edit-entry"
  | "memory"
  | "review"
  | "memory-result"
  | "review-result"
  | "assignment"
  | "absent"
  | "note";
const initialRange: QuranRange = {
  startSurah: 1,
  startAyah: 1,
  endSurah: 1,
  endAyah: 7,
};
function RangeFields({
  title,
  value,
  onChange,
}: {
  title: string;
  value: QuranRange;
  onChange: (r: QuranRange) => void;
}) {
  const id = title.replaceAll(" ", "-");
  function surahChange(side: "start" | "end", n: number) {
    const next = {
      ...value,
      [`${side}Surah`]: n,
      [`${side}Ayah`]: Math.min(value[`${side}Ayah`], surahs[n - 1].ayahs),
    };
    onChange(next);
  }
  return (
    <fieldset className="range-fields">
      <legend>{title}</legend>
      <div className="range-grid">
        {(["start", "end"] as const).map((side) => (
          <div className="contents" key={side}>
            <label>
              سورة {side === "start" ? "البداية" : "النهاية"}
              <select
                value={value[`${side}Surah`]}
                onChange={(e) => surahChange(side, Number(e.target.value))}
              >
                {surahs.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              آية {side === "start" ? "البداية" : "النهاية"}
              <input
                required
                type="number"
                inputMode="numeric"
                min={1}
                max={surahs[value[`${side}Surah`] - 1].ayahs}
                step={1}
                list={`${id}-${side}`}
                value={value[`${side}Ayah`] || ""}
                onChange={(e) =>
                  onChange({
                    ...value,
                    [`${side}Ayah`]: Number(e.target.value),
                  })
                }
              />
              <datalist id={`${id}-${side}`}>
                {Array.from(
                  { length: surahs[value[`${side}Surah`] - 1].ayahs },
                  (_, i) => (
                    <option key={i} value={i + 1} />
                  ),
                )}
              </datalist>
            </label>
          </div>
        ))}
      </div>
      {!rangeSchema.safeParse(value).success && (
        <p className="notice" role="status">
          اختر مدى صحيحًا وفق اتجاه السور، مع ترتيب الآيات داخل كل سورة من
          الأصغر إلى الأكبر.
        </p>
      )}
      {rangeSchema.safeParse(value).success && (
        <p className="range-amount" aria-live="polite">
          المقدار: {amountText(value)}
        </p>
      )}
    </fieldset>
  );
}
export default function Sheet({
  mode,
  entry,
  student,
  busy,
  onClose,
  onSave,
  saveError,
}: {
  saveError: string | null;
  mode: Mode;
  entry?: StudentView["entries"][number];
  student: StudentView;
  busy: boolean;
  onClose: (next?: Mode) => void;
  onSave: (data: Record<string, unknown>) => Promise<boolean>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [range, setRange] = useState(
    entry ??
      student.today?.[mode === "review" ? "review" : "memorization"] ??
      initialRange,
  );
  const [memory, setMemory] = useState(
    student.tomorrow?.memorization ??
      student.today?.memorization ??
      initialRange,
  );
  const [review, setReview] = useState(
    student.tomorrow?.review ?? student.today?.review ?? initialRange,
  );
  const [memoryEnabled, setMemoryEnabled] = useState(
    !!student.tomorrow?.memorization || !student.tomorrow,
  );
  const [reviewEnabled, setReviewEnabled] = useState(
    !!student.tomorrow?.review || !student.tomorrow,
  );
  const [note, setNote] = useState(
    mode === "assignment" ? (student.tomorrow?.note ?? "") : student.note,
  );
  const imageName = student.tomorrow?.imageName ?? "";
  const resultOnly = mode === "memory-result" || mode === "review-result";
  const isReview = mode === "review" || mode === "review-result";
  const [assessment, setAssessment] = useState<Assessment | "">(
    resultOnly
      ? (((isReview
          ? student.reviewResult
          : student.memorizationResult) as Assessment) ?? "")
      : "",
  );

  const [error, setError] = useState("");
  const requestKey = useRef<string>("");
  useEffect(() => {
    dialog.current?.showModal();
    requestKey.current = crypto.randomUUID();
  }, []);
  const titles = {
    "edit-entry": "تعديل مدى التسميع",
    memory: "إضافة حفظ جديد",
    review: "إضافة مراجعة",
    "memory-result": "تعديل نتيجة الحفظ",
    "review-result": "تعديل نتيجة المراجعة",
    assignment: "واجب الغد",
    absent: "تسجيل الغياب",
    note: "ملاحظة اليوم",
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (mode === "edit-entry") {
      const result = rangeSchema.safeParse(range);
      if (!result.success) {
        setError(result.error.issues[0].message);
        return;
      }
      if (!entry) {
        setError("التسميع غير موجود");
        return;
      }
      if (
        await onSave({
          action: "edit-entry",
          entryId: entry.id,
          enrollmentId: student.enrollmentId,
          range: result.data,
        })
      )
        onClose();
      return;
    }
    let data: Record<string, unknown>;
    if (mode === "memory" || mode === "review" || resultOnly) {
      if (assessment !== "MASTERED" && assessment !== "NOT_MASTERED") {
        setError("اختر نتيجة التسميع أولًا");
        return;
      }
      if (resultOnly) {
        if (
          assessment === "MASTERED" &&
          !student.entries.some(
            (e) => e.kind === (isReview ? "REVIEW" : "MEMORIZATION"),
          )
        ) {
          onClose(isReview ? "review" : "memory");
          return;
        }
        if (
          await onSave({
            action: "assessment",
            kind: isReview ? "REVIEW" : "MEMORIZATION",
            assessment,
            enrollmentId: student.enrollmentId,
          })
        )
          onClose();
        return;
      }
      const result = rangeSchema.safeParse(range);
      if (!result.success) {
        setError(result.error.issues[0].message);
        return;
      }
      data = {
        action: "entry",
        assessment,
        kind: isReview ? "REVIEW" : "MEMORIZATION",
        range: result.data,
        requestKey: requestKey.current,
      };
    } else if (mode === "assignment") {
      for (const [enabled, r] of [
        [memoryEnabled, memory],
        [reviewEnabled, review],
      ] as const)
        if (enabled) {
          const check = rangeSchema.safeParse(r);
          if (!check.success) {
            setError(check.error.issues[0].message);
            return;
          }
        }
      data = {
        action: "assignment",
        memorization: memoryEnabled ? memory : null,
        review: reviewEnabled ? review : null,
        note,
        imageName,
      };
    } else if (mode === "note") data = { action: "note", note };
    else
      data = {
        action: "status",
        outcome: mode === "absent" ? "ABSENT" : student.outcome,
        note,
        carry: mode === "absent",
      };
    if (await onSave({ ...data, enrollmentId: student.enrollmentId })) {
      const hasToday = !!(student.today?.memorization || student.today?.review);
      const hasTomorrow = !!(
        student.tomorrow?.memorization || student.tomorrow?.review
      );
      onClose(
        mode === "absent" && !hasToday && !hasTomorrow
          ? "assignment"
          : undefined,
      );
    }
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby="sheet-title"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <form className="sheet stack" onSubmit={submit} noValidate>
        <div className="sheet-header">
          <h2 id="sheet-title">{titles[mode]}</h2>
          <button
            type="button"
            disabled={busy}
            onClick={() => onClose()}
            aria-label="إغلاق"
          >
            ×
          </button>
        </div>
        {mode === "edit-entry" && (
          <>
            <p className="notice">
              صحّح السورة والآيات؛ يُعاد حساب المقدار دون إضافة تسميع جديد. تبقى
              نتيجة حافظ / غير حافظ كما هي، ويمكن تعديلها من نتائج اليوم.
            </p>
            <RangeFields
              title="مدى التسميع"
              value={range}
              onChange={setRange}
            />
          </>
        )}
        {(mode === "memory" || mode === "review" || resultOnly) && (
          <>
            <p className="notice">
              {resultOnly
                ? "تعديل النتيجة فقط؛ لن يضاف تسميع جديد أو صفحات أخرى."
                : student.today?.[mode === "review" ? "review" : "memorization"]
                  ? "تم تعبئة واجب اليوم. عدّل المدى حسب التسميع الفعلي."
                  : "حدد ما سمعه الطالب في هذه المرة."}
            </p>
            <fieldset className="assessment-picker">
              <legend>نتيجة {isReview ? "المراجعة" : "الحفظ"}</legend>
              <div className="assessment-options">
                {(["MASTERED", "NOT_MASTERED"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`assessment-choice ${value}`}
                    aria-pressed={assessment === value}
                    onClick={() => {
                      setAssessment(value);
                      setError("");
                    }}
                  >
                    {assessmentLabels[value]}
                  </button>
                ))}
              </div>
            </fieldset>
            {!resultOnly && assessment === "NOT_MASTERED" && (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={async () => {
                  if (
                    await onSave({
                      action: "assessment",
                      kind: isReview ? "REVIEW" : "MEMORIZATION",
                      assessment: "NOT_MASTERED",
                      enrollmentId: student.enrollmentId,
                    })
                  )
                    onClose();
                }}
              >
                غير حافظ — دون تسميع
              </button>
            )}
            {!resultOnly && (
              <RangeFields
                title="مدى التسميع"
                value={range}
                onChange={setRange}
              />
            )}
          </>
        )}
        {mode === "assignment" && (
          <>
            {(["memorization", "review"] as const).map((kind) => {
              const suggestion = student.suggestions?.[kind];
              if (!suggestion || student.tomorrow?.[kind]) return null;
              return (
                <div className="notice" key={kind}>
                  <strong>
                    اقتراح {kind === "memorization" ? "حفظ" : "مراجعة"}:{" "}
                    {rangeText(suggestion.range)}
                  </strong>
                  <p>
                    بناءً على متوسط {formatPages(suggestion.averagePages)} صفحة
                    في آخر {suggestion.sampleDays} أيام تسميع. لا يُحسب إنجازًا.
                  </p>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      if (kind === "memorization") {
                        setMemory(suggestion.range);
                        setMemoryEnabled(true);
                      } else {
                        setReview(suggestion.range);
                        setReviewEnabled(true);
                      }
                    }}
                  >
                    استخدام اقتراح{" "}
                    {kind === "memorization" ? "الحفظ" : "المراجعة"}
                  </button>
                </div>
              );
            })}
            {student.tomorrow?.autoMemorizationStatusId && (
              <p className="notice">
                الطالب غير حافظ الدرس الجديد:{" "}
                {rangeText(student.tomorrow.memorization)}. تم إضافته تلقائيًا
                إلى واجب الغد؛ يمكنك تعديله.
              </p>
            )}
            {student.memorizationResult === "NOT_MASTERED" &&
              student.tomorrow?.memorizationManual && (
                <p className="notice">
                  الطالب غير حافظ الدرس الجديد. أبقينا واجب الغد الذي حددته
                  يدويًا؛ يمكنك تغييره هنا.
                </p>
              )}
            {student.outcome === "ABSENT" &&
              !(student.tomorrow?.memorization || student.tomorrow?.review) && (
                <p className="notice">
                  الطالب غائب ولا يوجد واجب سابق؛ حدد واجب الغد الآن.
                </p>
              )}
            <label className="check">
              <input
                type="checkbox"
                checked={memoryEnabled}
                onChange={(e) => setMemoryEnabled(e.target.checked)}
              />
              واجب حفظ
            </label>
            {memoryEnabled && (
              <RangeFields
                title="مدى الحفظ"
                value={memory}
                onChange={setMemory}
              />
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={reviewEnabled}
                onChange={(e) => setReviewEnabled(e.target.checked)}
              />
              واجب مراجعة
            </label>
            {reviewEnabled && (
              <RangeFields
                title="مدى المراجعة"
                value={review}
                onChange={setReview}
              />
            )}
          </>
        )}
        {mode === "absent" && (
          <>
            <p className="notice">يمكنك إلغاء الغياب إذا حضر الطالب لاحقًا.</p>
            <p className="notice">
              {student.today?.memorization || student.today?.review
                ? "سيُنقل واجب اليوم للغد تلقائيًا، مع إبقاء أي واجب سبق تحديده للغد."
                : student.tomorrow?.memorization || student.tomorrow?.review
                  ? "لا يوجد واجب اليوم؛ واجب الغد الذي حددته سيبقى محفوظًا."
                  : "لا يوجد واجب اليوم. بعد تسجيل الغياب ستفتح نافذة واجب الغد لتحديده."}
            </p>
            {student.tomorrow && (
              <p className="subtle">
                يوجد واجب للغد؛ سيبقى محفوظًا دون استبداله.
              </p>
            )}
          </>
        )}
        {(mode === "assignment" || mode === "absent" || mode === "note") && (
          <label>
            ملاحظة اختيارية
            <textarea
              rows={3}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        )}
        {(error || saveError) && (
          <p className="notice error" role="alert">
            {error || saveError}
          </p>
        )}
        <button className="primary" disabled={busy} type="submit">
          {busy
            ? "جارٍ الحفظ…"
            : mode === "memory" || mode === "review" || resultOnly
              ? resultOnly
                ? "حفظ النتيجة"
                : "حفظ التسجيل"
              : "حفظ"}
        </button>
      </form>
    </dialog>
  );
}
