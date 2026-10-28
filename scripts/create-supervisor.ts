// Run with environment variables, never password arguments or committed credentials.
import { db } from "../src/lib/db";
import {
  hashSupervisorPassword,
  supervisorLoginSchema,
} from "../src/lib/supervisor-auth";
async function main() {
  const input = supervisorLoginSchema.parse({
    username: process.env.SUPERVISOR_USERNAME,
    password: process.env.SUPERVISOR_PASSWORD,
  });
  const name = process.env.SUPERVISOR_NAME?.trim();
  if (!name || name.length > 100)
    throw Error("SUPERVISOR_NAME is required (max 100)");
  await db.$transaction(async (tx) => {
    const user = await tx.supervisor.upsert({
      where: { username: input.username },
      create: {
        username: input.username,
        name,
        passwordHash: hashSupervisorPassword(input.password),
      },
      update: {
        name,
        passwordHash: hashSupervisorPassword(input.password),
        active: true,
      },
    });
    await tx.supervisorSession.deleteMany({ where: { supervisorId: user.id } });
  });
  console.log("Supervisor account saved; existing sessions revoked.");
}
main()
  .catch(() => {
    console.error("Check supervisor configuration and database access.");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
