"use client";
import { useState, type FormEvent } from "react";
import { ClipboardList, Download } from "lucide-react";
import type { SupervisionReport } from "@/lib/supervision-report";
import { reportTitles, reportPeriod } from "@/lib/supervision-report-policy";
import { reportNumber as formatPages } from "@/lib/report-format";
import { reportDataNotice } from "@/lib/report-data-notice";
type ClassOption = {
  id: string;
  name: string;
  students: { id: string; name: string }[];
};
export default function SupervisionReports({
  today,
  classes,
  onStudent,
}: {
  today: string;
  classes: ClassOption[];
  onStudent: (h: string, s: string) => void;
}) {
  const [type, setType] = useState<keyof typeof reportTitles>("comprehensive"),
    [preset, setPreset] = useState("previous-week"),
    [dates, setDates] = useState(() => reportPeriod("previous-week", today)),
    [halqaId, setHalqaId] = useState(""),
    [enrollmentId, setEnrollmentId] = useState("");
  const [snapshot, setSnapshot] = useState<{
      query: string;
      data: SupervisionReport;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [shown, setShown] = useState(20);
  const params = new URLSearchParams({
    type,
    from: dates.from,
    to: dates.to,
  });
  if (halqaId && type !== "comprehensive") params.set("halqaId", halqaId);
  if (type === "student" && enrollmentId)
    params.set("enrollmentId", enrollmentId);
  const query = params.toString(),
    data = snapshot?.query === query ? snapshot.data : null;
  async function preview(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (type === "support" && dates.to > today)
        throw Error(
          "الأسبوع لم يكتمل؛ اختر أسبوعًا سابقًا من الاثنين إلى الجمعة",
        );
      const r = await fetch(`/api/supervisor/reports?${query}`, {
        cache: "no-store",
      });
      const body = await r.json();
      if (!r.ok) throw Error(body.error || "تعذر إعداد التقرير");
      setSnapshot({ query, data: body });
      setShown(20);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="supervision-reports" aria-label="إصدار تقارير الإشراف">
      <div className="supervisor-heading">
        <div>
          <p className="eyebrow">معاينة ثم تصدير</p>
          <h2>إصدار تقرير</h2>
        </div>
        <ClipboardList size={25} />
      </div>
      <form className="supervisor-report stack" onSubmit={preview}>
        <label>
          ١. نوع التقرير
          <select
            aria-label="١. نوع التقرير"
            value={type}
            onChange={(e) => {
              const t = e.target.value as keyof typeof reportTitles;
              setType(t);
              if (t === "support") {
                setPreset("previous-week");
                setDates(reportPeriod("previous-week", today));
              }
              setError("");
            }}
          >
            {Object.entries(reportTitles).map(([id, title]) => (
              <option value={id} key={id}>
                {title}
              </option>
            ))}
          </select>
        </label>
        <label>
          ٢. الفترة
          <select
            aria-label="٢. الفترة"
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value);
              if (e.target.value !== "custom")
                setDates(reportPeriod(e.target.value, today));
            }}
          >
            <option
              value="week"
              disabled={
                type === "support" &&
                new Date(
                  reportPeriod("week", today).from + "T00:00:00Z",
                ).getUTCDay() === 1 &&
                new Date(
                  reportPeriod("week", today).from + "T00:00:00Z",
                ).getTime() +
                  4 * 86400000 >
                  Date.parse(today)
              }
            >
              {type === "support"
                ? "هذا الأسبوع (بعد اكتماله)"
                : "هذا الأسبوع حتى اليوم"}
            </option>
            <option value="previous-week">
              الأسبوع السابق (الاثنين إلى الجمعة)
            </option>
            {type !== "support" && (
              <>
                <option value="month">هذا الشهر</option>
                <option value="previous-month">الشهر السابق</option>
              </>
            )}
            <option value="custom">
              {type === "support" ? "اختيار أسبوع آخر" : "فترة مخصصة"}
            </option>
          </select>
        </label>
        {preset === "custom" && (
          <p className="subtle">
            {type === "support"
              ? "اختر يوم الاثنين؛ تُحدد الجمعة تلقائيًا، ولا يُصنف أسبوع لم يكتمل."
              : "اختر فترة لا تتجاوز ٩٣ يومًا."}
          </p>
        )}
        <div className="supervision-date-grid">
          <label>
            من تاريخ
            <input
              required
              type="date"
              max={today}
              min={type === "support" ? "1970-01-05" : undefined}
              step={type === "support" ? 7 : undefined}
              value={dates.from}
              onChange={(e) => {
                setPreset("custom");
                const from = e.target.value;
                if (type === "support" && from) {
                  const friday = new Date(from + "T00:00:00Z");
                  friday.setUTCDate(friday.getUTCDate() + 4);
                  setDates({ from, to: friday.toISOString().slice(0, 10) });
                } else setDates({ ...dates, from });
              }}
            />
          </label>
          <label>
            إلى تاريخ
            <input
              required
              type="date"
              min={dates.from}
              readOnly={type === "support"}
              max={today}
              value={dates.to}
              onChange={(e) => {
                setPreset("custom");
                setDates({ ...dates, to: e.target.value });
              }}
            />
          </label>
        </div>
        {type === "comprehensive" ? (
          <p className="notice">
            ملف PDF واحد: ملخص الفترة ثم جميع الحلقات وطلابها. الأرقام إنجليزية،
            والتقرير الموحد عرضي.
          </p>
        ) : (
          <>
            <label>
              ٣. الحلقة
              <select
                aria-label="٣. الحلقة"
                value={halqaId}
                required={type === "student"}
                onChange={(e) => {
                  setHalqaId(e.target.value);
                  setEnrollmentId("");
                }}
              >
                <option value="">
                  {type === "student" ? "اختر الحلقة" : "جميع الحلقات"}
                </option>
                {classes.map((h) => (
                  <option value={h.id} key={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {type === "student" && (
          <label>
            الطالب
            <select
              aria-label="الطالب"
              required
              value={enrollmentId}
              onChange={(e) => setEnrollmentId(e.target.value)}
            >
              <option value="">اختر الطالب</option>
              {classes
                .find((h) => h.id === halqaId)
                ?.students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        {type === "support" && (
          <p className="notice">
            معيار المدرسة للحفظ الجديد المتقن: أقل من 2 صفحة للأول والثاني، وأقل
            من 5 صفحات للثالث إلى السادس، خلال أسبوع كامل. طلاب المراجعة فقط
            مستبعدون. الغياب وتكرار غير حافظ لهما تنبيهات مستقلة.
          </p>
        )}
        {type === "excellent" && (
          <p className="notice">
            أعلى 3 طلاب في الحفظ الجديد المتقن وأعلى 3 في المراجعة المتقنة من كل
            حلقة، بحسب الصفحات. قائمتان مستقلتان؛ دون شروط نسبة أو غياب.
          </p>
        )}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "جارٍ إعداد المعاينة…" : "معاينة التقرير"}
        </button>
      </form>
      {data && (
        <div className="supervision-preview">
          <div className="supervisor-heading">
            <div>
              <p className="eyebrow">
                {data.query.from} - {data.query.to}
              </p>
              <h3>{data.title}</h3>
            </div>
            <span>{data.summary.students} طالب</span>
          </div>
          {reportDataNotice(data) && (
            <p className="notice report-data-warning" role="status">
              {reportDataNotice(data)}
            </p>
          )}
          <p className="notice">{data.criteria}</p>
          {type === "excellent" ? (
            <div className="supervision-report-totals">
              <div>
                <strong>{data.summary.students}</strong>
                <span>طلاب دون تكرار</span>
              </div>
              <div>
                <strong>{data.classes.length}</strong>
                <span>حلقات</span>
              </div>
              <div>
                <strong>
                  {data.rows.filter((r) => r.memoryRank !== null).length}
                </strong>
                <span>متميزون في الحفظ</span>
              </div>
              <div>
                <strong>
                  {data.rows.filter((r) => r.reviewRank !== null).length}
                </strong>
                <span>متميزون في المراجعة</span>
              </div>
            </div>
          ) : (
            <div className="supervision-report-totals">
              <div>
                <strong>
                  {formatPages(
                    type === "support"
                      ? data.summary.masteredMemoryPages
                      : data.summary.memoryPages,
                  )}
                </strong>
                <span>
                  {type === "support" ? "صفحة حفظ جديد متقن" : "صفحة حفظ مسجلة"}
                </span>
              </div>
              <div>
                <strong>{formatPages(data.summary.reviewPages)}</strong>
                <span>صفحة مراجعة مسجلة</span>
              </div>
              <div>
                <strong>{data.summary.absentDays}</strong>
                <span>حالات غياب يومية</span>
              </div>
              <div>
                <strong>{data.summary.pendingDays}</strong>
                <span>سجلات ناقصة</span>
              </div>
            </div>
          )}
          <a
            className="primary supervision-download"
            href={`/api/supervisor/reports?${snapshot!.query}&format=pdf`}
          >
            <Download size={19} /> تنزيل التقرير PDF
          </a>
          <p className="subtle">
            تُحدّث البيانات عند تنزيل التقرير. الكميات مجموع التسميع المسجل
            المتكرر، ولا تثبت إتمام جزء أو استحقاق شهادة.
          </p>
          {type === "excellent" ? (
            <div className="supervisor-list">
              {data.classes.map((c) => (
                <section className="supervisor-report" key={c.id}>
                  <h3>{c.name}</h3>
                  <p className="subtle">{c.teacherName}</p>
                  {(["memory", "review"] as const).map((kind) => {
                    const winners = data.rows
                      .filter(
                        (r) =>
                          r.halqaId === c.id &&
                          (kind === "memory" ? r.memoryRank : r.reviewRank) !==
                            null,
                      )
                      .sort((a, b) =>
                        kind === "memory"
                          ? a.memoryRank! - b.memoryRank!
                          : a.reviewRank! - b.reviewRank!,
                      );
                    return (
                      <div key={kind}>
                        <h4>
                          {kind === "memory" ? "الأكثر حفظًا" : "الأكثر مراجعة"}
                        </h4>
                        {winners.length ? (
                          <ol>
                            {winners.map((r) => (
                              <li key={r.enrollmentId}>
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    onStudent(
                                      r.historyHalqaId,
                                      r.historyEnrollmentId,
                                    )
                                  }
                                >
                                  {r.name}
                                </button>{" "}
                                ·{" "}
                                {formatPages(
                                  kind === "memory"
                                    ? r.masteredMemoryPages
                                    : r.masteredReviewPages,
                                )}{" "}
                                صفحة
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p className="subtle">
                            لا يوجد إنجاز متقن مسجل لهذا المسار.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </section>
              ))}
            </div>
          ) : (
            <div className="supervisor-list">
              {data.rows.slice(0, shown).map((r) => (
                <article className="supervisor-report" key={r.enrollmentId}>
                  <h3>{r.name}</h3>
                  <p className="subtle">
                    {r.halqaName} ·{" "}
                    {r.reviewOnly ? "مراجعة فقط" : "حفظ ومراجعة"}
                  </p>
                  <p>
                    {r.assessedDays} أيام مقيمة من {r.recordedDays} أيام مسجلة ·
                    غياب {r.absentDays}
                  </p>
                  <p>
                    حافظ: {r.masteredDays} · غير حافظ: {r.notMasteredDays}
                    {r.masteryRate === null ? "" : ` · إتقان ${r.masteryRate}%`}
                  </p>
                  <p>
                    {type === "support" ? (
                      <>
                        الحفظ الجديد المتقن:{" "}
                        {formatPages(r.masteredMemoryPages)} صفحة · الحد
                        الأسبوعي: {r.weeklyMinimumPages} صفحة
                      </>
                    ) : (
                      <>
                        الحفظ: {formatPages(r.memoryPages)} صفحة · المراجعة:{" "}
                        {formatPages(r.reviewPages)} صفحة
                      </>
                    )}
                  </p>
                  {r.reasons.length > 0 && (
                    <p className="notice">{r.reasons.join("؛ ")}</p>
                  )}
                  {r.latestNote && <p>{r.latestNote}</p>}
                  <button
                    className="text-button"
                    onClick={() =>
                      onStudent(r.historyHalqaId, r.historyEnrollmentId)
                    }
                  >
                    فتح سجل الطالب ←
                  </button>
                </article>
              ))}
            </div>
          )}
          {!data.rows.length && (
            <p className="supervisor-empty">
              {type === "support" && data.supportUnassessedCount > 0
                ? "لا توجد حالات مثبتة في تقرير المتابعة، مع وجود طلاب لم تكف بياناتهم للتصنيف."
                : "لا يوجد طلاب مطابقون للشروط في هذه الفترة. يمكنك تغيير الفترة أو شروط التقرير."}
            </p>
          )}
          {type !== "excellent" && shown < data.rows.length && (
            <button
              className="secondary space"
              onClick={() => setShown((n) => n + 20)}
            >
              عرض مزيد من الطلاب ({data.rows.length - shown})
            </button>
          )}
        </div>
      )}
    </section>
  );
}
