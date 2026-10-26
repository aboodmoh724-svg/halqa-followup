import { PrismaClient } from "@prisma/client";
import { codeLookup, hashCode } from "../src/lib/crypto";
import { dayDate, dayKey } from "../src/lib/dates";
const db = new PrismaClient();
async function main() {
  const code = process.env.SEED_TEACHER_CODE;
  if (!code || !/^(?:\d{4}|\d{6})$/.test(code))
    throw new Error("Set SEED_TEACHER_CODE to a four- or six-digit code");
  const teacher = await db.teacher.upsert({
    where: { id: "seed-teacher" },
    update: {},
    create: {
      id: "seed-teacher",
      name: "أحمد عبد الرحمن",
      codeLookup: codeLookup(code),
      codeHash: hashCode(code),
    },
  });
  const halqa = await db.halqa.upsert({
    where: { id: "seed-halqa" },
    update: {},
    create: { id: "seed-halqa", name: "حلقة الرحمة", teacherId: teacher.id },
  });
  const names = [
    "محمد أحمد علي",
    "عبد الرحمن خالد",
    "عمر محمود حسن",
    "يوسف إبراهيم",
    "أنس عبد الله",
    "إبراهيم مصطفى",
  ];
  for (const [i, name] of names.entries()) {
    const student = await db.student.upsert({
      where: { id: `seed-student-${i}` },
      update: {},
      create: { id: `seed-student-${i}`, name },
    });
    const enrollment = await db.enrollment.upsert({
      where: {
        studentId_halqaId: { studentId: student.id, halqaId: halqa.id },
      },
      update: {},
      create: { studentId: student.id, halqaId: halqa.id, position: i },
    });
    await db.assignment.upsert({
      where: {
        enrollmentId_dueDate: {
          enrollmentId: enrollment.id,
          dueDate: dayDate(dayKey()),
        },
      },
      update: {},
      create: {
        enrollmentId: enrollment.id,
        dueDate: dayDate(),
        memorization: {
          startSurah: 67,
          startAyah: 10,
          endSurah: 67,
          endAyah: 20,
        },
        review: { startSurah: 68, startAyah: 1, endSurah: 68, endAyah: 25 },
        imageName: "17",
      },
    });
  }
  console.log(
    "Seed complete. Teacher code is the value you supplied; it is never logged.",
  );
}
main().finally(() => db.$disconnect());
