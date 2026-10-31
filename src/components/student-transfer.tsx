"use client";
import { useEffect, useState } from "react";
import type { getTransferOptions } from "@/lib/student-transfers";
type Options = Awaited<ReturnType<typeof getTransferOptions>>;
export default function StudentTransfer({
  halqaId,
  enrollmentId,
  onTransferred,
}: {
  halqaId: string;
  enrollmentId: string;
  onTransferred: (result: {
    halqaId: string;
    enrollmentId: string;
  }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [options, setOptions] = useState<Options | null>(null),
    [target, setTarget] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [requestKey] = useState(() => crypto.randomUUID());
  const url = `/api/supervisor/halqas/${halqaId}/students/${enrollmentId}/transfer`;
  useEffect(() => {
    if (!open) return;
    const c = new AbortController();
    fetch(url, { cache: "no-store", signal: c.signal })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw Error(body.error);
        return body as Options;
      })
      .then((v) => {
        if (!c.signal.aborted) setOptions(v);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [open, url]);
  async function transfer() {
    if (!options || !target) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetHalqaId: target,
          version: options.version,
          requestKey,
        }),
      });
      const body = await r.json();
      if (!r.ok) throw Error(body.error);
      await onTransferred(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!open)
    return (
      <button
        className="secondary"
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        نقل الطالب إلى فصل آخر
      </button>
    );
  const destination = options?.destinations.find((h) => h.id === target);
  return (
    <section
      className="record-homework supervisor-transfer"
      aria-label="نقل الطالب"
    >
      <div className="history-section-title">
        <h3>نقل الطالب</h3>
        <button
          disabled={busy}
          className="text-button"
          onClick={() => {
            setOpen(false);
            setOptions(null);
            setTarget("");
          }}
        >
          إلغاء
        </button>
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {!options && !error && <p role="status">جارٍ تحميل الفصول…</p>}
      {options && (
        <>
          <p>من {options.sourceName}</p>
          <label>
            الفصل الجديد
            <select
              disabled={busy}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">اختر الفصل</option>
              {options.destinations.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} · {h.teacher.name}
                </option>
              ))}
            </select>
          </label>
          <p className="subtle">
            يبدأ النقل فور التأكيد. ينتقل تسجيل اليوم وواجب اليوم وما بعده،
            ويبقى السجل السابق محفوظًا. مسار الطالب يبقى{" "}
            {options.reviewOnly ? "مراجعة فقط" : "حفظ ومراجعة"}.
          </p>
          {destination && (
            <p className="notice">
              تأكيد نقل {options.studentName} إلى {destination.name}، لدى المعلم{" "}
              {destination.teacher.name}.
            </p>
          )}
          <button
            className="primary"
            disabled={!target || busy}
            onClick={() => void transfer()}
          >
            {busy ? "جارٍ نقل الطالب…" : "تأكيد النقل الآن"}
          </button>
        </>
      )}
    </section>
  );
}
