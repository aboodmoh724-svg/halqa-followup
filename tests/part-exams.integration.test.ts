import { test } from "node:test";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { juzs } from "../src/lib/completion";
import type { ExamActor } from "../src/lib/exam-service";
const thursday = new Date("2026-10-29T09:00:00Z"),
  friday = new Date("2026-10-30T09:00:00Z"),
  tuesday = new Date("2026-11-03T09:00:00Z");
const q = (warning = 0) => [
  { prompting: 0, warning, tajweed: 0 },
  { prompting: 0, warning: 0, tajweed: 0 },
  { prompting: 0, warning: 0, tajweed: 0 },
];
test(
  "part exams: prior approval, proof, hidden teacher grades, mandatory review, atomic approval, exact school retry, transfers, corrected evidence and audit",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { db } = await import("../src/lib/db"),
      {
        studentExamView,
        setMemorizationBaseline,
        submitPartExam,
        decidePartExam,
        examOverview,
      } = await import("../src/lib/exam-service"),
      { mutateDay } = await import("../src/lib/day-service"),
      { getTransferOptions, transferStudent } =
        await import("../src/lib/student-transfers"),
      { getCorrection, correctStudent } =
        await import("../src/lib/supervisor-corrections");
    const a = await db.teacher.create({
        data: {
          name: "exam teacher A",
          codeHash: "test",
          codeLookup: randomUUID(),
        },
      }),
      b = await db.teacher.create({
        data: {
          name: "exam teacher B",
          codeHash: "test",
          codeLookup: randomUUID(),
        },
      }),
      sup = await db.supervisor.create({
        data: {
          name: "exam supervisor",
          username: randomUUID(),
          passwordHash: "test",
        },
      });
    const h = await db.halqa.create({
        data: { name: "الأول أ اختبار", teacherId: a.id },
      }),
      dest = await db.halqa.create({
        data: { name: "الثاني ب اختبار", teacherId: b.id },
      }),
      prep = await db.halqa.create({
        data: { name: "تأهيلي اختبار", teacherId: b.id, attendanceOnly: true },
      }),
      student = await db.student.create({ data: { name: "طالب الاختبار" } });
    const e = await db.enrollment.create({
        data: { studentId: student.id, halqaId: h.id },
      }),
      teacher: ExamActor = { kind: "TEACHER", id: a.id, name: a.name },
      other: ExamActor = { kind: "TEACHER", id: b.id, name: b.name },
      supervisor: ExamActor = {
        kind: "SUPERVISOR",
        id: sup.id,
        name: sup.name,
      };
    const payload = (version: string, juz = 30, questions = q()) => ({
      version,
      juz,
      questions,
      confirmed: true as const,
      requestKey: randomUUID(),
    });
    const decision = (version: string, action: string, note = "") => ({
      version,
      action,
      note,
      requestKey: randomUUID(),
    });
    const recite = async (
      teacherId: string,
      halqaId: string,
      enrollmentId: string,
      kind: "MEMORIZATION" | "REVIEW",
      s: number,
      start: number,
      end: number,
      now = thursday,
    ) =>
      mutateDay(
        teacherId,
        halqaId,
        {
          action: "entry",
          enrollmentId,
          date: now.toISOString().slice(0, 10),
          kind,
          assessment: "MASTERED",
          range: { startSurah: s, startAyah: start, endSurah: s, endAyah: end },
          requestKey: randomUUID(),
        },
        now,
      );
    try {
      let view = await studentExamView(supervisor, h.id, e.id, thursday);
      await assert.rejects(
        () => studentExamView(other, h.id, e.id, thursday),
        /غير موجود/,
      );
      await assert.rejects(
        () =>
          setMemorizationBaseline(
            teacher,
            h.id,
            e.id,
            {
              version: view.version,
              ranges: [juzs[29].range],
              note: "مدرسي",
              confirmed: true,
              requestKey: randomUUID(),
            },
            thursday,
          ),
        /غير مسموح/,
      );
      const baseline = {
        version: view.version,
        ranges: [{ ...juzs[29].range, endAyah: 5 }],
        note: "محفوظ سابق اعتمدته المدرسة",
        confirmed: true,
        requestKey: randomUUID(),
      };
      view = await setMemorizationBaseline(
        supervisor,
        h.id,
        e.id,
        baseline,
        thursday,
      );
      await setMemorizationBaseline(supervisor, h.id, e.id, baseline, thursday);
      await assert.rejects(
        () =>
          setMemorizationBaseline(
            supervisor,
            h.id,
            e.id,
            { ...baseline, requestKey: randomUUID() },
            thursday,
          ),
        /معتمد بالفعل/,
      );
      assert.equal(
        await db.memorizationBaseline.count({
          where: { studentId: student.id },
        }),
        1,
      );
      assert.equal(
        await db.recitationEntry.count({
          where: { dailyStatus: { enrollment: { studentId: student.id } } },
        }),
        0,
      );
      assert.equal(
        await db.dailySession.count({ where: { halqaId: h.id } }),
        0,
      );
      assert.equal(view.parts.length, 0);
      await recite(a.id, h.id, e.id, "MEMORIZATION", 114, 6, 6);
      view = await studentExamView(teacher, h.id, e.id, thursday);
      assert.deepEqual(
        view.surahs.map((s) => s.number),
        [114],
      );
      assert(view.parts[0].complete);
      assert(!view.parts[0].canSubmit);
      await assert.rejects(
        () =>
          submitPartExam(teacher, h.id, e.id, payload(view.version), thursday),
        /تسميع/,
      );
      await assert.rejects(
        () => recite(a.id, h.id, e.id, "MEMORIZATION", 67, 1, 3),
        /كاملة/,
      );
      await recite(a.id, h.id, e.id, "REVIEW", 114, 1, 6);
      view = await studentExamView(teacher, h.id, e.id, thursday);
      assert(view.parts[0].canSubmit);
      const failed = payload(view.version, 30, [
        { prompting: 12, warning: 1, tajweed: 1 },
        q()[1],
        q()[2],
      ]);
      const submitted = await submitPartExam(
        teacher,
        h.id,
        e.id,
        failed,
        thursday,
      );
      await submitPartExam(teacher, h.id, e.id, failed, thursday);
      assert.equal(
        await db.partExam.count({ where: { studentId: student.id } }),
        1,
      );
      const first = submitted.parts[0].attempts[0];
      const originalProof = await db.partExam.findUniqueOrThrow({
        where: { id: first.id },
      });
      assert(originalProof.evidenceSnapshot);
      for (const field of [
        "score",
        "rating",
        "passed",
        "scoreHalfPoints",
        "evidenceHash",
        "policyVersion",
      ])
        assert(!Object.hasOwn(first, field), field + " leaked to teacher");
      assert.equal(submitted.parts[0].state, "SUBMITTED");
      await assert.rejects(
        () =>
          submitPartExam(
            teacher,
            h.id,
            e.id,
            { ...failed, questions: q(20) },
            thursday,
          ),
        /بيانات أخرى/,
      );
      await assert.rejects(
        () => recite(a.id, h.id, e.id, "MEMORIZATION", 67, 1, 3),
        /الاختبار/,
      );
      let admin = await studentExamView(supervisor, h.id, e.id, friday);
      assert.equal(admin.parts[0].attempts[0].score, 74.5);
      assert.equal(admin.parts[0].attempts[0].rating, "غير ناجح");
      await assert.rejects(
        () =>
          decidePartExam(
            supervisor,
            first.id,
            decision(admin.version, "APPROVE"),
            friday,
          ),
        /لا يعتمد/,
      );
      const retry = decision(admin.version, "RETRY", "تثبيت الحفظ قبل الإعادة");
      await decidePartExam(supervisor, first.id, retry, friday);
      await decidePartExam(supervisor, first.id, retry, friday);
      assert.equal(
        await db.examAction.count({ where: { examId: first.id } }),
        1,
      );
      view = await studentExamView(
        teacher,
        h.id,
        e.id,
        new Date("2026-11-02T09:00:00Z"),
      );
      assert.equal(view.parts[0].retryOn, "2026-11-03");
      assert(!view.parts[0].canSubmit);
      await assert.rejects(
        () =>
          submitPartExam(
            teacher,
            h.id,
            e.id,
            payload(view.version, 30, q(20)),
            new Date("2026-11-02T09:00:00Z"),
          ),
        /موعدها/,
      );
      await assert.rejects(
        () =>
          submitPartExam(
            teacher,
            h.id,
            e.id,
            payload(view.version),
            new Date("2026-10-31T09:00:00Z"),
          ),
        /عطلة/,
      );
      view = await studentExamView(teacher, h.id, e.id, tuesday);
      assert(view.parts[0].canSubmit);
      await mutateDay(
        a.id,
        h.id,
        {
          action: "status",
          enrollmentId: e.id,
          date: "2026-11-03",
          outcome: "ABSENT",
          note: "اختبار حارس الحضور",
          carry: false,
        },
        tuesday,
      );
      const absentView = await studentExamView(teacher, h.id, e.id, tuesday);
      assert(!absentView.parts[0].canSubmit);
      await assert.rejects(
        () =>
          submitPartExam(
            teacher,
            h.id,
            e.id,
            payload(absentView.version, 30, q(20)),
            tuesday,
          ),
        /الغياب/,
      );
      await mutateDay(
        a.id,
        h.id,
        {
          action: "status",
          enrollmentId: e.id,
          date: "2026-11-03",
          outcome: null,
          note: "حضر الطالب",
          carry: false,
        },
        tuesday,
      );
      view = await studentExamView(teacher, h.id, e.id, tuesday);
      view = await submitPartExam(
        teacher,
        h.id,
        e.id,
        payload(view.version, 30, q(20)),
        tuesday,
      );
      const second = view.parts[0].attempts[0];
      assert.equal(second.attempt, 2);
      const presence = await db.dailyStudentStatus.findFirstOrThrow({
        where: {
          enrollmentId: e.id,
          session: { date: new Date("2026-11-03T00:00:00Z") },
        },
      });
      assert.equal(presence.attendance, "PRESENT");
      assert.equal(presence.outcome, null);
      assert.equal(presence.memorizationResult, null);
      assert.equal(presence.reviewResult, null);
      await assert.rejects(
        () =>
          mutateDay(
            a.id,
            h.id,
            {
              action: "status",
              enrollmentId: e.id,
              date: "2026-11-03",
              outcome: "ABSENT",
              note: "غير صحيح",
              carry: false,
            },
            tuesday,
          ),
        /اختبار/,
      );
      const attendance = await import("../src/lib/attendance-service");
      const attendanceView = await attendance.getAttendance(
        teacher,
        h.id,
        "2026-11-03",
        tuesday,
      );
      assert(attendanceView.students.find((s) => s.id === e.id)?.hasExam);
      assert(
        !attendanceView.students.find((s) => s.id === e.id)?.hasRecitation,
      );
      await assert.rejects(
        () =>
          attendance.confirmAttendance(
            teacher,
            h.id,
            {
              date: "2026-11-03",
              version: attendanceView.version,
              absentIds: [e.id],
              requestKey: randomUUID(),
            },
            tuesday,
          ),
        /اختبار/,
      );
      admin = await studentExamView(supervisor, h.id, e.id, tuesday);
      assert.equal(admin.parts[0].attempts[0].score, 80);
      const concurrent = await Promise.allSettled([
        decidePartExam(
          supervisor,
          second.id,
          decision(admin.version, "APPROVE"),
          tuesday,
        ),
        decidePartExam(
          supervisor,
          second.id,
          decision(admin.version, "APPROVE"),
          tuesday,
        ),
      ]);
      assert.equal(
        concurrent.filter((x) => x.status === "fulfilled").length,
        1,
      );
      assert.equal(
        await db.examAction.count({ where: { examId: second.id } }),
        1,
      );
      view = await studentExamView(teacher, h.id, e.id, tuesday);
      assert.equal(view.parts[0].state, "APPROVED");
      assert.equal(view.parts[0].attempts.length, 2);
      assert(!Object.hasOwn(view.parts[0].attempts[0], "score"));
      await recite(a.id, h.id, e.id, "MEMORIZATION", 67, 1, 3, tuesday);
      const options = await getTransferOptions(h.id, e.id);
      const moved = await transferStudent(
        sup.id,
        h.id,
        e.id,
        {
          targetHalqaId: dest.id,
          version: options.version,
          requestKey: randomUUID(),
        },
        tuesday,
      );
      view = await studentExamView(other, dest.id, moved.enrollmentId, tuesday);
      assert.equal(view.parts[0].attempts.length, 2);
      assert(view.baseline);
      await assert.rejects(
        () => studentExamView(teacher, h.id, e.id, tuesday),
        /غير موجود/,
      );
      const correction = await getCorrection(h.id, e.id, "2026-10-29");
      await correctStudent(sup.id, h.id, e.id, {
        action: "result",
        date: "2026-10-29",
        version: correction.version,
        kind: "MEMORIZATION",
        result: "NOT_MASTERED",
      });
      view = await studentExamView(other, dest.id, moved.enrollmentId, tuesday);
      assert.equal(view.parts[0].state, "CHANGED");
      const preservedProof = await db.partExam.findUniqueOrThrow({
        where: { id: first.id },
      });
      assert.deepEqual(
        preservedProof.evidenceSnapshot,
        originalProof.evidenceSnapshot,
      );
      assert.equal(preservedProof.evidenceHash, originalProof.evidenceHash);
      await assert.rejects(
        () =>
          recite(
            b.id,
            dest.id,
            moved.enrollmentId,
            "MEMORIZATION",
            68,
            1,
            3,
            tuesday,
          ),
        /تغير سجل/,
      );
      admin = await studentExamView(
        supervisor,
        dest.id,
        moved.enrollmentId,
        tuesday,
      );
      await decidePartExam(
        supervisor,
        second.id,
        decision(admin.version, "REVOKE", "تغير أصل الحفظ بعد تصحيح المدرسة"),
        tuesday,
      );
      await recite(
        b.id,
        dest.id,
        moved.enrollmentId,
        "MEMORIZATION",
        114,
        6,
        6,
        tuesday,
      );
      await recite(
        b.id,
        dest.id,
        moved.enrollmentId,
        "REVIEW",
        114,
        1,
        6,
        tuesday,
      );
      const late = new Date("2026-11-06T09:00:00Z");
      admin = await studentExamView(
        supervisor,
        dest.id,
        moved.enrollmentId,
        late,
      );
      assert(admin.parts[0].overdue);
      await decidePartExam(
        supervisor,
        second.id,
        decision(
          admin.version,
          "RESCHEDULE",
          "فات الموعد السابق بعد غياب الطالب",
        ),
        late,
      );
      view = await studentExamView(other, dest.id, moved.enrollmentId, late);
      assert.equal(view.parts[0].retryOn, "2026-11-10");
      const overview = await examOverview(supervisor, late);
      assert(
        overview.students.some(
          (s) =>
            s.enrollmentId === moved.enrollmentId &&
            s.parts[0].state === "RETRY",
        ),
      );
      assert(!overview.students.some((s) => s.halqaId === prep.id));
      assert.equal(
        await db.partExam.count({ where: { studentId: student.id } }),
        2,
      );
      assert.equal(
        await db.examAction.count({
          where: { exam: { studentId: student.id } },
        }),
        4,
      );
    } finally {
      await db.examAction.deleteMany({
        where: { exam: { studentId: student.id } },
      });
      await db.partExam.deleteMany({ where: { studentId: student.id } });
      await db.memorizationBaseline.deleteMany({
        where: { studentId: student.id },
      });
      await db.supervisorCorrection.deleteMany({
        where: { supervisorId: sup.id },
      });
      await db.studentTransfer.deleteMany({ where: { studentId: student.id } });
      await db.recitationEntry.deleteMany({
        where: { dailyStatus: { enrollment: { studentId: student.id } } },
      });
      await db.assignment.deleteMany({
        where: { enrollment: { studentId: student.id } },
      });
      await db.dailyStudentStatus.deleteMany({
        where: { enrollment: { studentId: student.id } },
      });
      await db.dailySession.deleteMany({
        where: { halqaId: { in: [h.id, dest.id, prep.id] } },
      });
      await db.enrollment.deleteMany({ where: { studentId: student.id } });
      await db.student.delete({ where: { id: student.id } });
      await db.halqa.deleteMany({
        where: { id: { in: [h.id, dest.id, prep.id] } },
      });
      await db.teacher.deleteMany({ where: { id: { in: [a.id, b.id] } } });
      await db.supervisor.delete({ where: { id: sup.id } });
    }
  },
);
