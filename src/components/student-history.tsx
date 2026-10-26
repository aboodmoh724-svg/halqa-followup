"use client";
import { useEffect, useState } from "react";
import {
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  History,
  RotateCcw,
} from "lucide-react";
import type { StudentHistory as HistoryView } from "@/lib/student-history";
import { assessmentLabels, labels, type Assessment } from "@/lib/types";
import {
  entryPages,
  formatPages,
  rangeDescription,
  rangeText,
  totalPages,
} from "@/lib/quran";

const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("ar", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value + "T00:00:00Z"));
function shift(value: string, amount: number) {
  const d = new Date(value + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}
const result = (value: string | null) =>
  value
    ? assessmentLabels[value as Assessment] || "نتيجة سابقة"
    : "لم تُسجل النتيجة";

export default function StudentHistory({
  halqaId,
  enrollmentId,
  today,
}: {
  halqaId: string;
  enrollmentId: string;
  today: string;
}) {
  const [tab, setTab] = useState<"overview" | "week" | "all">("overview");
  const [weekEnd, setWeekEnd] = useState(today);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [kind, setKind] = useState("ALL");
  const [cursor, setCursor] = useState<string | undefined>();
  const [data, setData] = useState<HistoryView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const params = new URLSearchParams();
  if (tab === "week") {
    params.set("from", shift(weekEnd, -6));
    params.set("to", weekEnd);
  }
  if (tab === "all") {
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("kind", kind);
  }
  if (cursor) params.set("before", cursor);
  const query = params.toString();
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/halqas/${halqaId}/students/${enrollmentId}/history?${query}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (r) => {
        const payload = await r.json();
        if (!r.ok) throw Error(payload.error || "تعذر فتح السجل");
        return payload as HistoryView;
      })
      .then((payload) => {
        if (!controller.signal.aborted)
          setData((previous) =>
            cursor && previous
              ? {
                  ...payload,
                  days: [
                    ...previous.days,
                    ...payload.days.filter(
                      (d) => !previous.days.some((p) => p.date === d.date),
                    ),
                  ],
                }
              : payload,
          );
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [halqaId, enrollmentId, query, cursor, retry]);
  function reset() {
    setLoading(true);
    setError("");
    setCursor(undefined);
    setData(null);
  }
  const s = data?.summary;
  return (
    <section className="student-history" aria-label="سجل الطالب">
      <div className="history-heading">
        <div>
          <p className="eyebrow">نظرة على رحلة الطالب</p>
          <h2>سجل الطالب</h2>
        </div>
        <History size={23} aria-hidden="true" />
      </div>
      <div className="history-tabs" aria-label="طريقة عرض السجل">
        {(
          [
            ["overview", "نظرة سريعة"],
            ["week", "أسبوع"],
            ["all", "السجل الكامل"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            aria-pressed={tab === value}
            onClick={() => {
              if (tab === value) return;
              reset();
              setTab(value);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "week" && (
        <div className="week-picker">
          <button
            aria-label="الأسبوع السابق"
            onClick={() => {
              reset();
              setWeekEnd(shift(weekEnd, -7));
            }}
          >
            <ChevronRight size={18} />
          </button>
          <div>
            <strong>{dateLabel(shift(weekEnd, -6))}</strong>
            <span>إلى {dateLabel(weekEnd)}</span>
          </div>
          <button
            aria-label="الأسبوع التالي"
            disabled={weekEnd >= today}
            onClick={() => {
              reset();
              setWeekEnd(shift(weekEnd, 7) > today ? today : shift(weekEnd, 7));
            }}
          >
            <ChevronLeft size={18} />
          </button>
        </div>
      )}
      {tab === "all" && (
        <div className="history-filters">
          <label>
            من تاريخ
            <input
              type="date"
              value={from}
              max={to || today}
              onChange={(e) => {
                reset();
                setFrom(e.target.value);
              }}
            />
          </label>
          <label>
            إلى تاريخ
            <input
              type="date"
              value={to}
              min={from}
              max={today}
              onChange={(e) => {
                reset();
                setTo(e.target.value);
              }}
            />
          </label>
          <label className="full-width">
            نوع التسميع
            <select
              value={kind}
              onChange={(e) => {
                reset();
                setKind(e.target.value);
              }}
            >
              <option value="ALL">الحفظ والمراجعة</option>
              <option value="MEMORIZATION">الحفظ الجديد</option>
              <option value="REVIEW">المراجعة</option>
            </select>
          </label>
        </div>
      )}
      {error && (
        <div role="alert" className="notice error">
          <p>{error}</p>
          <button
            className="text-button"
            onClick={() => {
              setLoading(true);
              setError("");
              setRetry((v) => v + 1);
            }}
          >
            إعادة المحاولة
          </button>
        </div>
      )}
      {loading && !data && (
        <p role="status" className="history-empty">
          جارٍ فتح سجل الطالب…
        </p>
      )}
      {data && s && (
        <>
          {tab === "overview" && (
            <>
              <article className="record-position">
                <div className="record-icon">
                  <BookOpen size={22} aria-hidden="true" />
                </div>
                <div>
                  <p className="eyebrow">آخر تسميع مسجل</p>
                  {data.latest ? (
                    <>
                      <h3>{rangeText(data.latest.entry)}</h3>
                      <p className="subtle">
                        {data.latest.entry.kind === "MEMORIZATION"
                          ? "حفظ جديد"
                          : "مراجعة"}{" "}
                        · {dateLabel(data.latest.date)} ·{" "}
                        {result(data.latest.entry.assessment || null)}
                      </p>
                    </>
                  ) : (
                    <p>لم يُسجل تسميع لهذا الطالب بعد.</p>
                  )}
                </div>
              </article>
              <article className="record-homework">
                <h3>
                  <CalendarDays size={18} aria-hidden="true" /> الواجب القادم
                </h3>
                {data.upcoming ? (
                  <>
                    <p className="subtle">{dateLabel(data.upcoming.dueDate)}</p>
                    {!data.reviewOnly && (
                      <p>
                        الحفظ: {rangeDescription(data.upcoming.memorization)}
                      </p>
                    )}
                    <p>المراجعة: {rangeDescription(data.upcoming.review)}</p>
                    {data.upcoming.note && (
                      <p className="record-note">{data.upcoming.note}</p>
                    )}
                  </>
                ) : (
                  <p className="subtle">لا يوجد واجب قادم مسجل.</p>
                )}
              </article>
            </>
          )}
          <div className="record-stats" aria-label="نتائج الأيام المسجلة">
            <div>
              <strong>{s.masteredDays}</strong>
              <span>حافظ</span>
            </div>
            <div>
              <strong>{s.notMasteredDays}</strong>
              <span>غير حافظ</span>
            </div>
            <div>
              <strong>{s.absentDays}</strong>
              <span>غائب</span>
            </div>
          </div>
          <p className="record-caption">
            {s.recordedDays} أيام لها بيانات
            {s.pendingDays > 0 ? ` · ${s.pendingDays} دون نتيجة نهائية` : ""}.
            الأيام غير المسجلة لا تُحسب غيابًا.
          </p>
          <div className="record-totals">
            <h3>مجموع التسميع المسجل</h3>
            <div>
              <span>
                <BookOpen size={17} aria-hidden="true" /> الحفظ الجديد
              </span>
              <strong>
                {formatPages(s.memorizationPages)} <small>صفحة</small>
              </strong>
            </div>
            <div>
              <span>
                <RotateCcw size={17} aria-hidden="true" /> المراجعة
              </span>
              <strong>
                {formatPages(s.reviewPages)} <small>صفحة</small>
              </strong>
            </div>
            <p className="subtle">
              منه موسوم حافظ عند التسميع: حفظ{" "}
              {formatPages(s.masteredMemorizationPages)}، مراجعة{" "}
              {formatPages(s.masteredReviewPages)} صفحة.
            </p>
            <p className="record-caption">
              تُجمع المحاولات المتكررة كنشاط. هذا المقدار ليس عدد صفحات فريدة أو
              اعتمادًا لشهادة.
            </p>
          </div>
          <div className="history-section-title">
            <h3>{tab === "overview" ? "آخر الأيام" : "تفاصيل الأيام"}</h3>
            <span className="subtle">الأحدث أولًا</span>
          </div>
          {!data.days.length && (
            <div className="history-empty">
              <History size={26} aria-hidden="true" />
              <h3>لا توجد سجلات في هذه الفترة</h3>
              <p>ستظهر هنا التسميعات والنتائج والملاحظات بعد تسجيلها.</p>
            </div>
          )}
          <div className="record-timeline">
            {(tab === "overview" ? data.days.slice(0, 5) : data.days).map(
              (day) => (
                <details className="record-day" key={day.date}>
                  <summary>
                    <div>
                      <strong>{dateLabel(day.date)}</strong>
                      <span className="subtle">
                        {day.entries.length} تسميعات ·{" "}
                        {formatPages(totalPages(day.entries))} صفحة
                      </span>
                    </div>
                    <span className={`badge ${day.outcome || ""}`}>
                      {day.outcome ? labels[day.outcome] : "غير مكتمل"}
                    </span>
                  </summary>
                  <div className="record-day-body">
                    <p className="subtle">
                      {day.closed
                        ? "يوم مغلق"
                        : "النتيجة قابلة للتحديث من تسجيل اليوم"}
                      {day.reviewOnly ? " · مسار مراجعة فقط في هذا اليوم" : ""}
                    </p>
                    {day.outcome !== "ABSENT" && (
                      <div className="record-results">
                        {!day.reviewOnly && (
                          <span>
                            الحفظ: <b>{result(day.memorizationResult)}</b>
                          </span>
                        )}
                        <span>
                          المراجعة: <b>{result(day.reviewResult)}</b>
                        </span>
                      </div>
                    )}
                    {day.outcome &&
                      day.outcome !== "ABSENT" &&
                      !day.memorizationResult &&
                      !day.reviewResult && (
                        <p className="record-caption">
                          نتيجة يومية سابقة؛ لم تُسجل نتائج مستقلة للحفظ
                          والمراجعة آنذاك.
                        </p>
                      )}
                    {day.note && <p className="record-note">{day.note}</p>}
                    {day.entries.map((entry) => (
                      <article className="record-entry" key={entry.id}>
                        <p className="eyebrow">
                          {entry.kind === "MEMORIZATION"
                            ? "حفظ جديد"
                            : "مراجعة"}{" "}
                          · {formatPages(entryPages(entry))} صفحة
                        </p>
                        <p>{rangeText(entry)}</p>
                        <span className="subtle">
                          {new Intl.DateTimeFormat("ar", {
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone: "Europe/Istanbul",
                          }).format(new Date(entry.createdAt))}{" "}
                          · {result(entry.assessment || null)}
                        </span>
                      </article>
                    ))}
                    {!day.entries.length && (
                      <p className="subtle">
                        لا يوجد تسميع مسجل
                        {kind !== "ALL" && tab === "all" ? " من هذا النوع" : ""}
                        .
                      </p>
                    )}
                    {day.assignment && (
                      <div className="record-homework">
                        <h4>واجب هذا اليوم · للرجوع إليه</h4>
                        {!day.reviewOnly && (
                          <p>
                            الحفظ:{" "}
                            {rangeDescription(day.assignment.memorization)}
                          </p>
                        )}
                        <p>
                          المراجعة: {rangeDescription(day.assignment.review)}
                        </p>
                        {day.assignment.note && (
                          <p className="subtle">{day.assignment.note}</p>
                        )}
                      </div>
                    )}
                  </div>
                </details>
              ),
            )}
          </div>
          {tab === "overview" && data.days.length > 5 && (
            <button
              className="secondary"
              onClick={() => {
                reset();
                setTab("all");
              }}
            >
              عرض السجل الكامل
            </button>
          )}
          {tab !== "overview" && data.nextBefore && (
            <button
              className="secondary"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                setError("");
                setCursor(data.nextBefore || undefined);
              }}
            >
              {loading ? "جارٍ التحميل…" : "عرض أيام أقدم"}
            </button>
          )}
          <p className="record-caption space">
            السجل المتاح في حلقة {data.halqaName}. لا يُستنتج إتقان جزء أو
            استحقاق شهادة من مجموع التسميع.
          </p>
        </>
      )}
    </section>
  );
}
