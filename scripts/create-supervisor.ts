import { randomBytes } from "node:crypto";
import { db } from "../src/lib/db";
import {
  hashSupervisorPassword,
  hashSupervisorCode,
  supervisorCodeLookup,
} from "../src/lib/supervisor-auth";
async function main() {
  const username = process.env.SUPERVISOR_USERNAME?.trim().toLowerCase(),
    code = process.env.SUPERVISOR_CODE,
    name = process.env.SUPERVISOR_NAME?.trim();
  if (
    !username ||
    !/^[a-z0-9._-]{3,64}$/.test(username) ||
    !code ||
    !/^\d{8}$/.test(code) ||
    !name ||
    name.length > 100
  )
    throw Error("Invalid supervisor configuration");
  const credential = {
    codeLookup: supervisorCodeLookup(code),
    codeHash: hashSupervisorCode(code),
    name,
    active: true,
  };
  await db.$transaction(async (tx) => {
    const user = await tx.supervisor.upsert({
      where: { username },
      create: {
        username,
        passwordHash: hashSupervisorPassword(randomBytes(32).toString("hex")),
        ...credential,
      },
      update: credential,
    });
    await tx.supervisorSession.deleteMany({ where: { supervisorId: user.id } });
  });
  console.log("Supervisor code saved; previous sessions revoked.");
}
main()
  .catch(() => {
    console.error("Check supervisor configuration and database access.");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
