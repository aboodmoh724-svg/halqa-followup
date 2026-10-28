"use client";
import { useEffect, useState } from "react";
import TeacherFlow from "./teacher-flow";
import SupervisorWorkspace from "./supervisor-workspace";
export default function UnifiedWorkspace() {
  const [state, setState] = useState<
    "loading" | "teacher" | "supervisor" | "error"
  >("loading");
  useEffect(() => {
    const c = new AbortController();
    fetch("/api/session", { cache: "no-store", signal: c.signal })
      .then(async (r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((s) => setState(s.role === "SUPERVISOR" ? "supervisor" : "teacher"))
      .catch((e) => {
        if (e.name !== "AbortError") setState("error");
      });
    return () => c.abort();
  }, []);
  if (state === "loading")
    return (
      <main className="shell login" aria-busy="true">
        <p>جارٍ فتح المتابعة…</p>
      </main>
    );
  if (state === "error")
    return (
      <main className="shell login">
        <p role="alert">تعذر الاتصال. تحقق من الشبكة وأعد المحاولة.</p>
        <button className="primary" onClick={() => window.location.reload()}>
          إعادة المحاولة
        </button>
      </main>
    );
  return state === "supervisor" ? <SupervisorWorkspace /> : <TeacherFlow />;
}
