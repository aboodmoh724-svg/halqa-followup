CREATE TABLE "Supervisor" (
 "id" TEXT NOT NULL, "username" TEXT NOT NULL, "name" TEXT NOT NULL,
 "passwordHash" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
 CONSTRAINT "Supervisor_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Supervisor_username_key" ON "Supervisor"("username");
CREATE TABLE "SupervisorSession" (
 "id" TEXT NOT NULL, "supervisorId" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "SupervisorSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupervisorSession_expiresAt_idx" ON "SupervisorSession"("expiresAt");
ALTER TABLE "SupervisorSession" ADD CONSTRAINT "SupervisorSession_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "Supervisor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
