"use client";
import { useCallback, useEffect, useState } from "react";
import type { StudentExamView } from "@/lib/exam-service";
import type { ExamQuestion } from "@/lib/exam-policy";
import { surahs, rangeSchema, rangeText, type QuranRange } from "@/lib/quran";
import { RangeFields } from "./recitation-sheet";
const emptyQuestions = (): ExamQuestion[] =>
  Array.from({ length: 3 }, () => ({ prompting: 0, warning: 0, tajweed: 0 }));
const stateLabels: Record<string, string> = {
  READY: "أتم الجزء · ينتظر الاختبار",
  SURAH_REVIEW: "أتم الجزء · يلزم تسميع السور المكتملة كاملة",
  SUBMITTED: "أُرسل الاختبار · ينتظر اعتماد المشرف",
  APPROVED: "تم اعتماد الاختبار",
  RETRY: "إعادة الاختبار",
  CHANGED: "تغير دليل الإتمام · يحتاج مراجعة المشرف",
};
export default function StudentExams({
  halqaId,
  enrollmentId,
  supervisor = false,
  onChanged,
  initialPart,
  refreshToken,
}: {
  halqaId: string;
  enrollmentId: string;
  supervisor?: boolean;
  onChanged?: () => void;
  initialPart?: number;
  refreshToken?: string;
}) {
  const [data, setData] = useState<StudentExamView | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number | null>(initialPart ?? null),
    [questions, setQuestions] = useState(emptyQuestions),
    [confirmed, setConfirmed] = useState(false),
    [note, setNote] = useState("");
  const [ranges, setRanges] = useState<QuranRange[]>([]),
    [range, setRange] = useState<QuranRange>({
      startSurah: 114,
      startAyah: 1,
      endSurah: 114,
      endAyah: 6,
    }),
    [baselineNote, setBaselineNote] = useState(""),
    [baselineConfirmed, setBaselineConfirmed] = useState(false),
    [fullSurah, setFullSurah] = useState<number | null>(null);
  const endpoint = `/api/${supervisor ? "supervisor/" : ""}halqas/${halqaId}/students/${enrollmentId}/exams`;
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const r = await fetch(endpoint, { cache: "no-store", signal }),
          d = await r.json();
        if (!r.ok) throw Error(d.error);
        setData(d);
        setError("");
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      }
    },
    [endpoint],
  );
  useEffect(() => {
    const c = new AbortController();
    queueMicrotask(() => {
      if (!c.signal.aborted) void load(c.signal);
    });
    return () => c.abort();
  }, [load, refreshToken]);
  async function post(
    url: string,
    body: unknown,
    success: string,
    isRecitation = false,
  ) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (isRecitation) await load();
      else setData(d);
      setMessage(success);
      setFullSurah(null);
      setConfirmed(false);
      setQuestions(emptyQuestions());
      setNote("");
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const part = data?.parts.find((p) => p.number === selected);
  const schoolDate = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: data?.timezone || "Europe/Istanbul",
    }).format(new Date(iso));
  if (data?.reviewOnly) return null;
  return (
    <section className="exam-panel stack" aria-label="إتمام الطالب واختباراته">
      <h3>الإتمام والاختبارات</h3>
      {supervisor && data && (
        <p>
          <strong>{data.studentName}</strong>
          <span className="subtle block">
            {data.halqaName} · المعلم الحالي: {data.currentTeacherName}
          </span>
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {!data ? (
        <p>جارٍ قراءة سجل الإتمام…</p>
      ) : (
        <>
          {data.surahs.map((s) => (
            <div className="exam-item" key={s.number}>
              <strong>أتم سورة {s.name}</strong>
              <p>
                يلزم تسميعها كاملة مرة واحدة بإتقان قبل الانتقال إلى سورة أخرى.
              </p>
              {!supervisor && (
                <button
                  className="secondary"
                  disabled={busy || !!data.readOnlyReason}
                  onClick={() => setFullSurah(s.number)}
                >
                  تسجيل تسميع سورة {s.name} كاملة
                </button>
              )}
            </div>
          ))}
          {fullSurah && (
            <div className="notice">
              <p>
                هل سمّع الطالب سورة {surahs[fullSurah - 1].name} كاملة في جلسة
                واحدة بإتقان؟ سيُسجل هذا التسميع مراجعة فعلية.
              </p>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void post(
                    `/api/halqas/${halqaId}`,
                    {
                      action: "entry",
                      date: data.today,
                      enrollmentId,
                      kind: "REVIEW",
                      assessment: "MASTERED",
                      range: {
                        startSurah: fullSurah,
                        startAyah: 1,
                        endSurah: fullSurah,
                        endAyah: surahs[fullSurah - 1].ayahs,
                      },
                      requestKey: crypto.randomUUID(),
                    },
                    "تم تسجيل تسميع السورة كاملة",
                    true,
                  )
                }
              >
                نعم، سمّعها كاملة بإتقان
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => setFullSurah(null)}
              >
                إلغاء
              </button>
            </div>
          )}
          {!part ? (
            <>
              {data.parts.map((p) => (
                <button
                  className="exam-item exam-open"
                  key={p.number}
                  onClick={() => {
                    setSelected(p.number);
                    setQuestions(emptyQuestions());
                    setConfirmed(false);
                    setNote("");
                    setMessage("");
                  }}
                >
                  <strong>{p.name}</strong>
                  <span>{stateLabels[p.state]}</span>
                  {p.retryOn && (
                    <small>
                      موعد الإعادة: <bdi>{p.retryOn}</bdi>
                      {p.overdue ? " · فات الموعد؛ يراجعه المشرف" : ""}
                    </small>
                  )}
                </button>
              ))}
              {!data.parts.length && !data.surahs.length && (
                <p className="subtle">
                  لا يوجد إتمام جديد يستدعي اختبارًا حاليًا. يعتمد الإتمام على
                  الآيات المتقنة دون تكرار، وليس مجموع صفحات التسميع.
                </p>
              )}
            </>
          ) : (
            <>
              <button className="text-button" onClick={() => setSelected(null)}>
                ← جميع الأجزاء
              </button>
              <h4>{part.name}</h4>
              <p className="subtle">حدود الجزء: {part.text}</p>
              <p className="notice">{stateLabels[part.state]}</p>
              {!part.complete && (
                <p className="notice error">
                  سجل الحفظ الحالي لا يثبت إتمام هذا الجزء؛ يلزم تصحيح السجل قبل
                  الاعتماد.
                </p>
              )}
              {part.pendingSurahs.length > 0 && (
                <p className="notice">
                  يلزم أولًا تسميع السور المكتملة كاملة:{" "}
                  {part.pendingSurahs.map((n) => surahs[n - 1].name).join("، ")}
                  .
                </p>
              )}
              {part.retryOn && (
                <p className="notice">
                  موعد الإعادة: <bdi>{part.retryOn}</bdi>، بعد يومين دراسيين.
                  {part.overdue
                    ? " فات الموعد؛ يعيد المشرف تحديده."
                    : " الإرسال متاح في يوم الإعادة فقط."}
                </p>
              )}
              {!supervisor && part.canSubmit && (
                <form
                  className="stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!confirmed) return;
                    void post(
                      endpoint,
                      {
                        version: data.version,
                        juz: part.number,
                        questions,
                        confirmed: true,
                        requestKey: crypto.randomUUID(),
                      },
                      "أُرسل الاختبار للمشرف. تظهر حالة الاعتماد بعد مراجعته.",
                    );
                  }}
                >
                  <p>
                    اسأل الطالب <strong>3 أسئلة من داخل هذا الجزء فقط</strong>،
                    كل سؤال نحو <strong>7–8 سطور</strong>. سجل عدد الأخطاء لكل
                    سؤال؛ النتيجة تُراجع لدى المشرف.
                  </p>
                  {questions.map((q, i) => (
                    <fieldset className="exam-question" key={i} disabled={busy}>
                      <legend>السؤال {i + 1}</legend>
                      {(
                        [
                          ["prompting", "التلقيني / الفتح", "خصم 2"],
                          ["warning", "التنبيهي", "خصم 1"],
                          ["tajweed", "التجويد", "خصم 0.5"],
                        ] as const
                      ).map(([key, label, cost]) => (
                        <label className="exam-counter" key={key}>
                          <span>
                            {label}
                            <small>{cost} لكل خطأ</small>
                          </span>
                          <input
                            aria-label={`${label} السؤال ${i + 1}`}
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={100}
                            step={1}
                            required
                            value={q[key]}
                            onChange={(e) =>
                              setQuestions((prev) =>
                                prev.map((old, n) =>
                                  n === i
                                    ? { ...old, [key]: Number(e.target.value) }
                                    : old,
                                ),
                              )
                            }
                          />
                        </label>
                      ))}
                    </fieldset>
                  ))}
                  <label className="exam-confirm">
                    <input
                      type="checkbox"
                      required
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                      disabled={busy}
                    />
                    أجريت الأسئلة الثلاثة داخل الجزء وتحققت من أعداد الأخطاء.
                  </label>
                  <button className="primary" disabled={busy || !confirmed}>
                    {busy ? "جارٍ الإرسال…" : "إرسال الاختبار للمشرف"}
                  </button>
                </form>
              )}
              {!supervisor && data.readOnlyReason && (
                <p className="notice">{data.readOnlyReason}</p>
              )}
              {part.attempts.map((a, index) => (
                <article className="exam-item stack" key={a.id}>
                  <strong>
                    المحاولة {a.attempt} · {stateLabels[a.state]}
                  </strong>
                  <small>
                    {a.teacherName} · <bdi>{schoolDate(a.submittedAt)}</bdi>
                  </small>
                  <table className="exam-table">
                    <caption>الأخطاء المسجلة</caption>
                    <thead>
                      <tr>
                        <th>السؤال</th>
                        <th>تلقيني</th>
                        <th>تنبيهي</th>
                        <th>تجويد</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.questions.map((q, i) => (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td>{q.prompting}</td>
                          <td>{q.warning}</td>
                          <td>{q.tajweed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {supervisor && (
                    <p className="exam-score">
                      {a.score} / 100 · {a.rating}
                    </p>
                  )}
                  {a.decidedByName && (
                    <p className="subtle">
                      قرار {a.decidedByName}
                      {a.decisionNote ? ` · ${a.decisionNote}` : ""}
                    </p>
                  )}
                  {supervisor && !!a.actions?.length && (
                    <details>
                      <summary>سجل قرارات الإشراف</summary>
                      {a.actions.map((log, i) => (
                        <p className="subtle" key={i}>
                          {
                            (
                              {
                                APPROVE: "اعتماد",
                                RETRY: "إعادة اختبار",
                                REVOKE: "إلغاء اعتماد",
                                RESCHEDULE: "إعادة تحديد موعد",
                              } as Record<string, string>
                            )[log.action]
                          }{" "}
                          · {log.supervisorName} ·{" "}
                          <bdi>{schoolDate(log.createdAt)}</bdi>
                          {log.note ? ` · ${log.note}` : ""}
                        </p>
                      ))}
                    </details>
                  )}
                  {supervisor && index === 0 && (
                    <div className="stack">
                      <label>
                        ملاحظة القرار أو سبب الإعادة
                        <textarea
                          value={note}
                          maxLength={500}
                          disabled={busy}
                          onChange={(e) => setNote(e.target.value)}
                        />
                      </label>
                      {(["APPROVE", "RETRY", "REVOKE", "RESCHEDULE"] as const)
                        .filter((action) =>
                          action === "APPROVE"
                            ? a.state === "SUBMITTED"
                            : action === "RETRY"
                              ? a.state === "SUBMITTED"
                              : action === "REVOKE"
                                ? a.state === "APPROVED"
                                : part.overdue,
                        )
                        .map((action) => (
                          <button
                            className={
                              action === "APPROVE" ? "primary" : "secondary"
                            }
                            key={action}
                            disabled={
                              busy ||
                              (action === "APPROVE" &&
                                (!a.passed ||
                                  !part.complete ||
                                  !!part.pendingSurahs.length))
                            }
                            onClick={() => {
                              if (
                                action !== "APPROVE" &&
                                note.trim().length < 3
                              ) {
                                setError("اكتب سبب القرار أولًا");
                                return;
                              }
                              void post(
                                `/api/supervisor/exams/${a.id}`,
                                {
                                  version: data.version,
                                  action,
                                  note,
                                  requestKey: crypto.randomUUID(),
                                },
                                action === "APPROVE"
                                  ? "تم اعتماد الاختبار وفتح الانتقال"
                                  : "تم حفظ القرار وتحديد الإعادة بعد يومين دراسيين",
                              );
                            }}
                          >
                            {
                              {
                                APPROVE: "اعتماد الاختبار وفتح الانتقال",
                                RETRY: "إعادة الاختبار بعد يومين دراسيين",
                                REVOKE: "إلغاء الاعتماد وطلب إعادة اختبار",
                                RESCHEDULE:
                                  "إعادة تحديد الموعد بعد يومين دراسيين",
                              }[action]
                            }
                          </button>
                        ))}
                    </div>
                  )}
                </article>
              ))}
            </>
          )}
          {supervisor && data.baselineAllowed && (
            <details className="exam-item">
              <summary>اعتماد المحفوظ السابق · مرة واحدة</summary>
              <p>
                أدخل المحفوظ الذي اعتمدته المدرسة قبل استخدام الموقع. لا يُضاف
                إلى صفحات الإنجاز، والأجزاء المكتملة منه وحده لا تُصدر شهادات أو
                اختبارات جديدة تلقائيًا. راجع المدى جيدًا؛ لا يمكن استبداله بعد
                الاعتماد.
              </p>
              <RangeFields
                title="المحفوظ السابق"
                value={range}
                onChange={setRange}
              />
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  const r = rangeSchema.safeParse(range);
                  if (!r.success) {
                    setError("تحقق من مدى المحفوظ السابق");
                    return;
                  }
                  setRanges((prev) => [...prev, r.data]);
                }}
              >
                إضافة المدى إلى القائمة
              </button>
              <ul>
                {ranges.map((r, i) => (
                  <li key={i}>
                    {rangeText(r)}{" "}
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        setRanges((prev) => prev.filter((_, n) => n !== i))
                      }
                    >
                      حذف المدى
                    </button>
                  </li>
                ))}
              </ul>
              <label>
                مرجع الاعتماد أو ملاحظته
                <textarea
                  value={baselineNote}
                  onChange={(e) => setBaselineNote(e.target.value)}
                  maxLength={500}
                />
              </label>
              <label className="exam-confirm">
                <input
                  type="checkbox"
                  checked={baselineConfirmed}
                  onChange={(e) => setBaselineConfirmed(e.target.checked)}
                />
                راجعت المحفوظ السابق وهو معتمد من المدرسة.
              </label>
              <button
                className="primary"
                disabled={
                  busy ||
                  !ranges.length ||
                  !baselineConfirmed ||
                  baselineNote.trim().length < 3
                }
                onClick={() =>
                  void post(
                    endpoint,
                    {
                      version: data.version,
                      ranges,
                      note: baselineNote,
                      confirmed: true,
                      requestKey: crypto.randomUUID(),
                    },
                    "تم اعتماد المحفوظ السابق دون إضافته لصفحات الإنجاز",
                  )
                }
              >
                اعتماد المحفوظ السابق
              </button>
            </details>
          )}
          {data.baseline && (
            <details className="exam-item">
              <summary>المحفوظ السابق المعتمد</summary>
              <p>
                {data.baseline.supervisorName} ·{" "}
                <bdi>{schoolDate(data.baseline.createdAt)}</bdi>
              </p>
              {data.baseline.ranges.map((r, i) => (
                <p key={i}>{rangeText(r)}</p>
              ))}
              <p>{data.baseline.note}</p>
            </details>
          )}
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void load()}
          >
            تحديث حالة الاختبارات
          </button>
        </>
      )}
    </section>
  );
}
