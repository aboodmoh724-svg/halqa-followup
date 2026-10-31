import { test } from "node:test";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import {
  getAttendance,
  confirmAttendance,
  attendanceOverview,
  attendanceState,
  type AttendanceActor,
} from "../src/lib/attendance-service";
import { dayDate } from "../src/lib/dates";
test("attendance does not infer absence or presence from untouched records", () => {
  assert.equal(attendanceState(undefined), null);
  const empty = {
    outcome: null,
    attendance: null,
    memorizationResult: null,
    reviewResult: null,
    entries: [],
  };
  assert.equal(attendanceState(empty), null);
  assert.equal(attendanceState({ ...empty, attendance: "PRESENT" }), "PRESENT");
  assert.equal(
    attendanceState({ ...empty, outcome: "ABSENT", attendance: "PRESENT" }),
    "ABSENT",
  );
  assert.equal(
    attendanceState({ ...empty, entries: [{ id: "entry" }] }),
    "PRESENT",
  );
});
test(
  "PostgreSQL attendance: early confirmation, independent Quran results, homework, ownership, conflicts, idempotency, audit, prep isolation and transfers",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { db } = await import("../src/lib/db"),
      { ensureDay, getDay, mutateDay } = await import("../src/lib/day-service"),
      { getSupervisionReport } = await import("../src/lib/supervision-report"),
      { getSupervisorOverview } = await import("../src/lib/supervisor-service"),
      { getTransferOptions, transferStudent } =
        await import("../src/lib/student-transfers");
    const t = await db.teacher.create({
        data: {
          name: "attendance teacher",
          codeHash: "test",
          codeLookup: randomUUID(),
        },
      }),
      other = await db.teacher.create({
        data: {
          name: "other attendance",
          codeHash: "test",
          codeLookup: randomUUID(),
        },
      });
    const h = await db.halqa.create({
        data: { name: "الأول أ حضور", teacherId: t.id },
      }),
      p = await db.halqa.create({
        data: {
          name: "الأول ج حضور فقط",
          teacherId: other.id,
          attendanceOnly: true,
          attendanceStartsOn: dayDate("2026-10-29"),
        },
      }),
      dest = await db.halqa.create({
        data: { name: "وجهة حضور", teacherId: t.id },
      });
    const pupils = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        db.student.create({ data: { name: `طالب حضور ${i}` } }),
      ),
    );
    const es = await Promise.all(
      pupils.map((s, i) =>
        db.enrollment.create({
          data: { studentId: s.id, halqaId: i < 3 ? h.id : p.id, position: i },
        }),
      ),
    );
    const supervisor = await db.supervisor.create({
      data: {
        name: "attendance supervision",
        username: randomUUID(),
        passwordHash: "test",
      },
    });
    const teacher: AttendanceActor = {
        kind: "TEACHER",
        id: t.id,
        name: t.name,
      },
      prep: AttendanceActor = {
        kind: "TEACHER",
        id: other.id,
        name: other.name,
      },
      sup: AttendanceActor = {
        kind: "SUPERVISOR",
        id: supervisor.id,
        name: supervisor.name,
      },
      date = "2026-10-29",
      now = new Date("2026-10-29T09:00:00Z"),
      range = { startSurah: 2, startAyah: 1, endSurah: 2, endAyah: 5 };
    const payload = (
      v: Awaited<ReturnType<typeof getAttendance>>,
      absentIds: string[] = [],
    ) => ({ date, version: v.version, absentIds, requestKey: randomUUID() });
    try {
      const untouched = await getAttendance(teacher, h.id, date, now);
      assert.equal(untouched.unknown, 3);
      assert.equal(untouched.present, 0);
      assert(!untouched.confirmed);
      assert.equal(
        await db.dailySession.count({ where: { halqaId: h.id } }),
        0,
      );
      await assert.rejects(
        () => getAttendance(teacher, p.id, date, now),
        /الفصل غير موجود/,
      );
      await assert.rejects(
        () => getAttendance(prep, p.id, "2026-10-28", now),
        /لم يبدأ/,
      );
      await assert.rejects(
        () => attendanceOverview(teacher, date, now),
        /غير مسموح/,
      );
      await db.assignment.create({
        data: {
          enrollmentId: es[1].id,
          dueDate: dayDate(date),
          memorization: range,
          review: range,
        },
      });
      const manual = await db.assignment.create({
        data: {
          enrollmentId: es[1].id,
          dueDate: dayDate("2026-10-30"),
          review: range,
          reviewManual: true,
          note: "manual",
        },
      });
      const first = payload(untouched, [es[1].id]);
      let v = await confirmAttendance(teacher, h.id, first, now);
      assert(v.confirmed);
      assert.equal(v.present, 2);
      assert.equal(v.absent, 1);
      assert.equal(v.unknown, 0);
      const present = await db.dailyStudentStatus.findFirstOrThrow({
        where: { enrollmentId: es[0].id, session: { date: dayDate(date) } },
      });
      assert.equal(present.outcome, null);
      assert.equal(present.memorizationResult, null);
      assert.equal(present.reviewResult, null);
      assert.equal(
        await db.recitationEntry.count({
          where: { dailyStatus: { halqaId: h.id } },
        }),
        0,
      );
      const carried = await db.assignment.findUniqueOrThrow({
        where: { id: manual.id },
      });
      assert.deepEqual(carried.memorization, range);
      assert.equal(carried.reviewManual, true);
      assert.equal(carried.note, "manual");
      await confirmAttendance(teacher, h.id, first, now);
      assert.equal(
        await db.attendanceEdit.count({ where: { halqaId: h.id } }),
        1,
      );
      await assert.rejects(
        () =>
          confirmAttendance(
            teacher,
            h.id,
            { ...first, requestKey: randomUUID() },
            now,
          ),
        /تغير الحضور/,
      );
      await assert.rejects(
        () => confirmAttendance(teacher, h.id, payload(v, [es[3].id]), now),
        /خارج الفصل/,
      );
      assert.equal(
        await db.attendanceEdit.count({ where: { halqaId: h.id } }),
        1,
      );
      await mutateDay(
        t.id,
        h.id,
        {
          action: "status",
          date,
          enrollmentId: es[1].id,
          outcome: null,
          note: "arrived",
          carry: false,
        },
        now,
      );
      v = await getAttendance(teacher, h.id, date, now);
      assert.equal(v.present, 3);
      assert.equal(v.absent, 0);
      await mutateDay(
        t.id,
        h.id,
        {
          action: "entry",
          date,
          enrollmentId: es[0].id,
          kind: "MEMORIZATION",
          assessment: "MASTERED",
          range,
          requestKey: randomUUID(),
        },
        now,
      );
      v = await getAttendance(teacher, h.id, date, now);
      await assert.rejects(
        () => confirmAttendance(teacher, h.id, payload(v, [es[0].id]), now),
        /تسميع مسجل/,
      );
      assert.equal(
        await db.attendanceEdit.count({ where: { halqaId: h.id } }),
        1,
      );
      const beforeGrade = await db.dailyStudentStatus.findUniqueOrThrow({
        where: { id: present.id },
      });
      v = await confirmAttendance(sup, h.id, payload(v, [es[2].id]), now);
      const afterGrade = await db.dailyStudentStatus.findUniqueOrThrow({
        where: { id: present.id },
      });
      assert.equal(
        afterGrade.memorizationResult,
        beforeGrade.memorizationResult,
      );
      assert.equal(v.recordedBy, sup.name);
      const lastLog = await db.attendanceEdit.findFirstOrThrow({
        where: { halqaId: h.id },
        orderBy: { createdAt: "desc" },
      });
      assert.equal(lastLog.actorKind, "SUPERVISOR");
      assert.equal(lastLog.actorId, supervisor.id);
      await assert.rejects(
        () =>
          confirmAttendance(
            teacher,
            h.id,
            payload(v),
            new Date("2026-10-31T09:00:00Z"),
          ),
        /عطلة/,
      );
      const pv = await getAttendance(prep, p.id, date, now),
        pp = payload(pv, [es[3].id]);
      const savedPrep = await confirmAttendance(prep, p.id, pp, now);
      assert(savedPrep.confirmed);
      assert.equal(savedPrep.absent, 1);
      assert.equal(savedPrep.present, 1);
      const simultaneous = await Promise.allSettled([
        confirmAttendance(prep, p.id, payload(savedPrep, [es[3].id]), now),
        confirmAttendance(prep, p.id, payload(savedPrep, [es[3].id]), now),
      ]);
      assert.equal(
        simultaneous.filter((r) => r.status === "fulfilled").length,
        1,
      );
      assert.equal(
        await db.attendanceEdit.count({ where: { halqaId: p.id } }),
        2,
      );
      await assert.rejects(() => ensureDay(other.id, p.id, date), /غير موجودة/);
      await assert.rejects(() => getDay(other.id, p.id, date), /لم يبدأ/);
      const quran = await getSupervisionReport({
        type: "comprehensive",
        from: date,
        to: date,
      });
      assert(!quran.classes.some((c) => c.id === p.id));
      assert(!quran.rows.some((r) => r.enrollmentId === es[3].id));
      const overview = await getSupervisorOverview(date, now);
      assert(!overview.classes.some((c) => c.id === p.id));
      const opt = await getTransferOptions(h.id, es[0].id);
      assert(!opt.destinations.some((d) => d.id === p.id));
      await assert.rejects(
        () =>
          transferStudent(
            supervisor.id,
            h.id,
            es[0].id,
            {
              targetHalqaId: p.id,
              version: opt.version,
              requestKey: randomUUID(),
            },
            now,
          ),
        /الحلقة/,
      );
      const moved = await transferStudent(
        supervisor.id,
        h.id,
        es[0].id,
        {
          targetHalqaId: dest.id,
          version: opt.version,
          requestKey: randomUUID(),
        },
        now,
      );
      const received = await getAttendance(teacher, dest.id, date, now);
      assert.equal(received.students[0].id, moved.enrollmentId);
      assert.equal(received.present, 1);
      assert(!received.confirmed);
      assert(!(await getAttendance(teacher, h.id, date, now)).confirmed);
      const existingSession = await db.dailySession.findUniqueOrThrow({
        where: { halqaId_date: { halqaId: h.id, date: dayDate(date) } },
      });
      await db.dailySession.update({
        where: { id: existingSession.id },
        data: { closedAt: now },
      });
      const sameAttendance = await getAttendance(teacher, h.id, date, now);
      await confirmAttendance(
        teacher,
        h.id,
        payload(
          sameAttendance,
          sameAttendance.students
            .filter((s) => s.state === "ABSENT")
            .map((s) => s.id),
        ),
        now,
      );
      assert.equal(
        (
          await db.dailySession.findUniqueOrThrow({
            where: { id: existingSession.id },
          })
        ).closedAt?.toISOString(),
        now.toISOString(),
      );
      assert.equal(
        (
          await attendanceOverview(
            sup,
            "2026-10-31",
            new Date("2026-10-31T09:00:00Z"),
          )
        ).studyDay,
        false,
      );
      const school = await attendanceOverview(sup, date, now);
      assert(school.classes.some((c) => c.halqaId === p.id));
      assert(
        school.classes
          .flatMap((c) => c.students)
          .some((s) => s.id === es[3].id && s.state === "ABSENT"),
      );
    } finally {
      const ids = pupils.map((p) => p.id),
        hs = [h.id, p.id, dest.id];
      await db.attendanceEdit.deleteMany({ where: { halqaId: { in: hs } } });
      await db.studentTransfer.deleteMany({
        where: { studentId: { in: ids } },
      });
      await db.recitationEntry.deleteMany({
        where: { dailyStatus: { halqaId: { in: hs } } },
      });
      await db.assignment.deleteMany({
        where: { enrollment: { studentId: { in: ids } } },
      });
      await db.dailyStudentStatus.deleteMany({
        where: { enrollment: { studentId: { in: ids } } },
      });
      await db.dailySession.deleteMany({ where: { halqaId: { in: hs } } });
      await db.enrollment.deleteMany({ where: { studentId: { in: ids } } });
      await db.student.deleteMany({ where: { id: { in: ids } } });
      await db.halqa.deleteMany({ where: { id: { in: hs } } });
      await db.teacher.deleteMany({ where: { id: { in: [t.id, other.id] } } });
      await db.supervisor.delete({ where: { id: supervisor.id } });
    }
  },
);
