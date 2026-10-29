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
import {
  nextMemoryRange,
  validateMemoryCandidate,
  type MemorySequenceView,
  inferMemoryDirection,
} from "@/lib/memorization-order";
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
  memorySequence,
  memorization = false,
}: {
  title: string;
  value: QuranRange;
  onChange: (r: QuranRange) => void;
  memorySequence?: MemorySequenceView;
  memorization?: boolean;
}) {
  const id = title.replaceAll(" ", "-");
  const direction =
    memorySequence?.direction ??
    (memorization &&
    memorySequence &&
    !memorySequence.next &&
    memorySequence.adjacentSurahs.includes(value.startSurah)
      ? value.startSurah > memorySequence.start.surah
        ? "FORWARD"
        : "REVERSE"
      : memorization && value.startSurah
        ? inferMemoryDirection({
            ...value,
            endSurah: value.startSurah,
            endAyah: value.startAyah,
          })
        : null);
  function surahChange(side: "start" | "end", n: number) {
    const next = {
      ...value,
      [`${side}Surah`]: n,
      [`${side}Ayah`]: Math.min(value[`${side}Ayah`], surahs[n - 1].ayahs),
      ...(side === "start" &&
      (value.startSurah === value.endSurah ||
        !value.endSurah ||
        (memorySequence?.direction === "FORWARD" && value.endSurah < n) ||
        (memorySequence?.direction === "REVERSE" && value.endSurah > n))
        ? { endSurah: n, endAyah: Math.min(value.endAyah, surahs[n - 1].ayahs) }
        : {}),
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
                {!value[`${side}Surah`] && (
                  <option value={0} disabled>
                    اختر السورة
                  </option>
                )}
                {surahs
                  .filter(
                    (s) =>
                      !memorization ||
                      side === "start" ||
                      !value.startSurah ||
                      !direction ||
                      (direction === "FORWARD"
                        ? s.id >= value.startSurah
                        : s.id <= value.startSurah),
                  )
                  .map((s) => (
                    <option
                      value={s.id}
                      key={s.id}
                      disabled={
                        side === "start" &&
                        !!memorySequence &&
                        !memorySequence.problem &&
                        !memorySequence.complete &&
                        (memorySequence.direction && memorySequence.next
                          ? memorySequence.direction === "FORWARD"
                            ? s.id < memorySequence.start.surah ||
                              s.id > memorySequence.next.surah
                            : s.id > memorySequence.start.surah ||
                              s.id < memorySequence.next.surah
                          : memorySequence.next
                            ? s.id !== memorySequence.next.surah
                            : s.id !== memorySequence.start.surah &&
                              !memorySequence.adjacentSurahs.includes(s.id))
                      }
                    >
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
                max={surahs[value[`${side}Surah`] - 1]?.ayahs ?? 1}
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
                  { length: surahs[value[`${side}Surah`] - 1]?.ayahs ?? 1 },
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
      {rangeSchema.safeParse(value).success &&
        memorySequence &&
        validateMemoryCandidate(memorySequence, value) && (
          <p className="notice" role="status">
            {validateMemoryCandidate(memorySequence, value)}
          </p>
        )}
      {value.startSurah !== value.endSurah &&
        !!value.startSurah &&
        !!value.endSurah && (
          <p className="subtle">
            يشمل المدى جميع الآيات والسور بين البداية والنهاية، دون تجاوز ما
            بينها.
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
      (mode === "memory" || mode === "memory-result"
        ? nextMemoryRange(student.memorySequence, student.today?.memorization)
        : (student.today?.review ?? initialRange)),
  );
  const [memory, setMemory] = useState(
    student.tomorrow?.memorization ??
      nextMemoryRange(student.memorySequence, student.today?.memorization),
  );
  const [review, setReview] = useState(
    student.tomorrow?.review ?? student.today?.review ?? initialRange,
  );
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [reviewEnabled, setReviewEnabled] = useState(
    !!student.reviewOnly && !student.tomorrow?.review,
  );
  const [memoryEditing, setMemoryEditing] = useState(false);
  const [reviewEditing, setReviewEditing] = useState(false);
  const [note, setNote] = useState(
    mode === "assignment" ? (student.tomorrow?.note ?? "") : student.note,
  );
  const isReview = mode === "review" || mode === "review-result";
  const activityMode = [
    "memory",
    "review",
    "memory-result",
    "review-result",
  ].includes(mode);
  const resultOnly =
    (mode === "memory-result" || mode === "review-result") &&
    student.entries.some(
      (e) => e.kind === (isReview ? "REVIEW" : "MEMORIZATION"),
    );
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
    if (activityMode) {
      if (assessment !== "MASTERED" && assessment !== "NOT_MASTERED") {
        setError("اختر نتيجة التسميع أولًا");
        return;
      }
      if (resultOnly) {
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
      if (!isReview && student.memorySequence) {
        const problem = validateMemoryCandidate(
          student.memorySequence,
          result.data,
        );
        if (problem) {
          setError(problem);
          return;
        }
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
      if (memoryEnabled && student.memorySequence) {
        const problem = validateMemoryCandidate(student.memorySequence, memory);
        if (problem) {
          setError(problem);
          return;
        }
      }
      if (
        !memoryEnabled &&
        !reviewEnabled &&
        note === (student.tomorrow?.note ?? "")
      ) {
        setError("اختر واجبًا لإضافته، أو اضغط تعديل على الواجب المسجل.");
        return;
      }
      data = {
        action: "assignment",
        ...(memoryEnabled ? { memorization: memory } : {}),
        ...(reviewEnabled ? { review } : {}),
        ...(note !== (student.tomorrow?.note ?? "") ? { note } : {}),
      };
    } else if (mode === "note") data = { action: "note", note };
    else
      data = {
        action: "status",
        outcome: mode === "absent" ? "ABSENT" : student.outcome,
        note,
        carry: mode === "absent",
      };
    if (await onSave({ ...data, enrollmentId: student.enrollmentId }))
      onClose();
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
        {activityMode && (
          <>
            <p className="notice">
              {resultOnly
                ? "تعديل النتيجة فقط؛ لن يضاف تسميع جديد أو صفحات أخرى."
                : !isReview && student.memorySequence
                  ? (student.memorySequence.problem ??
                    (student.memorySequence.complete
                      ? "وصل الطالب إلى نهاية تتابع الحفظ المسجل؛ المراجعة متاحة."
                      : student.memorySequence.next
                        ? `الموضع التالي: ${surahs[student.memorySequence.next.surah - 1].name}، الآية ${student.memorySequence.next.ayah}. حدد نهاية ما سمعه الطالب فعليًا دون تجاوز آيات غير مكتملة.`
                        : "اكتمل تسميع السورة المسجلة. اختر السورة المجاورة وفق ترتيب الطالب؛ سيُعرف الاتجاه تلقائيًا."))
                  : student.today?.[isReview ? "review" : "memorization"]
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
            {!resultOnly && (
              <RangeFields
                title="مدى التسميع"
                value={range}
                onChange={setRange}
                memorySequence={!isReview ? student.memorySequence : undefined}
                memorization={!isReview}
              />
            )}
          </>
        )}
        {mode === "assignment" && (
          <>
            {(["memorization", "review"] as const).map((kind) => {
              const suggestion = student.suggestions?.[kind];
              if (
                !suggestion ||
                student.tomorrow?.[kind] ||
                (student.reviewOnly && kind === "memorization")
              )
                return null;
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
            {!student.reviewOnly &&
              student.tomorrow?.autoMemorizationStatusId && (
                <p className="notice">
                  الطالب غير حافظ الدرس الجديد:{" "}
                  {rangeText(student.tomorrow.memorization)}. تم إضافته تلقائيًا
                  إلى واجب الغد؛ يمكنك تعديله.
                </p>
              )}
            {!student.reviewOnly &&
              student.memorizationResult === "NOT_MASTERED" &&
              student.tomorrow?.memorizationManual && (
                <p className="notice">
                  الطالب غير حافظ الدرس الجديد. أبقينا واجب الغد الذي حددته
                  يدويًا؛ يمكنك تغييره هنا.
                </p>
              )}
            {student.outcome === "ABSENT" &&
              !(student.tomorrow?.memorization || student.tomorrow?.review) && (
                <p className="notice">
                  الطالب غائب ولا يوجد واجب سابق؛ يمكنك إضافة واجب لاحقًا إن
                  احتجت.
                </p>
              )}
            {(["memorization", "review"] as const).map((kind) => {
              if (student.reviewOnly && kind === "memorization") return null;
              const isMemory = kind === "memorization";
              const label = isMemory ? "الحفظ" : "المراجعة";
              const saved = student.tomorrow?.[kind];
              const editing = isMemory ? memoryEditing : reviewEditing;
              const enabled = isMemory ? memoryEnabled : reviewEnabled;
              const setEnabled = isMemory ? setMemoryEnabled : setReviewEnabled;
              const setEditing = isMemory ? setMemoryEditing : setReviewEditing;
              return (
                <section
                  className="stack"
                  key={kind}
                  aria-label={`واجب ${label}`}
                >
                  {saved && !editing ? (
                    <div className="notice">
                      <strong>تم تسجيل واجب {label}</strong>
                      <p>{rangeText(saved)}</p>
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => {
                          setEditing(true);
                          setEnabled(true);
                        }}
                      >
                        تعديل واجب {label}
                      </button>
                    </div>
                  ) : (
                    <>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={(e) => setEnabled(e.target.checked)}
                        />
                        {isMemory ? "واجب حفظ" : "واجب مراجعة"}
                      </label>
                      {enabled && (
                        <RangeFields
                          title={`مدى ${label}`}
                          value={isMemory ? memory : review}
                          onChange={isMemory ? setMemory : setReview}
                          memorySequence={
                            isMemory ? student.memorySequence : undefined
                          }
                          memorization={isMemory}
                        />
                      )}
                      {saved && (
                        <button
                          type="button"
                          className="text-button"
                          disabled={busy}
                          onClick={() => {
                            setEditing(false);
                            setEnabled(false);
                            if (isMemory) setMemory(saved);
                            else setReview(saved);
                          }}
                        >
                          إلغاء تعديل واجب {label}
                        </button>
                      )}
                    </>
                  )}
                </section>
              );
            })}
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
                  : "سيُسجل الغياب دون واجب؛ يمكنك تحديد واجب لاحقًا."}
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
            : activityMode
              ? resultOnly
                ? "حفظ النتيجة"
                : "حفظ التسجيل"
              : "حفظ"}
        </button>
      </form>
    </dialog>
  );
}
