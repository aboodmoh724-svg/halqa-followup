"use client";
import { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  CheckCheck,
  ChevronLeft,
  CircleAlert,
  ClipboardList,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import { academyName } from "@/lib/branding";
import { assessmentLabels, type Assessment } from "@/lib/types";
import type { SupervisorOverview } from "@/lib/supervisor-service";
import StudentHistory from "./student-history";
import SupervisionReports from "./supervision-reports";
type View = SupervisorOverview & { supervisor: { name: string } };
const states: Record<string, string> = {
  "not-started": "لم يبدأ التسجيل",
  progress: "جارٍ التسجيل",
  complete: "اكتمل التسجيل",
  submitted: "أنهى يوم الحلقة",
};
const tabs = [
  { id: "today", label: "اليوم", Icon: CheckCheck },
  { id: "classes", label: "الحلقات", Icon: Users },
  { id: "alerts", label: "التنبيهات", Icon: CircleAlert },
  { id: "reports", label: "التقارير", Icon: ClipboardList },
] as const;
const grade = (value: string | null) =>
  value ? assessmentLabels[value as Assessment] || "نتيجة سابقة" : "لم تُسجل";
export default function SupervisorWorkspace() {
  const [data, setData] = useState<View | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [tab, setTab] = useState<(typeof tabs)[number]["id"]>("today"),
    [classId, setClassId] = useState<string | null>(null),
    [studentId, setStudentId] = useState<string | null>(null),
    [search, setSearch] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetch("/api/supervisor/overview", {
        cache: "no-store",
        signal,
      });
      if (r.status === 401) {
        setData(null);
        return;
      }
      const body = await r.json();
      if (!r.ok) throw Error(body.error || "تعذر تحميل المتابعة");
      setData(body);
      setError("");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const c = new AbortController();
    queueMicrotask(() => {
      if (!c.signal.aborted) void load(c.signal);
    });
    return () => c.abort();
  }, [load]);
  const signedIn = data !== null;
  useEffect(() => {
    if (!signedIn) return;
    const c = new AbortController();
    const refresh = () => void load(c.signal);
    const timer = setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    return () => {
      c.abort();
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [signedIn, load]);
  async function logout() {
    setBusy(true);
    try {
      const r = await fetch("/api/logout", { method: "POST" });
      if (!r.ok) throw Error("تعذر تسجيل الخروج");
      setData(null);
      setClassId(null);
      setStudentId(null);
      window.location.replace("/");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function openClass(id: string) {
    setClassId(id);
    setStudentId(null);
    setSearch("");
    window.scrollTo(0, 0);
  }
  function openStudent(halqaId: string, id: string) {
    setClassId(halqaId);
    setStudentId(id);
    window.scrollTo(0, 0);
  }
  if (loading)
    return (
      <main className="supervisor-shell supervisor-loading" aria-busy="true">
        <ShieldCheck size={32} />
        <p>جارٍ فتح لوحة الإشراف…</p>
      </main>
    );
  if (!data)
    return (
      <main className="supervisor-shell">
        <p role="alert">{error || "انتهت جلسة الإشراف."}</p>
        <a href="/">العودة إلى الدخول</a>
      </main>
    );
  const selectedClass = data.classes.find((h) => h.id === classId),
    student = selectedClass?.students.find((s) => s.id === studentId);
  const date = new Intl.DateTimeFormat("ar", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(data.date + "T00:00:00Z"));
  const classCards = data.classes.filter(
    (h) => !search || `${h.name} ${h.teacherName}`.includes(search),
  );
  const complete = data.classes.reduce((n, h) => n + h.complete, 0);
  return (
    <main className="supervisor-shell">
      <header className="supervisor-top">
        <div>
          <p className="eyebrow">{academyName}</p>
          <h1>إشراف قسم القرآن</h1>
          <p className="subtle">
            أهلًا {data.supervisor.name} · {date}
          </p>
        </div>
        <button
          className="supervisor-icon"
          aria-label="تسجيل خروج الإشراف"
          onClick={logout}
          disabled={busy}
        >
          <LogOut size={21} />
        </button>
      </header>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {selectedClass ? (
        <>
          <button
            className="text-button supervisor-back"
            onClick={() => {
              if (studentId) setStudentId(null);
              else setClassId(null);
            }}
          >
            ← {studentId ? selectedClass.name : "جميع الحلقات"}
          </button>
          <div className="supervisor-heading">
            <div>
              <p className="eyebrow">{selectedClass.teacherName}</p>
              <h2>{student?.name ?? selectedClass.name}</h2>
            </div>
            <BookOpen size={26} />
          </div>
          {student ? (
            <StudentHistory
              key={student.id}
              supervisor
              halqaId={selectedClass.id}
              enrollmentId={student.id}
              today={data.date}
            />
          ) : (
            <>
              <p className="notice">
                {selectedClass.complete} من {selectedClass.students.length}{" "}
                تسجيلًا مكتملًا · {states[selectedClass.state]}
              </p>
              <label className="supervisor-search">
                البحث عن طالب
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="اسم الطالب"
                />
              </label>
              <div className="supervisor-list">
                {selectedClass.students
                  .filter((s) => !search || s.name.includes(search))
                  .map((s) => (
                    <button
                      className="supervisor-student"
                      key={s.id}
                      onClick={() => openStudent(selectedClass.id, s.id)}
                    >
                      <span>
                        <strong>{s.name}</strong>
                        <small>
                          {s.reviewOnly ? "مراجعة فقط" : "حفظ ومراجعة"}
                        </small>
                        <span className="supervisor-student-result">
                          {s.outcome === "ABSENT" ? (
                            "غائب"
                          ) : (
                            <>
                              الحفظ:{" "}
                              {s.reviewOnly
                                ? "مراجعة فقط"
                                : grade(s.memorizationResult)}{" "}
                              · المراجعة: {grade(s.reviewResult)}
                            </>
                          )}
                        </span>
                        {!!s.missing.length && (
                          <small>ينقص: {s.missing.join("، ")}</small>
                        )}
                      </span>
                      <ChevronLeft size={18} />
                    </button>
                  ))}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          {tab === "today" && (
            <>
              <section className="supervisor-intro">
                <p className="eyebrow">متابعة اليوم</p>
                <h2>كيف تسير الحلقات اليوم؟</h2>
                <p>تابع اكتمال التسجيل، وافتح الحلقة أو سجل الطالب للتفاصيل.</p>
                <div className="supervisor-totals">
                  <div>
                    <strong>
                      {complete}
                      <small> / {data.totalStudents}</small>
                    </strong>
                    <span>طالب اكتمل تسجيله</span>
                  </div>
                  <div>
                    <strong>
                      {
                        data.classes.filter((h) => h.state === "not-started")
                          .length
                      }
                    </strong>
                    <span>حلقات لم تبدأ</span>
                  </div>
                </div>
              </section>
              {data.alerts.length > 0 && (
                <button
                  className="supervisor-alert-summary"
                  onClick={() => setTab("alerts")}
                >
                  <CircleAlert size={22} />
                  <span>
                    <strong>{data.alerts.length} حالات تحتاج متابعة</strong>
                    <small>الغياب المتكرر ونتائج الطلاب ونقص التسجيل</small>
                  </span>
                  <ChevronLeft size={19} />
                </button>
              )}
              <div className="supervisor-heading">
                <h2>الحلقات اليوم</h2>
                <button className="text-button" onClick={() => void load()}>
                  <RefreshCw size={16} /> تحديث
                </button>
              </div>
            </>
          )}
          {tab === "classes" && (
            <>
              <div className="supervisor-heading">
                <div>
                  <p className="eyebrow">المعلمون والطلاب</p>
                  <h2>الحلقات</h2>
                </div>
                <span>{data.classes.length} حلقات</span>
              </div>
              <label className="supervisor-search">
                البحث عن حلقة أو معلم
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
            </>
          )}
          {(tab === "today" || tab === "classes") && (
            <div className="supervisor-list">
              {classCards.map((h) => (
                <button
                  className="supervisor-class"
                  key={h.id}
                  onClick={() => openClass(h.id)}
                >
                  <div className="supervisor-class-top">
                    <span>
                      <strong>{h.name}</strong>
                      <small>{h.teacherName}</small>
                    </span>
                    <span className={`supervisor-state ${h.state}`}>
                      {states[h.state]}
                    </span>
                  </div>
                  <div
                    className="supervisor-progress"
                    role="progressbar"
                    aria-label={`اكتمال تسجيل ${h.name}`}
                    aria-valuemin={0}
                    aria-valuemax={h.students.length}
                    aria-valuenow={h.complete}
                  >
                    <span
                      style={{
                        width: `${h.students.length ? (h.complete / h.students.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <div className="supervisor-class-bottom">
                    <span>
                      {h.complete} من {h.students.length} مكتمل · بدأ تسجيل{" "}
                      {h.recorded}
                    </span>
                    <ChevronLeft size={18} />
                  </div>
                </button>
              ))}
              {!classCards.length && (
                <p className="notice">لا توجد حلقات مطابقة.</p>
              )}
            </div>
          )}
          {tab === "alerts" && (
            <>
              <div className="supervisor-heading">
                <div>
                  <p className="eyebrow">أولوية المتابعة</p>
                  <h2>تنبيهات الطلاب</h2>
                </div>
                <CircleAlert size={24} />
              </div>
              <p className="subtle">
                التكرار محسوب على آخر أيام الطالب المسجلة خلال ٣٠ يومًا؛ الأيام
                بلا تسجيل لا تُعد غيابًا. هذه مؤشرات للمتابعة وليست حكمًا على
                مستوى الطالب.
              </p>
              <div className="supervisor-list">
                {data.alerts.map((a) => (
                  <button
                    className="supervisor-alert"
                    key={a.id}
                    onClick={() => openStudent(a.halqaId, a.enrollmentId)}
                  >
                    <span className="supervisor-alert-dot" />
                    <span>
                      <strong>{a.studentName}</strong>
                      <small>{a.halqaName}</small>
                      <p>{a.message}</p>
                      <small>
                        {a.dates.at(-1)} — {a.dates[0]}
                      </small>
                    </span>
                    <ChevronLeft size={18} />
                  </button>
                ))}
                {!data.alerts.length && (
                  <div className="supervisor-empty">
                    <CheckCheck size={32} />
                    <h3>لا توجد حالات متكررة تستدعي التنبيه</h3>
                    <p>تابع اكتمال تسجيل الحلقات من شاشة اليوم.</p>
                  </div>
                )}
              </div>
              <p className="notice">
                تنبيهات الاختبارات والإتمام والاعتمادات ستظهر هنا بعد تفعيل آلية
                الاختبار؛ لا توجد نتائج اختبارات مسجلة في النظام حاليًا.
              </p>
            </>
          )}
          {tab === "reports" && (
            <SupervisionReports
              today={data.date}
              classes={data.classes}
              onStudent={openStudent}
            />
          )}
        </>
      )}
      <nav className="supervisor-nav" aria-label="أقسام الإشراف">
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            aria-current={!classId && tab === id ? "page" : undefined}
            onClick={() => {
              setTab(id);
              setClassId(null);
              setStudentId(null);
              setSearch("");
              window.scrollTo(0, 0);
            }}
          >
            <Icon size={21} />
            <span>{label}</span>
            {id === "alerts" && data.alerts.length > 0 && (
              <i>{data.alerts.length}</i>
            )}
          </button>
        ))}
      </nav>
    </main>
  );
}
