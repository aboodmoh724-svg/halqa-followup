import { test } from "node:test";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { dayDate, dayKey } from "../src/lib/dates";

test(
  "supervisor correction: historical/current edits, audit atomicity, stale conflict, ownership, homework isolation and review-only guards",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { db } = await import("../src/lib/db");
    const { getCorrection, correctStudent } =
      await import("../src/lib/supervisor-corrections");
    const { mutateDay } = await import("../src/lib/day-service");
    const teacher = await db.teacher.create({
      data: {
        name: "correction fixture",
        codeLookup: randomUUID(),
        codeHash: "test",
      },
    });
    const supervisor = await db.supervisor.create({
      data: {
        name: "correction supervisor",
        username: randomUUID(),
        passwordHash: "test",
      },
    });
    const halqa = await db.halqa.create({
      data: { name: "correction fixture", teacherId: teacher.id },
    });
    const student = await db.student.create({
      data: { name: "correction pupil" },
    });
    const enrollment = await db.enrollment.create({
      data: { halqaId: halqa.id, studentId: student.id },
    });
    const range = { startSurah: 67, startAyah: 1, endSurah: 67, endAyah: 10 };
    const historical = "2026-10-20",
      today = dayKey();
    const session = await db.dailySession.create({
      data: {
        halqaId: halqa.id,
        date: dayDate(historical),
        closedAt: new Date(),
      },
    });
    const current = await db.dailySession.create({
      data: { halqaId: halqa.id, date: dayDate(today), closedAt: new Date() },
    });
    await db.dailyStudentStatus.create({
      data: {
        sessionId: session.id,
        halqaId: halqa.id,
        enrollmentId: enrollment.id,
        outcome: "NOT_MEMORIZED",
        memorizationResult: "NOT_MASTERED",
        reviewResult: "MASTERED",
        entries: {
          create: [
            {
              ...range,
              kind: "MEMORIZATION",
              assessment: "NOT_MASTERED",
              requestKey: randomUUID(),
            },
            {
              ...range,
              kind: "REVIEW",
              assessment: "MASTERED",
              requestKey: randomUUID(),
            },
          ],
        },
      },
    });
    const currentStatus = await db.dailyStudentStatus.create({
      data: {
        sessionId: current.id,
        halqaId: halqa.id,
        enrollmentId: enrollment.id,
      },
    });
    const assignment = await db.assignment.create({
      data: {
        enrollmentId: enrollment.id,
        dueDate: dayDate("2026-10-21"),
        memorization: range,
        review: range,
        note: "original",
      },
    });
    const future = await db.assignment.create({
      data: {
        enrollmentId: enrollment.id,
        dueDate: dayDate("2026-11-02"),
        memorization: range,
        review: range,
        note: "keep later",
      },
    });
    const read = (date = historical) =>
      getCorrection(halqa.id, enrollment.id, date);
    const post = async (action: Record<string, unknown>, date = historical) =>
      correctStudent(supervisor.id, halqa.id, enrollment.id, {
        date,
        version: (await read(date)).version,
        ...action,
      });
    try {
      const before = await read();
      assert.equal(
        await db.supervisorCorrection.count({
          where: { enrollmentId: enrollment.id },
        }),
        0,
      );
      await post({
        action: "entry",
        entryId: before.entries[0].id,
        range: { ...range, endAyah: 15 },
      });
      const edited = await read();
      assert.equal(edited.entries[0].endAyah, 15);
      assert(Number(edited.entries[0].pageAmount) > 0);
      await assert.rejects(
        () =>
          correctStudent(supervisor.id, halqa.id, enrollment.id, {
            date: historical,
            version: before.version,
            action: "note",
            note: "stale",
          }),
        /تغير السجل/,
      );
      assert.equal(
        await db.supervisorCorrection.count({
          where: { enrollmentId: enrollment.id },
        }),
        1,
      );
      await post({
        action: "result",
        kind: "MEMORIZATION",
        result: "MASTERED",
      });
      assert.equal((await read()).outcome, "MEMORIZED");
      assert.equal(
        (
          await db.recitationEntry.findUniqueOrThrow({
            where: { id: before.entries[0].id },
          })
        ).assessment,
        "NOT_MASTERED",
      );
      assert.equal((await read()).entries[0].masteryResult, "MASTERED");
      assert.deepEqual(
        await db.assignment.findUnique({ where: { id: assignment.id } }),
        assignment,
      );
      assert.deepEqual(
        await db.assignment.findUnique({ where: { id: future.id } }),
        future,
      );
      assert(
        (await db.dailySession.findUniqueOrThrow({ where: { id: session.id } }))
          .closedAt,
      );
      await assert.rejects(
        () => post({ action: "attendance", absent: true }),
        /يوجد تسميع/,
      );
      await assert.rejects(
        () => post({ action: "entry", entryId: randomUUID(), range }),
        /التسميع غير موجود/,
      );
      await assert.rejects(() =>
        post({
          action: "entry",
          entryId: before.entries[0].id,
          range: { ...range, endAyah: 31 },
        }),
      );
      await assert.rejects(() =>
        getCorrection("other-class", enrollment.id, historical),
      );
      await assert.rejects(async () =>
        correctStudent("not-a-supervisor", halqa.id, enrollment.id, {
          date: historical,
          version: (await read()).version,
          action: "note",
          note: "no",
        }),
      );
      await assert.rejects(() =>
        getCorrection(halqa.id, enrollment.id, "2026-02-30"),
      );
      await post({
        action: "assignment",
        memorization: null,
        review: { ...range, endAyah: 20 },
        note: "corrected duty",
        imageName: "text only",
      });
      const duty = (await read()).assignment!;
      assert.equal(duty.memorization, null);
      assert.equal(duty.reviewManual, true);
      assert.equal(duty.note, "corrected duty");
      assert.deepEqual(
        await db.assignment.findUnique({ where: { id: future.id } }),
        future,
      );
      await post({ action: "note", note: "current correction" }, today);
      assert.equal(
        (await db.dailySession.findUniqueOrThrow({ where: { id: current.id } }))
          .closedAt,
        null,
      );
      await post({ action: "attendance", absent: true }, today);
      assert.equal((await read(today)).outcome, "ABSENT");
      await post({ action: "attendance", absent: false }, today);
      assert.equal((await read(today)).outcome, null);
      await assert.rejects(
        () =>
          post({ action: "result", kind: "REVIEW", result: "MASTERED" }, today),
        /دون مدى/,
      );
      await db.dailyStudentStatus.update({
        where: { id: currentStatus.id },
        data: { reviewOnly: true },
      });
      await assert.rejects(
        () =>
          post(
            {
              action: "assignment",
              memorization: range,
              review: range,
              note: "",
              imageName: "",
            },
            today,
          ),
        /مراجعة فقط/,
      );
      await assert.rejects(
        () =>
          mutateDay(teacher.id, halqa.id, {
            action: "note",
            date: historical,
            enrollmentId: enrollment.id,
            note: "teacher old edit",
          }),
        /تغير اليوم/,
      );
      const concurrentVersion = (await read()).version;
      const concurrent = await Promise.allSettled(
        ["one", "two"].map((note) =>
          correctStudent(supervisor.id, halqa.id, enrollment.id, {
            date: historical,
            version: concurrentVersion,
            action: "note",
            note,
          }),
        ),
      );
      assert.equal(
        concurrent.filter((r) => r.status === "fulfilled").length,
        1,
      );
      const conflict = concurrent.find(
        (r) => r.status === "rejected",
      ) as PromiseRejectedResult;
      assert.equal(conflict.reason.status, 409);
      const audit = await db.supervisorCorrection.findMany({
        where: { enrollmentId: enrollment.id },
        orderBy: { createdAt: "asc" },
      });
      assert.equal(audit.length, 7);
      assert(audit.every((a) => a.supervisorId === supervisor.id));
      assert.equal(
        (audit[0].before as { status: { entries: { endAyah: number }[] } })
          .status.entries[0].endAyah,
        10,
      );
      assert.equal(
        (audit[0].after as { status: { entries: { endAyah: number }[] } })
          .status.entries[0].endAyah,
        15,
      );
    } finally {
      await db.supervisorCorrection.deleteMany({
        where: { enrollmentId: enrollment.id },
      });
      await db.assignment.deleteMany({
        where: { enrollmentId: enrollment.id },
      });
      await db.recitationEntry.deleteMany({
        where: { dailyStatus: { enrollmentId: enrollment.id } },
      });
      await db.dailyStudentStatus.deleteMany({
        where: { enrollmentId: enrollment.id },
      });
      await db.dailySession.deleteMany({ where: { halqaId: halqa.id } });
      await db.enrollment.delete({ where: { id: enrollment.id } });
      await db.student.delete({ where: { id: student.id } });
      await db.halqa.delete({ where: { id: halqa.id } });
      await db.teacher.delete({ where: { id: teacher.id } });
      await db.supervisor.delete({ where: { id: supervisor.id } });
    }
  },
);
