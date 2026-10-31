// Explicit one-time school import. Never seed, rename or merge existing pupils.
import { readFile, writeFile, chmod } from "node:fs/promises";
import { randomInt, createHash } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import { db } from "../src/lib/db";
import { codeLookup, hashCode, verifyCode } from "../src/lib/crypto";
import { dayDate } from "../src/lib/dates";
const source = z.object({
  count: z.literal(57),
  groups: z
    .array(
      z.object({
        id: z.string().startsWith("attendance-"),
        name: z.string().min(1),
        teacherId: z.string().startsWith("attendance-teacher-"),
        teacherName: z.string().min(1),
        students: z.array(
          z.object({
            id: z.string().regex(/^attendance-student-[a-f0-9]{20}$/),
            name: z.string().min(1),
            sourceCell: z.string(),
          }),
        ),
      }),
    )
    .length(3),
});
async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.pathname.slice(1) !== process.env.ATTENDANCE_IMPORT_DATABASE ||
    process.env.ALLOW_ATTENDANCE_IMPORT !== "approved-57-v1"
  )
    throw Error("Explicit approved database/import guard required");
  const rosterBytes = await readFile(process.argv[2]);
  if (
    createHash("sha256").update(rosterBytes).digest("hex") !==
    process.env.ATTENDANCE_ROSTER_SHA256?.toLowerCase()
  )
    throw Error("Roster checksum differs from reviewed source");
  const roster = source.parse(JSON.parse(rosterBytes.toString("utf8")));
  const expected = [
    ["attendance-prep-a", "التأهيلي أ", "أنس البنا", 16],
    ["attendance-prep-b", "التأهيلي ب", "محسن لطفي", 19],
    ["attendance-first-c", "الأول ج", "عبدالرحمن دهبية", 22],
  ];
  for (const [i, g] of roster.groups.entries()) {
    const e = expected[i];
    if (
      g.id !== e[0] ||
      g.name !== e[1] ||
      g.teacherName !== e[2] ||
      g.students.length !== e[3]
    )
      throw Error("Roster differs from approved mapping");
  }
  if (
    roster.groups[1].students.some((s) => s.name === "إبراهيم أحمد") ||
    !roster.groups[2].students.some(
      (s) => s.name === "إبراهيم أحمد كفتراش فيلي",
    )
  )
    throw Error("Approved Ibrahim correction missing");
  if (
    new Set(roster.groups.flatMap((g) => g.students.map((s) => s.id))).size !==
    57
  )
    throw Error("Duplicate pupil identifiers");
  const codePath = resolve(process.argv[3]);
  if (!codePath.endsWith(".json"))
    throw Error("Credential file must use .json extension");
  if (
    url.pathname === "/halqa_followup" &&
    !codePath.startsWith("/opt/halqa-followup-backups/")
  )
    throw Error("Protected credential delivery path required");
  let codes: Record<string, string> = {};
  try {
    codes = JSON.parse(await readFile(codePath, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    for (const g of roster.groups) {
      if (await db.teacher.findUnique({ where: { id: g.teacherId } }))
        throw Error(
          "Teacher exists but credential delivery file is missing; do not reset",
        );
      let code = "";
      do {
        code = String(randomInt(0, 1000000)).padStart(6, "0");
      } while (
        Object.values(codes).includes(code) ||
        (await db.teacher.findUnique({
          where: { codeLookup: codeLookup(code) },
        }))
      );
      codes[g.teacherId] = code;
    }
    await writeFile(codePath, JSON.stringify(codes, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
  }
  await chmod(codePath, 0o600);
  const date = process.env.ATTENDANCE_IMPORT_START_DATE;
  if (
    !date ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    dayDate(date).toISOString().slice(0, 10) !== date
  )
    throw Error("Valid attendance start date required");
  await db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(73412057)::text AS locked`;
      for (const g of roster.groups) {
        const code = codes[g.teacherId];
        if (!/^\d{6}$/.test(code ?? ""))
          throw Error("Invalid protected teacher code");
        const t = await tx.teacher.findUnique({ where: { id: g.teacherId } });
        if (t) {
          if (t.name !== g.teacherName || !verifyCode(code, t.codeHash))
            throw Error(
              "Existing teacher differs; import cannot reset credentials",
            );
        } else {
          if (
            await tx.teacher.findFirst({
              where: {
                OR: [{ name: g.teacherName }, { codeLookup: codeLookup(code) }],
              },
            })
          )
            throw Error(
              "Teacher name or code already belongs to another identity",
            );
          await tx.teacher.create({
            data: {
              id: g.teacherId,
              name: g.teacherName,
              codeLookup: codeLookup(code),
              codeHash: hashCode(code),
            },
          });
        }
        const h = await tx.halqa.findUnique({ where: { id: g.id } });
        if (h) {
          if (
            h.name !== g.name ||
            h.teacherId !== g.teacherId ||
            !h.attendanceOnly ||
            h.attendanceStartsOn?.toISOString().slice(0, 10) !== date
          )
            throw Error("Existing class differs from approved import");
        } else {
          if (await tx.halqa.findFirst({ where: { name: g.name } }))
            throw Error("Class name already exists under another identity");
          await tx.halqa.create({
            data: {
              id: g.id,
              name: g.name,
              teacherId: g.teacherId,
              attendanceOnly: true,
              attendanceStartsOn: dayDate(date),
            },
          });
        }
        for (const [i, s] of g.students.entries()) {
          const existing = await tx.student.findUnique({ where: { id: s.id } });
          if (existing) {
            if (existing.name !== s.name)
              throw Error(
                "Existing pupil name differs; no overwrite permitted",
              );
          } else {
            if (await tx.student.findFirst({ where: { name: s.name } }))
              throw Error(
                "Pupil name matches an existing identity; resolve manually before import",
              );
            await tx.student.create({ data: { id: s.id, name: s.name } });
          }
          const e = await tx.enrollment.findUnique({
            where: { studentId_halqaId: { studentId: s.id, halqaId: g.id } },
          });
          if (e) {
            if (!e.active || e.position !== i)
              throw Error(
                "Enrollment has changed since import; no overwrite permitted",
              );
          } else
            await tx.enrollment.create({
              data: {
                id:
                  "attendance-enrollment-" +
                  s.id.slice("attendance-student-".length),
                studentId: s.id,
                halqaId: g.id,
                position: i,
              },
            });
        }
      }
    },
    { isolationLevel: "Serializable", timeout: 30000 },
  );
  const deliveryPath = codePath.slice(0, -5) + ".txt";
  await writeFile(
    deliveryPath,
    [
      "حسابات معلمي الحضور والغياب",
      "الرابط: https://reports.alrahmakuran.site",
      "",
      ...roster.groups.map(
        (g) =>
          `${g.name}\nالمعلم: أ. ${g.teacherName}\nرمز الدخول: ${codes[g.teacherId]}\n`,
      ),
      "هذه الرموز خاصة بالمعلمين، ولا تحفظ في قاعدة البيانات كنص صريح.",
    ].join("\n"),
    { mode: 0o600 },
  );
  await chmod(deliveryPath, 0o600);
  console.log(
    JSON.stringify({
      imported: true,
      classes: 3,
      teachers: 3,
      students: 57,
      startDate: date,
      codesDeliveredTo: codePath,
      teacherDeliveryFile: deliveryPath,
      noExistingIdentitiesChanged: true,
    }),
  );
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : "Import failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
