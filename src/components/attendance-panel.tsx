"use client";
import { useState } from "react";
import AttendanceClass from "./attendance-class";
import AttendancePractice from "./attendance-practice";
export default function AttendancePanel(props: {
  halqaId: string;
  date?: string;
  supervisor?: boolean;
  onSaved?: () => void;
}) {
  const [practice, setPractice] = useState(false);
  if (practice) return <AttendancePractice onExit={() => setPractice(false)} />;
  return (
    <div className="stack">
      <button className="secondary" onClick={() => setPractice(true)}>
        تجربة الحضور بأسماء وهمية
      </button>
      <AttendanceClass {...props} />
    </div>
  );
}
