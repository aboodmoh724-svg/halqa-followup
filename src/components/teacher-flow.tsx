"use client";
import {
  BookOpen,
  RotateCcw,
  CalendarDays,
  UserRoundX,
  CheckCheck,
  ClipboardList,
  Download,
  History,
} from "lucide-react";
import AcademyLogo from "./academy-logo";
import Sheet, { type Mode } from "./recitation-sheet";
import StudentHistory from "./student-history";
import { dailyWindow } from "@/lib/dates";
import { academyName } from "@/lib/branding";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ayahAmount,
  entryPages,
  totalPages,
  formatPages,
  rangeDescription,
  rangeText,
} from "@/lib/quran";
import {
  reportIssues,
  labels,
  assessmentLabels,
  type Assessment,
  type DayView,
  type Outcome,
  type StudentView,
} from "@/lib/types";
type Teacher = { name: string; halqas: { id: string; name: string }[] };
function studentSearchKey(text: string) {
  return text
    .normalize("NFKC")
    .replace(/[أإآ]/g, "ا")
    .replace(/[ًٌٍَُِّْ\s]/g, "");
}
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
export default function TeacherFlow() {
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [day, setDay] = useState<DayView | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "student" | "summary">("list");
  const [mode, setMode] = useState<Mode | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [remember, setRemember] = useState(true);
  const [studentSearch, setStudentSearch] = useState("");
  const [studentPanel, setStudentPanel] = useState<"today" | "history">(
    "today",
  );
  const [studentFilter, setStudentFilter] = useState("all");
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
      setStudentFilter("all");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (!day) return;
    const refresh = async () => {
      if (busy) return;
      const current = dailyWindow(new Date(), day.timezone);
      if (current.date === day.date && current.writable === !day.readOnlyReason)
        return;
      try {
        const fresh = await api<DayView>(`/api/halqas/${day.halqaId}`);
        setDay(fresh);
        setMode(null);
        if (fresh.date !== day.date) {
          setView("list");
          setSelected(null);
          setStudentSearch("");
        }
      } catch {
        /* The server also enforces the cutoff. */
      }
    };
    const timer = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [day, busy]);
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
      const session = await api<{ role: string }>("/api/login", {
        code,
        remember,
      });
      if (session.role === "SUPERVISOR") {
        window.location.replace("/");
        return;
      }
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
      const updated = await api<DayView>(`/api/halqas/${day.halqaId}`, {
        ...data,
        date: day.date,
      });
      setDay(updated);
      const saved = updated.students.find(
        (s) => s.enrollmentId === data.enrollmentId,
      );
      notify(
        data.kind === "MEMORIZATION" &&
          data.assessment === "NOT_MASTERED" &&
          saved?.tomorrow?.autoMemorizationStatusId
          ? "تم الحفظ وإضافة الدرس غير المحفوظ إلى واجب الغد"
          : "تم الحفظ",
      );
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
          <AcademyLogo size={68} />
          <div>
            <p className="login-eyebrow">متابعة حلقات القرآن الكريم</p>
            <h1>{academyName}</h1>
            <p className="muted small-space">كل يوم، خطوة جديدة مع طلابك.</p>
          </div>
        </div>
        <div className="login-panel">
          <h2>أهلًا بك</h2>
          <p className="login-help">أدخل رمزك الخاص لفتح واجهتك.</p>
          <form className="stack" onSubmit={login}>
            <label htmlFor="code">رمز الدخول</label>
            <input
              id="code"
              className="code"
              autoComplete="off"
              type={showCode ? "text" : "password"}
              inputMode="numeric"
              pattern="([0-9]{4}|[0-9]{6}|[0-9]{8})"
              minLength={4}
              maxLength={8}
              required
              dir="ltr"
              placeholder="— — — —"
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
            <button
              type="button"
              className="text-button"
              aria-pressed={showCode}
              onClick={() => setShowCode((value) => !value)}
            >
              {showCode ? "إخفاء الرمز" : "إظهار الرمز"}
            </button>
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
              {busy ? "جارٍ الدخول…" : "دخول"}
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
          <div className="branded-heading">
            <AcademyLogo size={40} />
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
  const locked = !!day.readOnlyReason;
  const student = day.students.find((s) => s.enrollmentId === selected);
  const index = day.students.findIndex((s) => s.enrollmentId === selected);
  const completed = day.students.filter(
    (s) => !reportIssues(s, !!day.closedAt).length,
  ).length;
  const visibleStudents = day.students
    .map((student, index) => ({ student, index }))
    .filter(({ student }) =>
      studentSearchKey(student.name).includes(studentSearchKey(studentSearch)),
    )
    .filter(
      ({ student }) =>
        studentFilter === "all" ||
        (studentFilter === "absent"
          ? student.outcome === "ABSENT"
          : studentFilter === "complete"
            ? !reportIssues(student, !!day.closedAt).length
            : !!reportIssues(student, !!day.closedAt).length),
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
    setStudentPanel("today");
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
          <div className="student-panel-tabs" aria-label="صفحة الطالب">
            <button
              aria-pressed={studentPanel === "today"}
              onClick={() => setStudentPanel("today")}
            >
              <ClipboardList size={18} aria-hidden="true" /> تسجيل اليوم
            </button>
            <button
              aria-pressed={studentPanel === "history"}
              onClick={() => {
                setMode(null);
                setStudentPanel("history");
              }}
            >
              <History size={18} aria-hidden="true" /> سجل الطالب
            </button>
          </div>
          {studentPanel === "history" ? (
            <StudentHistory
              key={student.enrollmentId}
              halqaId={day.halqaId}
              enrollmentId={student.enrollmentId}
              today={day.date}
            />
          ) : (
            <>
              {student.reviewOnly && (
                <p className="notice">طالب حافظ · مراجعة فقط</p>
              )}
              {locked && (
                <p className="notice closed small-space">
                  {day.readOnlyReason || "تم إنهاء الحلقة لهذا اليوم"}
                </p>
              )}
              <div className="assignment-today">
                <h3>واجب اليوم</h3>
                {!student.reviewOnly && (
                  <p>الحفظ: {rangeDescription(student.today?.memorization)}</p>
                )}
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
                    disabled={busy || locked}
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
              <div
                className="actions"
                style={
                  student.reviewOnly
                    ? { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }
                    : undefined
                }
              >
                <button
                  className="action memory"
                  hidden={student.outcome === "ABSENT" || student.reviewOnly}
                  disabled={busy || locked || student.outcome === "ABSENT"}
                  onClick={() => setMode("memory")}
                >
                  <BookOpen size={21} aria-hidden="true" /> + حفظ جديد
                </button>
                <button
                  className="action"
                  hidden={student.outcome === "ABSENT"}
                  disabled={busy || locked || student.outcome === "ABSENT"}
                  onClick={() => setMode("review")}
                >
                  <RotateCcw size={21} aria-hidden="true" /> + مراجعة
                </button>
                <button
                  className="action assignment"
                  disabled={busy || locked}
                  onClick={() => setMode("assignment")}
                >
                  <CalendarDays size={21} aria-hidden="true" /> + واجب الغد
                </button>
              </div>
              <button
                className="absent"
                disabled={busy || locked}
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
                <details className="entries">
                  <summary>
                    سجل التسميع اليوم ({student.entries.length})
                  </summary>
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
                          · {formatPages(entryPages(e))} صفحة · {ayahAmount(e)}{" "}
                          آية
                          {e.assessment && (
                            <span
                              className={`entry-assessment ${e.assessment}`}
                            >
                              {assessmentLabels[e.assessment as Assessment]}
                            </span>
                          )}
                        </p>
                        <button
                          className="text-button"
                          disabled={busy || locked}
                          onClick={() => {
                            setEditingEntryId(e.id);
                            setMode("edit-entry");
                          }}
                        >
                          تعديل التسميع
                        </button>
                      </article>
                    ))}
                    {!student.entries.length && (
                      <p className="subtle card">لم يسجل تسميع بعد.</p>
                    )}
                  </div>
                </details>
              )}
              {student.outcome !== "ABSENT" && (
                <section className="assessment-summary">
                  <h3>
                    <CheckCheck size={18} aria-hidden="true" />
                    نتائج اليوم
                  </h3>
                  <div
                    className="assessment-summary-grid"
                    style={
                      student.reviewOnly
                        ? { gridTemplateColumns: "1fr" }
                        : undefined
                    }
                  >
                    {(student.reviewOnly
                      ? (["REVIEW"] as const)
                      : (["MEMORIZATION", "REVIEW"] as const)
                    ).map((kind) => {
                      const value =
                        kind === "MEMORIZATION"
                          ? student.memorizationResult
                          : student.reviewResult;
                      return (
                        <button
                          key={kind}
                          className={`assessment-tile ${value || "pending"}`}
                          disabled={busy || locked}
                          onClick={() =>
                            setMode(
                              kind === "MEMORIZATION"
                                ? "memory-result"
                                : "review-result",
                            )
                          }
                        >
                          <span>
                            {kind === "MEMORIZATION"
                              ? "الحفظ الجديد"
                              : "المراجعة"}
                          </span>
                          <strong>
                            {value
                              ? assessmentLabels[value as Assessment]
                              : "لم تُحدد بعد"}
                          </strong>
                          <small>
                            {value
                              ? "تعديل النتيجة دون تسميع جديد"
                              : "حافظ أو غير حافظ"}
                          </small>
                          <small>
                            إجمالي اليوم:{" "}
                            {formatPages(
                              totalPages(
                                student.entries.filter((e) => e.kind === kind),
                              ),
                            )}{" "}
                            صفحة
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
                disabled={busy || locked}
                onClick={() => setMode("note")}
              >
                {student.note ? "تعديل ملاحظة اليوم" : "إضافة ملاحظة اليوم"}
              </button>
              {student.note && <p className="subtle">{student.note}</p>}
              {student.tomorrow && (
                <section className="card small-space">
                  <h3>واجب الغد</h3>
                  {!student.reviewOnly && (
                    <p>
                      الحفظ: {rangeDescription(student.tomorrow.memorization)}
                    </p>
                  )}
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
              {!reportIssues(student, !!day.closedAt).length ? (
                <a className="report-link" href={report(student.enrollmentId)}>
                  تنزيل تقرير الطالب PDF
                </a>
              ) : (
                <p className="subtle report-link">
                  {student.reviewOnly
                    ? "أكمل نتيجة المراجعة وواجب الغد؛ ولنتيجة حافظ سجل التسميع"
                    : "أكمل نتيجتي الحفظ والمراجعة وواجب الغد؛ ولنتيجة حافظ سجل التسميع"}
                  لتفعيل تقرير الطالب.
                </p>
              )}
              {mode && !locked && (
                <Sheet
                  key={`${student.enrollmentId}-${mode}-${mode === "edit-entry" ? editingEntryId : ""}`}
                  mode={mode}
                  entry={
                    mode === "edit-entry"
                      ? student.entries.find((e) => e.id === editingEntryId)
                      : undefined
                  }
                  student={student}
                  busy={busy}
                  onClose={(next) => setMode(next ?? null)}
                  onSave={save}
                  saveError={message?.error ? message.text : null}
                />
              )}
            </>
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
                    ? "أكمل التسجيل"
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
          <section
            className="parent-report-panel space"
            aria-labelledby="parent-report-title"
          >
            <h2 id="parent-report-title">
              <Download size={22} aria-hidden="true" />
              التقرير اليومي لأولياء الأمور
            </h2>
            <p>
              صفحة واحدة لجميع الطلاب: نتائج ومدى الحفظ والمراجعة، مقادير
              الصفحات، الغياب، واجب الغد والملاحظات.
            </p>
            <p className="report-progress" role="status">
              التقارير المكتملة: {completed} من {day.students.length}
            </p>
            <p id="parent-report-help">
              لا يُصدّر التقرير حتى تكتمل نتائج ومدى الحفظ والمراجعة وواجب الغد
              لكل طالب حاضر. الغياب مكتمل حتى دون واجب سابق.
            </p>
            {completed === day.students.length && completed > 0 ? (
              <a
                className="primary parent-report-export"
                href={report()}
                aria-describedby="parent-report-help"
              >
                <Download size={19} aria-hidden="true" />
                تصدير التقرير اليومي لأولياء الأمور (PDF)
              </a>
            ) : (
              <button
                className="primary parent-report-export"
                disabled
                aria-describedby="parent-report-help"
              >
                <Download size={19} aria-hidden="true" />
                تصدير التقرير اليومي لأولياء الأمور (PDF)
              </button>
            )}
          </section>
          {completed < day.students.length && (
            <div className="notice space">
              <p>بقي {day.students.length - completed} تقارير غير مكتملة</p>
              {day.students
                .filter((s) => reportIssues(s, !!day.closedAt).length)
                .map((s) => (
                  <button
                    className="text-button"
                    key={s.enrollmentId}
                    onClick={() => select(s)}
                  >
                    {s.name} ←
                    <span className="block subtle">
                      ينقص: {reportIssues(s, !!day.closedAt).join(" · ")}
                    </span>
                  </button>
                ))}
            </div>
          )}
          {locked || day.closedAt ? (
            <p className="notice closed space">
              {day.readOnlyReason ||
                "تم إنهاء اليوم. يمكنك تصحيح تسجيلات اليوم؛ وعند التعديل يُعاد فتحه لتنهِيه مجددًا."}
            </p>
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
        </>
      ) : (
        <>
          <div className="header">
            <div className="branded-heading">
              <AcademyLogo size={40} />
              <h1>{day.halqaName}</h1>
              <p className="subtle">{dateText}</p>
              <p className="subtle">
                وقت الإدخال: 6 صباحًا – 12 ليلًا · بتوقيت تركيا
              </p>
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
              {day.readOnlyReason ||
                (day.closedAt
                  ? "تم إنهاء اليوم؛ التصحيح متاح خلال وقت التسجيل"
                  : "اختر الطالب وسجّل تسميعه")}
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
          <div className="student-filters" aria-label="تصفية الطلاب">
            {[
              ["all", "الكل"],
              ["pending", "لم يكتمل"],
              ["complete", "مكتمل"],
              ["absent", "غائب"],
            ].map(([value, label]) => (
              <button
                key={value}
                aria-pressed={studentFilter === value}
                onClick={() => setStudentFilter(value)}
              >
                {label}
              </button>
            ))}
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
                  {s.reviewOnly && (
                    <span className="subtle block">حافظ · مراجعة فقط</span>
                  )}
                  <span className="subtle block">
                    {s.entries.length
                      ? `${s.entries.length} تسميع اليوم`
                      : "لا يوجد تسميع اليوم"}
                  </span>
                </span>
                <span className="student-result-label">
                  {s.outcome === "ABSENT" ? (
                    "غائب"
                  ) : s.reviewOnly ? (
                    `مراجعة: ${s.reviewResult ? assessmentLabels[s.reviewResult as Assessment] : "بانتظار التسجيل"}`
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
              لا يوجد طلاب مطابقون للبحث والتصفية الحالية.
            </p>
          )}
          <button
            className="secondary report-shortcut small-space"
            disabled={loading || busy}
            onClick={() => setView("summary")}
          >
            <Download size={20} aria-hidden="true" />
            <span>
              التقرير اليومي لأولياء الأمور
              <small>
                {completed} من {day.students.length} تقارير مكتملة
              </small>
            </span>
          </button>
          <details className="card teacher-guide small-space">
            <summary>دليل المعلم · طريقة المتابعة اليومية</summary>
            <p className="subtle">
              كل يوم من 6 صباحًا حتى منتصف الليل. يبدأ تقرير جديد دون حذف
              التقارير السابقة، ويظهر واجب الغد في واجب اليوم.
            </p>
            <ol>
              <li>
                اختر الطالب، وسجّل مدى الحفظ والمراجعة ونتيجة كل منهما: حافظ أو
                غير حافظ.
              </li>
              <li>
                يمكنك إضافة تسميع آخر في اليوم نفسه. يُعرف اتجاه السور تلقائيًا
                عند القراءة من الناس باتجاه البقرة أو بالعكس. لتصحيح السورة
                والآيات، اضغط «تعديل التسميع» تحت التسجيل. ولتصحيح النتيجة فقط،
                استخدم بطاقة نتائج اليوم؛ لا تُضاف صفحات جديدة.
              </li>
              <li>
                إذا كان الطالب غير حافظ للدرس الجديد، يُضاف الدرس تلقائيًا إلى
                واجب الغد، ويمكنك تعديل الواجب.
              </li>
              <li>
                للغياب زر واحد؛ ينقل واجب اليوم إلى الغد إن وُجد، ولا يطلب
                واجبًا إذا لم يوجد. ويمكن إلغاء الغياب عند حضور الطالب.
              </li>
              <li>
                راجع واجب الغد لكل طالب. يوضح زر تقرير أولياء الأمور ما ينقص،
                ويتيح تنزيل PDF بعد اكتمال جميع التقارير.
              </li>
              <li>
                أنه اليوم بعد المراجعة النهائية؛ إنهاء اليوم يُغلق التعديل عليه.
              </li>
            </ol>
          </details>
          <div className="home-footer">
            <button
              className="primary"
              disabled={loading || busy}
              onClick={() => setView("summary")}
            >
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
