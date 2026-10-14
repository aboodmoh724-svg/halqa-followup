"use client";
import {
  BookOpen,
  RotateCcw,
  CalendarDays,
  UserRoundX,
  CheckCheck,
  ClipboardList,
} from "lucide-react";
import { academyName } from "@/lib/branding";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ayahAmount,
  entryPages,
  totalPages,
  formatPages,
  amountText,
  rangeDescription,
  rangeSchema,
  rangeText,
  surahs,
  type QuranRange,
} from "@/lib/quran";
import {
  labels,
  assessmentLabels,
  type Assessment,
  type DayView,
  type Outcome,
  type StudentView,
} from "@/lib/types";
type Teacher = { name: string; halqas: { id: string; name: string }[] };
type Mode = "memory" | "review" | "assignment" | "absent" | "note";
function studentSearchKey(text: string) {
  return text
    .normalize("NFKC")
    .replace(/[أإآ]/g, "ا")
    .replace(/[ًٌٍَُِّْ\s]/g, "");
}
const initialRange: QuranRange = {
  startSurah: 1,
  startAyah: 1,
  endSurah: 1,
  endAyah: 7,
};
async function api<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    cache: "no-store",
    ...(body !== undefined
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "تعذر الاتصال. حاول مرة أخرى");
  return data;
}
function Badge({ outcome }: { outcome: Outcome | null }) {
  return (
    <span className={`badge ${outcome || ""}`}>
      {outcome ? labels[outcome] : "بانتظار النتيجة"}
    </span>
  );
}
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
      {rangeSchema.safeParse(value).success && (
        <p className="range-amount" aria-live="polite">
          المقدار: {amountText(value)}
        </p>
      )}
    </fieldset>
  );
}
function Sheet({
  mode,
  student,
  busy,
  onClose,
  onSave,
  saveError,
}: {
  saveError: string | null;
  mode: Mode;
  student: StudentView;
  busy: boolean;
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => Promise<boolean>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [range, setRange] = useState(
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
  const [assessment, setAssessment] = useState<Assessment | "">("");
  const [recited, setRecited] = useState(true);
  const [carry, setCarry] = useState(true);
  const [error, setError] = useState("");
  const requestKey = useRef<string>("");
  useEffect(() => {
    dialog.current?.showModal();
    requestKey.current = crypto.randomUUID();
  }, []);
  const titles = {
    memory: "إضافة حفظ جديد",
    review: "إضافة مراجعة",
    assignment: "واجب الغد",
    absent: "تسجيل الغياب",
    note: "ملاحظة اليوم",
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    let data: Record<string, unknown>;
    if (mode === "memory" || mode === "review") {
      if (!assessment) {
        setError("اختر نتيجة التسميع أولًا");
        return;
      }
      if (
        !recited &&
        assessment === "MASTERED" &&
        !student.entries.some(
          (e) => e.kind === (mode === "memory" ? "MEMORIZATION" : "REVIEW"),
        )
      ) {
        setError("لتسجيل الإتقان، أدخل الآيات التي سمعها الطالب");
        return;
      }
      if (!recited || assessment === "NOT_REQUIRED") {
        if (
          await onSave({
            action: "assessment",
            kind: mode === "memory" ? "MEMORIZATION" : "REVIEW",
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
        kind: mode === "memory" ? "MEMORIZATION" : "REVIEW",
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
    } else
      data = {
        action: "status",
        outcome: mode === "absent" ? "ABSENT" : student.outcome,
        note,
        carry: mode === "absent" && carry,
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
            onClick={onClose}
            aria-label="إغلاق"
          >
            ×
          </button>
        </div>
        {(mode === "memory" || mode === "review") && (
          <>
            <p className="notice">
              {student.today?.[mode === "review" ? "review" : "memorization"]
                ? "تم تعبئة واجب اليوم. عدّل المدى حسب التسميع الفعلي."
                : "حدد ما سمعه الطالب في هذه المرة."}
            </p>
            <fieldset className="assessment-picker">
              <legend>نتيجة {mode === "memory" ? "الحفظ" : "المراجعة"}</legend>
              <div className="assessment-options">
                {(["MASTERED", "NOT_MASTERED", "NOT_REQUIRED"] as const).map(
                  (value) => (
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
                  ),
                )}
              </div>
            </fieldset>
            {assessment !== "NOT_REQUIRED" && (
              <>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={recited}
                    onChange={(e) => setRecited(e.target.checked)}
                  />
                  سمّع الطالب آيات اليوم
                </label>
                {recited ? (
                  <RangeFields
                    title="مدى التسميع"
                    value={range}
                    onChange={setRange}
                  />
                ) : (
                  <p className="notice">
                    تُحفظ النتيجة فقط، دون إضافة آيات أو صفحات لم يسمعها المعلم.
                  </p>
                )}
              </>
            )}
          </>
        )}
        {mode === "assignment" && (
          <>
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
            <label className="check">
              <input
                type="checkbox"
                checked={carry}
                onChange={(e) => setCarry(e.target.checked)}
              />
              نقل واجب اليوم للغد
            </label>
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
            : mode === "memory" || mode === "review"
              ? "حفظ التسجيل"
              : "حفظ"}
        </button>
      </form>
    </dialog>
  );
}
export default function TeacherFlow() {
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [day, setDay] = useState<DayView | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "student" | "summary">("list");
  const [mode, setMode] = useState<Mode | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(true);
  const [studentSearch, setStudentSearch] = useState("");
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view, selected]);
  const [message, setMessage] = useState<{
    text: string;
    error: boolean;
  } | null>(null);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function notify(text: string, error = false) {
    setMessage({ text, error });
    if (messageTimer.current) clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(null), 6000);
  }
  async function loadHalqa(id: string) {
    setLoading(true);
    try {
      const data = await api<DayView>(`/api/halqas/${id}`);
      setDay(data);
      setView("list");
      setSelected(null);
      setStudentSearch("");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setLoading(false);
    }
  }
  async function bootstrap() {
    try {
      const r = await fetch("/api/halqas", { cache: "no-store" });
      if (r.status === 401) {
        setTeacher(null);
        return;
      }
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setTeacher(data);
      if (data.halqas.length === 1) await loadHalqa(data.halqas[0].id);
    } catch (e) {
      setLoginError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/halqas", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) return null;
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        return data as Teacher;
      })
      .then(async (data) => {
        setTeacher(data);
        if (data?.halqas.length === 1) await loadHalqa(data.halqas[0].id);
      })
      .catch((error) => {
        if (error.name !== "AbortError") setLoginError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      if (messageTimer.current) clearTimeout(messageTimer.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function login(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLoginError("");
    try {
      await api("/api/login", { code, remember });
      setCode("");
      await bootstrap();
    } catch (e) {
      setLoginError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      await api("/api/logout", {});
      setTeacher(null);
      setDay(null);
      setView("list");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function save(data: Record<string, unknown>): Promise<boolean> {
    if (!day) return false;
    setBusy(true);
    try {
      setDay(
        await api<DayView>(`/api/halqas/${day.halqaId}`, {
          ...data,
          date: day.date,
        }),
      );
      notify("تم الحفظ");
      return true;
    } catch (e) {
      notify((e as Error).message, true);
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (loading && !teacher)
    return (
      <main className="shell login" aria-busy="true">
        <h1>{academyName}</h1>
        <p className="muted">جارٍ فتح الحلقة…</p>
      </main>
    );
  if (!teacher)
    return (
      <main className="shell login login-welcome">
        <div className="login-intro">
          <div className="mark" aria-hidden="true">
            ۞
          </div>
          <div>
            <p className="login-eyebrow">متابعة حلقات القرآن الكريم</p>
            <h1>{academyName}</h1>
            <p className="muted small-space">كل يوم، خطوة جديدة مع طلابك.</p>
          </div>
        </div>
        <div className="login-panel">
          <h2>أهلًا بك، معلمنا</h2>
          <p className="login-help">أدخل رمزك الخاص لفتح حلقتك.</p>
          <form className="stack" onSubmit={login}>
            <label htmlFor="code">رمز المعلم</label>
            <input
              id="code"
              className="code"
              autoComplete="off"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              required
              dir="ltr"
              placeholder="— — — — — —"
              value={code}
              onChange={(e) =>
                setCode(
                  e.target.value
                    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632))
                    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 1776))
                    .replace(/\D/g, ""),
                )
              }
            />
            <label className="check">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              تذكرني على هذا الجهاز
            </label>
            {loginError && (
              <p className="notice error" role="alert">
                {loginError}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy ? "جارٍ الدخول…" : "الدخول إلى الحلقة"}
            </button>
          </form>
          <p className="subtle">رمزك خاص بك. لا تشاركه مع الآخرين.</p>
        </div>
        <p className="login-footer">حفظٌ متقن · متابعةٌ أيسر</p>
      </main>
    );
  if (!day)
    return (
      <main className="shell">
        <div className="header">
          <div>
            <h1>أهلًا، {teacher.name}</h1>
            <p className="subtle">اختر الحلقة</p>
          </div>
          <button className="text-button" disabled={busy} onClick={logout}>
            خروج
          </button>
        </div>
        <div className="stack">
          {teacher.halqas.map((h) => (
            <button
              className="student-row"
              disabled={loading}
              key={h.id}
              onClick={() => loadHalqa(h.id)}
            >
              {h.name}
              <span className="chevron">‹</span>
            </button>
          ))}
          {!teacher.halqas.length && (
            <p className="notice">لا توجد حلقة مرتبطة بهذا الرمز.</p>
          )}
        </div>
        {message && (
          <p className={`toast ${message.error ? "error" : ""}`} role="alert">
            {message.text}
          </p>
        )}
      </main>
    );
  const student = day.students.find((s) => s.enrollmentId === selected);
  const index = day.students.findIndex((s) => s.enrollmentId === selected);
  const completed = day.students.filter((s) => s.outcome).length;
  const visibleStudents = day.students
    .map((student, index) => ({ student, index }))
    .filter(({ student }) =>
      studentSearchKey(student.name).includes(studentSearchKey(studentSearch)),
    );
  const total = (kind: "MEMORIZATION" | "REVIEW") =>
    totalPages(
      day.students.flatMap((s) => s.entries).filter((e) => e.kind === kind),
    );
  const dateText = new Intl.DateTimeFormat("ar", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day.date}T00:00:00Z`));
  const report = (id?: string) =>
    `/api/halqas/${day.halqaId}/report?date=${day.date}${id ? `&student=${id}` : ""}`;
  function select(s: StudentView) {
    setSelected(s.enrollmentId);
    setView("student");
    window.scrollTo(0, 0);
  }
  return (
    <main className="shell" aria-busy={loading || busy}>
      {view === "student" && student ? (
        <>
          <div className="header">
            <div>
              <h1>{student.name}</h1>
              <p className="subtle">
                الطالب {index + 1} من {day.students.length}
              </p>
            </div>
            <button
              className="back"
              onClick={() => setView("list")}
              disabled={busy}
            >
              الطلاب ←
            </button>
          </div>
          {day.closedAt && (
            <p className="notice closed small-space">
              تم إنهاء الحلقة لهذا اليوم
            </p>
          )}
          <div className="assignment-today">
            <h3>واجب اليوم</h3>
            <p>الحفظ: {rangeDescription(student.today?.memorization)}</p>
            <p>المراجعة: {rangeDescription(student.today?.review)}</p>
            {student.today?.note && (
              <p className="subtle">{student.today.note}</p>
            )}
          </div>
          <h2 className="section-heading">
            <ClipboardList size={21} aria-hidden="true" />
            تسجيل اليوم
          </h2>
          {student.outcome === "ABSENT" && (
            <div className="absence-banner">
              <UserRoundX aria-hidden="true" />
              <div>
                <strong>الطالب غائب اليوم</strong>
                <p>
                  يمكنك تحديد واجب الغد أو نقل واجب اليوم، وإلغاء الغياب إذا
                  حضر.
                </p>
              </div>
            </div>
          )}
          {student.outcome === "ABSENT" &&
            student.today &&
            !student.tomorrow && (
              <button
                className="secondary"
                disabled={busy || !!day.closedAt}
                onClick={() =>
                  save({
                    action: "status",
                    enrollmentId: student.enrollmentId,
                    outcome: "ABSENT",
                    note: student.note,
                    carry: true,
                  })
                }
              >
                نقل واجب اليوم للغد
              </button>
            )}
          <div className="actions">
            <button
              className="action memory"
              hidden={student.outcome === "ABSENT"}
              disabled={busy || !!day.closedAt || student.outcome === "ABSENT"}
              onClick={() => setMode("memory")}
            >
              <BookOpen size={21} aria-hidden="true" /> + حفظ جديد
            </button>
            <button
              className="action"
              hidden={student.outcome === "ABSENT"}
              disabled={busy || !!day.closedAt || student.outcome === "ABSENT"}
              onClick={() => setMode("review")}
            >
              <RotateCcw size={21} aria-hidden="true" /> + مراجعة
            </button>
            <button
              className="action assignment"
              disabled={busy || !!day.closedAt}
              onClick={() => setMode("assignment")}
            >
              <CalendarDays size={21} aria-hidden="true" /> + واجب الغد
            </button>
          </div>
          <button
            className="absent"
            disabled={busy || !!day.closedAt}
            onClick={() =>
              student.outcome === "ABSENT"
                ? save({
                    action: "status",
                    enrollmentId: student.enrollmentId,
                    outcome: null,
                    note: student.note,
                    carry: false,
                  })
                : setMode("absent")
            }
          >
            {student.outcome === "ABSENT"
              ? "حضر الطالب — إلغاء الغياب"
              : "غائب اليوم"}
          </button>
          {student.outcome !== "ABSENT" && (
            <section className="entries">
              <h3>سجل التسميع اليوم</h3>
              <div className="stack">
                {student.entries.map((e) => (
                  <article key={e.id} className="entry">
                    <div className="entry-top">
                      <span
                        className={`badge ${e.kind === "MEMORIZATION" ? "memory" : ""}`}
                      >
                        {e.kind === "MEMORIZATION" ? "حفظ جديد" : "مراجعة"}
                      </span>
                      <p className="range">{rangeText(e)}</p>
                    </div>
                    <p className="subtle">
                      {new Intl.DateTimeFormat("ar", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: day.timezone,
                      }).format(new Date(e.createdAt))}{" "}
                      · {formatPages(entryPages(e))} صفحة · {ayahAmount(e)} آية
                      {e.assessment && (
                        <span className={`entry-assessment ${e.assessment}`}>
                          {assessmentLabels[e.assessment as Assessment]}
                        </span>
                      )}
                    </p>
                  </article>
                ))}
                {!student.entries.length && (
                  <p className="subtle card">لم يسجل تسميع بعد.</p>
                )}
              </div>
            </section>
          )}
          {student.outcome !== "ABSENT" && (
            <section className="assessment-summary">
              <h3>
                <CheckCheck size={18} aria-hidden="true" />
                نتائج اليوم
              </h3>
              <div className="assessment-summary-grid">
                {(["MEMORIZATION", "REVIEW"] as const).map((kind) => {
                  const value =
                    kind === "MEMORIZATION"
                      ? student.memorizationResult
                      : student.reviewResult;
                  return (
                    <button
                      key={kind}
                      className={`assessment-tile ${value || "pending"}`}
                      disabled={busy || !!day.closedAt}
                      onClick={() =>
                        setMode(kind === "MEMORIZATION" ? "memory" : "review")
                      }
                    >
                      <span>
                        {kind === "MEMORIZATION" ? "الحفظ الجديد" : "المراجعة"}
                      </span>
                      <strong>
                        {value
                          ? assessmentLabels[value as Assessment]
                          : "لم تُحدد بعد"}
                      </strong>
                      <small>
                        {value
                          ? "تحديث النتيجة أو إضافة تسميع"
                          : "حددها أثناء التسجيل"}
                      </small>
                    </button>
                  );
                })}
              </div>
              {!student.memorizationResult &&
                !student.reviewResult &&
                student.outcome && (
                  <p className="subtle">
                    نتيجة سابقة: {labels[student.outcome]}. لم تُسجل نتائج
                    منفصلة آنذاك.
                  </p>
                )}
            </section>
          )}
          <button
            className="text-button small-space"
            disabled={busy || !!day.closedAt}
            onClick={() => setMode("note")}
          >
            {student.note ? "تعديل ملاحظة اليوم" : "إضافة ملاحظة اليوم"}
          </button>
          {student.note && <p className="subtle">{student.note}</p>}
          {student.tomorrow && (
            <section className="card small-space">
              <h3>واجب الغد</h3>
              <p>الحفظ: {rangeDescription(student.tomorrow.memorization)}</p>
              <p>المراجعة: {rangeDescription(student.tomorrow.review)}</p>
              {student.tomorrow.note && (
                <p className="subtle">{student.tomorrow.note}</p>
              )}
            </section>
          )}
          <button
            className="primary bottom-action"
            disabled={busy}
            onClick={() =>
              index < day.students.length - 1
                ? select(day.students[index + 1])
                : setView("list")
            }
          >
            {index < day.students.length - 1
              ? "الطالب التالي"
              : "العودة إلى الطلاب"}
          </button>
          {student.outcome ? (
            <a className="report-link" href={report(student.enrollmentId)}>
              تنزيل تقرير الطالب PDF
            </a>
          ) : (
            <p className="subtle report-link">
              أكمل نتيجتي الحفظ والمراجعة لتفعيل تقرير الطالب.
            </p>
          )}
          {mode && (
            <Sheet
              key={`${student.enrollmentId}-${mode}`}
              mode={mode}
              student={student}
              busy={busy}
              onClose={() => setMode(null)}
              onSave={save}
              saveError={message?.error ? message.text : null}
            />
          )}
        </>
      ) : view === "summary" ? (
        <>
          <div className="header">
            <div>
              <h1>ملخص الحلقة</h1>
              <p className="subtle">
                {day.halqaName} · {dateText}
              </p>
            </div>
            <button className="back" onClick={() => setView("list")}>
              الطلاب ←
            </button>
          </div>
          <div className="summary-grid">
            {(["MEMORIZED", "NOT_MEMORIZED", "ABSENT"] as const).map((o) => (
              <div className="card" key={o}>
                <strong>
                  {day.students.filter((s) => s.outcome === o).length}
                </strong>
                <span>
                  {o === "MEMORIZED"
                    ? "أكمل المطلوب"
                    : o === "NOT_MEMORIZED"
                      ? "يحتاج تثبيتًا"
                      : "غائب"}
                </span>
              </div>
            ))}
          </div>
          <div className="card totals space">
            <div>
              <p className="subtle">إجمالي الحفظ</p>
              <strong>{formatPages(total("MEMORIZATION"))} صفحة</strong>
            </div>
            <div>
              <p className="subtle">إجمالي المراجعة</p>
              <strong>{formatPages(total("REVIEW"))} صفحة</strong>
            </div>
          </div>
          <p className="subtle small-space">
            المقادير تقدير وفق المصحف المدني 604 صفحة، وتُحسب لكل تسميع مسجل.
          </p>
          {completed < day.students.length && (
            <div className="notice space">
              <p>
                بقي {day.students.length - completed} طالب بدون نتيجة نهائية
              </p>
              {day.students
                .filter((s) => !s.outcome)
                .map((s) => (
                  <button
                    className="text-button"
                    key={s.enrollmentId}
                    onClick={() => select(s)}
                  >
                    {s.name} ←
                  </button>
                ))}
            </div>
          )}
          {day.closedAt ? (
            <p className="notice closed space">تم إنهاء اليوم وحفظ النتائج</p>
          ) : (
            <button
              className="primary space"
              disabled={
                busy ||
                completed < day.students.length ||
                day.students.length === 0
              }
              onClick={() => save({ action: "close" })}
            >
              {busy ? "جارٍ الحفظ…" : "إنهاء يوم الحلقة"}
            </button>
          )}
          {completed === day.students.length && completed > 0 ? (
            <a className="secondary space" href={report()}>
              تنزيل PDF الحلقة كاملًا
            </a>
          ) : (
            <p className="subtle space">
              يُتاح تقرير الحلقة بعد تحديد نتيجة كل طالب.
            </p>
          )}
        </>
      ) : (
        <>
          <div className="header">
            <div>
              <h1>{day.halqaName}</h1>
              <p className="subtle">{dateText}</p>
            </div>
            <button className="text-button" disabled={busy} onClick={logout}>
              خروج
            </button>
          </div>
          <div className="card">
            <div className="flex justify-between gap-3">
              <p>متابعة اليوم</p>
              <p className="subtle" dir="ltr">
                {completed} / {day.students.length}
              </p>
            </div>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{
                  width: `${day.students.length ? (completed / day.students.length) * 100 : 0}%`,
                }}
              />
            </div>
            <p className="subtle small-space">
              {day.closedAt ? "تم إنهاء اليوم" : "اختر الطالب وسجّل تسميعه"}
            </p>
          </div>
          <div className="space">
            <label htmlFor="student-search">البحث عن طالب</label>
            <input
              id="student-search"
              type="search"
              placeholder="اكتب اسم الطالب"
              value={studentSearch}
              onChange={(event) => setStudentSearch(event.target.value)}
              maxLength={100}
            />
          </div>
          <div className="stack space">
            {visibleStudents.map(({ student: s, index: i }) => (
              <button
                className="student-row"
                key={s.enrollmentId}
                onClick={() => select(s)}
              >
                <span className="index">{i + 1}</span>
                <span className="name">
                  {s.name}
                  <span className="subtle block">
                    {s.entries.length
                      ? `${s.entries.length} تسميع اليوم`
                      : "لا يوجد تسميع اليوم"}
                  </span>
                </span>
                <span className="student-result-label">
                  {s.outcome === "ABSENT" ? (
                    "غائب"
                  ) : s.memorizationResult || s.reviewResult ? (
                    `حفظ: ${s.memorizationResult ? assessmentLabels[s.memorizationResult as Assessment] : "بانتظار التسجيل"} · مراجعة: ${s.reviewResult ? assessmentLabels[s.reviewResult as Assessment] : "بانتظار التسجيل"}`
                  ) : (
                    <Badge outcome={s.outcome} />
                  )}
                </span>
                <span className="chevron">‹</span>
              </button>
            ))}
          </div>
          {visibleStudents.length === 0 && (
            <p className="notice space">
              لا يوجد طالب بهذا الاسم. جرّب جزءًا آخر من الاسم.
            </p>
          )}
          <div className="home-footer">
            <button className="primary" onClick={() => setView("summary")}>
              ملخص ونهاية الحلقة
            </button>
            {teacher.halqas.length > 1 && (
              <button className="text-button" onClick={() => setDay(null)}>
                اختيار حلقة أخرى
              </button>
            )}
            <button
              className="text-button"
              disabled={loading}
              onClick={() => loadHalqa(day.halqaId)}
            >
              تحديث اليوم
            </button>
          </div>
        </>
      )}
      {message && (
        <p
          role={message.error ? "alert" : "status"}
          className={`toast ${message.error ? "error" : ""}`}
        >
          {message.text}
        </p>
      )}
    </main>
  );
}
