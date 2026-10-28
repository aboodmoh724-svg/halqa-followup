"use client";
import { useState, type FormEvent } from "react";
import { ClipboardList, Download, SlidersHorizontal } from "lucide-react";
import type { SupervisionReport } from "@/lib/supervision-report";
import { reportTitles, reportPeriod } from "@/lib/supervision-report-policy";
import { formatPages } from "@/lib/quran";
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
    [preset, setPreset] = useState("week"),
    [dates, setDates] = useState(() => reportPeriod("week", today)),
    [halqaId, setHalqaId] = useState(""),
    [enrollmentId, setEnrollmentId] = useState("");
  const [minDays, setMinDays] = useState("3"),
    [mastery, setMastery] = useState("70"),
    [absenceMin, setAbsenceMin] = useState("3"),
    [maxAbsences, setMaxAbsences] = useState("0");
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
    minDays,
    mastery,
    absenceMin,
    maxAbsences,
  });
  if (halqaId) params.set("halqaId", halqaId);
  if (type === "student" && enrollmentId)
    params.set("enrollmentId", enrollmentId);
  const query = params.toString(),
    data = snapshot?.query === query ? snapshot.data : null;
  async function preview(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
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
              setMastery(t === "excellent" ? "90" : "70");
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
            <option value="week">هذا الأسبوع (من الاثنين)</option>
            <option value="previous-week">الأسبوع السابق</option>
            <option value="month">هذا الشهر</option>
            <option value="previous-month">الشهر السابق</option>
            <option value="custom">فترة مخصصة</option>
          </select>
        </label>
        <div className="supervision-date-grid">
          <label>
            من تاريخ
            <input
              required
              type="date"
              max={today}
              value={dates.from}
              onChange={(e) => {
                setPreset("custom");
                setDates({ ...dates, from: e.target.value });
              }}
            />
          </label>
          <label>
            إلى تاريخ
            <input
              required
              type="date"
              min={dates.from}
              max={today}
              value={dates.to}
              onChange={(e) => {
                setPreset("custom");
                setDates({ ...dates, to: e.target.value });
              }}
            />
          </label>
        </div>
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
        {(type === "support" || type === "excellent") && (
          <fieldset className="supervision-criteria">
            <legend>
              <SlidersHorizontal size={16} /> شروط التقرير المختارة
            </legend>
            <p className="subtle">
              قيم ابتدائية قابلة للتعديل، وليست تصنيفًا مدرسيًا معتمدًا. نسبة
              الإتقان تخص الأيام المقيمة، ولا تقيس مقدار حفظ المصحف.
            </p>
            <label>
              الحد الأدنى للأيام المقيمة
              <input
                type="number"
                min="1"
                max="93"
                required
                value={minDays}
                onChange={(e) => setMinDays(e.target.value)}
              />
            </label>
            <label>
              {type === "support" ? "إتقان أقل من (%)" : "إتقان لا يقل عن (%)"}
              <input
                type="number"
                min="0"
                max="100"
                required
                value={mastery}
                onChange={(e) => setMastery(e.target.value)}
              />
            </label>
            {type === "support" ? (
              <label>
                أو غياب بعدد أيام لا يقل عن
                <input
                  type="number"
                  min="1"
                  max="93"
                  required
                  value={absenceMin}
                  onChange={(e) => setAbsenceMin(e.target.value)}
                />
              </label>
            ) : (
              <label>
                الحد الأعلى لأيام الغياب
                <input
                  type="number"
                  min="0"
                  max="93"
                  required
                  value={maxAbsences}
                  onChange={(e) => setMaxAbsences(e.target.value)}
                />
              </label>
            )}
            <p className="subtle">
              نقص التسجيل وحده لا يجعل الطالب بحاجة للمتابعة. تقرير التميز
              يستبعد السجلات الناقصة، ويقيّم مسار المراجعة فقط وفق المراجعة.
            </p>
          </fieldset>
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
          <p className="notice">{data.criteria}</p>
          <div className="supervision-report-totals">
            <div>
              <strong>{formatPages(data.summary.memoryPages)}</strong>
              <span>صفحة حفظ مسجلة</span>
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
          <div className="supervisor-list">
            {data.rows.slice(0, shown).map((r) => (
              <article className="supervisor-report" key={r.enrollmentId}>
                <h3>{r.name}</h3>
                <p className="subtle">
                  {r.halqaName} · {r.reviewOnly ? "مراجعة فقط" : "حفظ ومراجعة"}
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
                  الحفظ: {formatPages(r.memoryPages)} صفحة · المراجعة:{" "}
                  {formatPages(r.reviewPages)} صفحة
                </p>
                {r.reasons.length > 0 && (
                  <p className="notice">{r.reasons.join("؛ ")}</p>
                )}
                {r.latestNote && <p>{r.latestNote}</p>}
                <button
                  className="text-button"
                  onClick={() => onStudent(r.halqaId, r.enrollmentId)}
                >
                  فتح سجل الطالب ←
                </button>
              </article>
            ))}
          </div>
          {!data.rows.length && (
            <p className="supervisor-empty">
              لا يوجد طلاب مطابقون للشروط في هذه الفترة. يمكنك تغيير الفترة أو
              شروط التقرير.
            </p>
          )}
          {shown < data.rows.length && (
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
