"use client";
import { useCallback, useEffect, useState } from "react";
import type { AttendanceView } from "@/lib/attendance-service";
export default function AttendanceClass({
  halqaId,
  date,
  supervisor = false,
  onSaved,
}: {
  halqaId: string;
  date?: string;
  supervisor?: boolean;
  onSaved?: () => void;
}) {
  const [data, setData] = useState<AttendanceView | null>(null),
    [absent, setAbsent] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const endpoint = supervisor
    ? `/api/supervisor/halqas/${halqaId}/attendance`
    : `/api/halqas/${halqaId}/attendance`;
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const r = await fetch(endpoint + (date ? `?date=${date}` : ""), {
          cache: "no-store",
          signal,
        });
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setData(d);
        setAbsent(
          d.students
            .filter(
              (s: AttendanceView["students"][number]) => s.state === "ABSENT",
            )
            .map((s: AttendanceView["students"][number]) => s.id),
        );
        setError("");
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      }
    },
    [endpoint, date],
  );
  useEffect(() => {
    const c = new AbortController();
    queueMicrotask(() => {
      if (!c.signal.aborted) void load(c.signal);
    });
    return () => c.abort();
  }, [load]);
  async function save() {
    if (!data) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          date: data.date,
          version: data.version,
          absentIds: absent,
          requestKey: crypto.randomUUID(),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setData(d);
      setMessage("تم تأكيد وإرسال الحضور والغياب");
      onSaved?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="attendance-class" aria-label="تسجيل الحضور والغياب">
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {!data ? (
        <p>جارٍ فتح قائمة الحضور…</p>
      ) : (
        <>
          <h2>{data.name}</h2>
          <p className="subtle">
            {data.teacherName} · <bdi>{data.date}</bdi>
          </p>
          <p className={data.confirmed ? "notice" : "subtle"}>
            {data.confirmed ? "تم إرسال الحضور" : "لم يُؤكد حضور الفصل بعد"}
            {data.recordedBy ? ` · ${data.recordedBy}` : ""}
          </p>
          {data.confirmedAt && (
            <p className="subtle">
              آخر إرسال:{" "}
              {new Intl.DateTimeFormat("ar", {
                timeZone: "Europe/Istanbul",
                hour: "numeric",
                minute: "2-digit",
              }).format(new Date(data.confirmedAt))}
            </p>
          )}
          {data.readOnlyReason ? (
            <p className="notice">{data.readOnlyReason}</p>
          ) : (
            <p>حدد الغائبين فقط، ثم أكد أن بقية الطلاب حاضرون.</p>
          )}
          <div className="attendance-counts">
            <span>
              {data.readOnlyReason ? "الحضور المسجل" : "الحاضرون عند التأكيد"}{" "}
              <b>
                {data.readOnlyReason
                  ? data.present
                  : data.students.length - absent.length}
              </b>
            </span>
            <span>
              الغائبون <b>{absent.length}</b>
            </span>
          </div>
          <div className="attendance-roster">
            {data.students.map((s, i) => (
              <label key={s.id} className="attendance-row">
                <span className="subtle">{i + 1}</span>
                <span>
                  {s.name}
                  {s.hasRecitation && <small>لديه تسميع مسجل اليوم</small>}
                </span>
                <span className="attendance-check">
                  <input
                    type="checkbox"
                    aria-label={`غياب ${s.name}`}
                    checked={absent.includes(s.id)}
                    disabled={
                      busy ||
                      !!data.readOnlyReason ||
                      (s.hasRecitation && !absent.includes(s.id))
                    }
                    onChange={(e) => {
                      setMessage("");
                      setAbsent((prev) =>
                        e.target.checked
                          ? [...prev, s.id]
                          : prev.filter((id) => id !== s.id),
                      );
                    }}
                  />
                  غائب
                </span>
              </label>
            ))}
          </div>
          {message && (
            <p className="notice" role="status">
              {message}
            </p>
          )}
          {!data.readOnlyReason && (
            <button
              className="primary space"
              disabled={busy || !data.students.length}
              onClick={save}
            >
              {busy
                ? "جارٍ الإرسال…"
                : data.confirmed
                  ? "تعديل وإرسال الحضور"
                  : "تأكيد وإرسال الحضور"}
            </button>
          )}
          <button
            className="text-button space"
            disabled={busy}
            onClick={() => void load()}
          >
            تحديث القائمة
          </button>
        </>
      )}
    </section>
  );
}
