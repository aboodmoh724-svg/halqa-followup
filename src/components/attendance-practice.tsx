"use client";
import { useMemo, useRef, useState } from "react";
import type { AttendanceView } from "@/lib/attendance-service";
import AttendanceClass, { type AttendanceTransport } from "./attendance-class";

function initial(): AttendanceView {
  return {
    halqaId: "practice-only",
    name: "فصل التجربة · أسماء وهمية",
    teacherName: "معلم التجربة",
    attendanceOnly: true,
    date: new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul",
    }).format(new Date()),
    students: ["طالب تجريبي 1", "طالب تجريبي 2", "طالب تجريبي 3"].map(
      (name, i) => ({
        id: `practice-${i}`,
        name,
        state: null,
        updatedAt: null,
        hasRecitation: false,
      }),
    ),
    confirmedAt: null,
    recordedBy: null,
    confirmed: false,
    version: "0".repeat(64),
    present: 0,
    absent: 0,
    unknown: 3,
    readOnlyReason: null,
    sessionId: null,
  };
}

export default function AttendancePractice({ onExit }: { onExit: () => void }) {
  const current = useRef(initial());
  const [summary, setSummary] = useState(initial);
  const [resetKey, setResetKey] = useState(0);
  const transport = useMemo<AttendanceTransport>(
    () => ({
      load: async () => structuredClone(current.current),
      save: async (input) => {
        const before = current.current;
        if (input.version !== before.version)
          throw Error("حدّث قائمة التجربة قبل الإرسال");
        const now = new Date().toISOString();
        const students = before.students.map((s) => ({
          ...s,
          state: input.absentIds.includes(s.id)
            ? ("ABSENT" as const)
            : ("PRESENT" as const),
          updatedAt: now,
        }));
        const next: AttendanceView = {
          ...before,
          students,
          confirmed: true,
          confirmedAt: now,
          recordedBy: "معلم التجربة",
          version: (parseInt(before.version, 16) + 1)
            .toString(16)
            .padStart(64, "0"),
          present: students.filter((s) => s.state === "PRESENT").length,
          absent: input.absentIds.length,
          unknown: 0,
        };
        current.current = next;
        setSummary(next);
        return structuredClone(next);
      },
    }),
    [],
  );
  return (
    <section
      className="stack attendance-practice"
      aria-label="تجربة الحضور الآمنة"
    >
      <div className="attendance-closed" role="status">
        <strong>وضع التجربة · لا يُحفظ شيء في سجلات المدرسة</strong>
        <p>
          أسماء وهمية فقط. جرّب تحديد الغائبين والإرسال، ثم ألغِ غياب طالب وأعد
          الإرسال. النتيجة تظهر أدناه كما يراها المشرف.
        </p>
        <span>
          تعمل التجربة في جميع الأيام، وتُمسح عند الخروج منها أو تحديث الصفحة.
        </span>
      </div>
      <button className="secondary" onClick={onExit}>
        إنهاء التجربة والعودة للسجل الفعلي
      </button>
      <AttendanceClass
        key={resetKey}
        halqaId="practice-only"
        transport={transport}
      />
      <section
        className="attendance-practice-summary"
        aria-label="معاينة الإشراف التجريبية"
        aria-live="polite"
      >
        <h3>ما يظهر للمشرف · معاينة تجريبية</h3>
        <p>{summary.confirmed ? "تم إرسال الحضور" : "لم يُرسل الحضور بعد"}</p>
        <div className="attendance-counts">
          <span>
            حاضر <b>{summary.present}</b>
          </span>
          <span>
            غائب <b>{summary.absent}</b>
          </span>
          <span>
            غير محدد <b>{summary.unknown}</b>
          </span>
        </div>
        <h4>الغائبون</h4>
        {!summary.confirmed ? (
          <p>تظهر الأسماء بعد الإرسال.</p>
        ) : summary.absent ? (
          <ul>
            {summary.students
              .filter((s) => s.state === "ABSENT")
              .map((s) => (
                <li key={s.id}>{s.name}</li>
              ))}
          </ul>
        ) : (
          <p>جميع الطلاب حاضرون.</p>
        )}
      </section>
      <button
        className="text-button"
        onClick={() => {
          current.current = initial();
          setSummary(current.current);
          setResetKey((k) => k + 1);
        }}
      >
        إعادة التجربة من البداية
      </button>
    </section>
  );
}
