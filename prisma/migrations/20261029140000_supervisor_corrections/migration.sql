CREATE TABLE "SupervisorCorrection" (
 "id" TEXT NOT NULL,
 "supervisorId" TEXT NOT NULL,
 "halqaId" TEXT NOT NULL,
 "enrollmentId" TEXT NOT NULL,
 "date" DATE NOT NULL,
 "action" TEXT NOT NULL,
 "before" JSONB NOT NULL,
 "after" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "SupervisorCorrection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupervisorCorrection_enrollmentId_date_createdAt_idx" ON "SupervisorCorrection"("enrollmentId", "date", "createdAt");
