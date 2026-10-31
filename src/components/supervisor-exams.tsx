"use client";
import { useCallback, useEffect, useState } from "react";
import type { ExamOverview } from "@/lib/exam-service";
import StudentExams from "./student-exams";
export default function SupervisorExams() {
  const [data, setData] = useState<ExamOverview | null>(null),
    [error, setError] = useState(""),
    [filter, setFilter] = useState("ACTION"),
    [selected, setSelected] = useState<{
      halqaId: string;
      enrollmentId: string;
      part?: number;
    } | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetch("/api/supervisor/exams", {
          cache: "no-store",
          signal,
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      setData(d);
      setError("");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    const c = new AbortController();
    queueMicrotask(() => {
      if (!c.signal.aborted) void load(c.signal);
    });
    const timer = setInterval(() => void load(c.signal), 60000);
    return () => {
      c.abort();
      clearInterval(timer);
    };
  }, [load]);
  return (
    <section className="stack" aria-label="اختبارات الأجزاء واعتماداتها">
      <h2>الاختبارات والاعتمادات</h2>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {selected ? (
        <>
          <button className="text-button" onClick={() => setSelected(null)}>
            ← قائمة الاختبارات
          </button>
          <StudentExams
            key={selected.enrollmentId + ":" + selected.part}
            {...selected}
            initialPart={selected.part}
            supervisor
            onChanged={() => void load()}
          />
        </>
      ) : data ? (
        <>
          <div className="supervision-report-totals">
            <div>
              <strong>{data.summary.ready}</strong>
              <span>ينتظر الاختبار</span>
            </div>
            <div>
              <strong>{data.summary.submitted}</strong>
              <span>ينتظر الاعتماد</span>
            </div>
            <div>
              <strong>{data.summary.retry}</strong>
              <span>إعادة اختبار</span>
            </div>
            <div>
              <strong>{data.summary.approved}</strong>
              <span>معتمد</span>
            </div>
          </div>
          <p className="subtle">
            3 أسئلة داخل الجزء، 7–8 سطور لكل سؤال. الاختبار من 100 والنجاح من
            75. التلقيني 2، التنبيهي 1، والتجويد 0.5 لكل خطأ. الإعادة بعد يومين
            دراسيين؛ الجمعة موعدها الثلاثاء.
          </p>
          <label>
            عرض الحالات
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="ACTION">تحتاج متابعة</option>
              <option value="READY">ينتظر الاختبار</option>
              <option value="SUBMITTED">ينتظر الاعتماد</option>
              <option value="RETRY">الإعادة</option>
              <option value="APPROVED">المعتمدة</option>
              <option value="ALL">جميع الحالات</option>
            </select>
          </label>
          {data.students.flatMap((s) => [
            ...s.parts
              .filter(
                (p) =>
                  filter === "ALL" ||
                  filter === p.state ||
                  (filter === "ACTION" && p.state !== "APPROVED"),
              )
              .map((p) => (
                <button
                  className="exam-item exam-open"
                  key={s.enrollmentId + ":" + p.number}
                  onClick={() =>
                    setSelected({
                      halqaId: s.halqaId,
                      enrollmentId: s.enrollmentId,
                      part: p.number,
                    })
                  }
                >
                  <strong>
                    {s.studentName} · {p.name}
                  </strong>
                  <span>
                    {s.halqaName} · {s.teacherName}
                  </span>
                  <span>
                    {
                      {
                        READY: "أتم الجزء وينتظر الاختبار",
                        SURAH_REVIEW:
                          "يلزم تسميع السور المكتملة كاملة قبل الاختبار",
                        SUBMITTED: "أُرسل الاختبار وينتظر اعتمادك",
                        RETRY: "إعادة اختبار",
                        APPROVED: "معتمد",
                        CHANGED: "تغير دليل الإتمام؛ راجع الاعتماد",
                      }[p.state]
                    }
                  </span>
                  {p.retryOn && (
                    <small>
                      الموعد: <bdi>{p.retryOn}</bdi>
                      {p.overdue ? " · متأخر؛ أعد تحديد الموعد" : ""}
                    </small>
                  )}
                </button>
              )),
            ...(["ACTION", "ALL"].includes(filter) && s.surahs.length
              ? [
                  <button
                    className="exam-item exam-open"
                    key={s.enrollmentId + ":surahs"}
                    onClick={() =>
                      setSelected({
                        halqaId: s.halqaId,
                        enrollmentId: s.enrollmentId,
                      })
                    }
                  >
                    <strong>{s.studentName}</strong>
                    <span>
                      {s.halqaName} · يلزم تسميع السور كاملة:{" "}
                      {s.surahs.map((x) => x.name).join("، ")}
                    </span>
                  </button>,
                ]
              : []),
          ])}
          {!data.students.length && (
            <p className="notice">
              لا توجد اختبارات أو إتمامات موثقة حاليًا. اعتماد المحفوظ السابق
              متاح من الفصل ← الطالب، ولا تُفترض أجزاء مكتملة من مجموع الصفحات.
            </p>
          )}
          <button className="text-button" onClick={() => void load()}>
            تحديث قائمة الاختبارات
          </button>
        </>
      ) : (
        <p>جارٍ قراءة الاختبارات…</p>
      )}
    </section>
  );
}
