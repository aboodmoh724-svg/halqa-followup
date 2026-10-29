CREATE TABLE "StudentTransfer" (
 "sequence" SERIAL NOT NULL,
 "id" TEXT NOT NULL,
 "studentId" TEXT NOT NULL,
 "sourceEnrollmentId" TEXT NOT NULL,
 "targetEnrollmentId" TEXT NOT NULL,
 "sourceHalqaId" TEXT NOT NULL,
 "targetHalqaId" TEXT NOT NULL,
 "supervisorId" TEXT NOT NULL,
 "requestKey" TEXT NOT NULL,
 "before" JSONB NOT NULL,
 "after" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "StudentTransfer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudentTransfer_sequence_key" ON "StudentTransfer"("sequence");
CREATE UNIQUE INDEX "StudentTransfer_requestKey_key" ON "StudentTransfer"("requestKey");
CREATE INDEX "StudentTransfer_studentId_createdAt_idx" ON "StudentTransfer"("studentId", "createdAt");
