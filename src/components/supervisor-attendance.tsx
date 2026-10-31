"use client";
import { useCallback, useEffect, useState } from "react";
import type { AttendanceOverview } from "@/lib/attendance-service";
import AttendanceClass from "./attendance-class";
import AttendancePractice from "./attendance-practice";
export default function SupervisorAttendance() {
  const [practice, setPractice] = useState(false);
  const [data, setData] = useState<AttendanceOverview | null>(null),
    [date, setDate] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState("");
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const r = await fetch(
          "/api/supervisor/attendance" + (date ? `?date=${date}` : ""),
          { cache: "no-store", signal },
        );
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setData(d);
        setError("");
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      }
    },
    [date],
  );
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
  if (practice) return <AttendancePractice onExit={() => setPractice(false)} />;
  return (
    <section aria-label="متابعة الحضور والغياب" className="stack">
      <h2>الحضور والغياب</h2>
      <button className="secondary" onClick={() => setPractice(true)}>
        تجربة الحضور بأسماء وهمية
      </button>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          {!data.studyDay && (
            <p className="notice">
              هذا اليوم عطلة؛ لا يُطلب من المعلمين إرسال الحضور.
            </p>
          )}
          <label>
            تاريخ الحضور
            <input
              type="date"
              value={date || data.date}
              max={data.today}
              onChange={(e) => {
                setDate(e.target.value);
                setSelected(null);
              }}
            />
          </label>
          {selected ? (
            <>
              <button className="text-button" onClick={() => setSelected(null)}>
                ← جميع الفصول
              </button>
              <AttendanceClass
                key={selected + data.date}
                halqaId={selected}
                date={data.date}
                supervisor
                onSaved={() => void load()}
              />
            </>
          ) : (
            <>
              <div className="supervision-report-totals">
                <div>
                  <strong>{data.summary.present}</strong>
                  <span>حاضر مسجل</span>
                </div>
                <div>
                  <strong>{data.summary.absent}</strong>
                  <span>غائب مسجل</span>
                </div>
                <div>
                  <strong>{data.summary.unknown}</strong>
                  <span>لم يُحدد حضوره</span>
                </div>
                <div>
                  <strong>
                    {data.summary.submitted} / {data.summary.total}
                  </strong>
                  <span>فصول أرسلت الحضور</span>
                </div>
              </div>
              <h3>متابعة الفصول</h3>
              <div className="supervisor-list">
                {data.classes.map((c) => (
                  <button
                    className="supervisor-class-card"
                    key={c.halqaId}
                    onClick={() => setSelected(c.halqaId)}
                  >
                    <strong>{c.name}</strong>
                    <span>{c.teacherName}</span>
                    {c.confirmedAt && (
                      <small>
                        آخر إرسال:{" "}
                        {new Intl.DateTimeFormat("ar", {
                          timeZone: "Europe/Istanbul",
                          hour: "numeric",
                          minute: "2-digit",
                        }).format(new Date(c.confirmedAt))}{" "}
                        · {c.recordedBy}
                      </small>
                    )}
                    <span>
                      {!data.studyDay
                        ? "يوم عطلة"
                        : c.confirmed
                          ? "تم الإرسال"
                          : "لم يُرسل الحضور"}{" "}
                      · غائب {c.absent} · غير محدد {c.unknown}
                    </span>
                  </button>
                ))}
              </div>
              <h3>جميع الغائبين</h3>
              <div className="attendance-absentees">
                {data.classes.flatMap((c) =>
                  c.students
                    .filter((s) => s.state === "ABSENT")
                    .map((s) => (
                      <button
                        className="attendance-row"
                        key={s.id}
                        onClick={() => setSelected(c.halqaId)}
                      >
                        <strong>{s.name}</strong>
                        <span>{c.name}</span>
                      </button>
                    )),
                )}
                {!data.summary.absent && (
                  <p className="subtle">
                    لا يوجد غياب مسجل. راجع الفصول التي لم ترسل الحضور قبل
                    اعتماد الإجمالي.
                  </p>
                )}
              </div>
              <button className="secondary" onClick={() => void load()}>
                تحديث الحضور
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
