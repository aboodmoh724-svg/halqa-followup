-- CreateEnum
CREATE TYPE "PartExamState" AS ENUM ('SUBMITTED', 'APPROVED', 'RETRY');

-- CreateTable
CREATE TABLE "MemorizationBaseline" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "ranges" JSONB NOT NULL,
    "note" TEXT NOT NULL,
    "supervisorId" TEXT NOT NULL,
    "supervisorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,

    CONSTRAINT "MemorizationBaseline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartExam" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "juz" INTEGER NOT NULL,
    "attempt" INTEGER NOT NULL,
    "teacherId" TEXT NOT NULL,
    "teacherName" TEXT NOT NULL,
    "halqaId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "questions" JSONB NOT NULL,
    "scoreHalfPoints" INTEGER NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "evidenceSnapshot" JSONB NOT NULL,
    "state" "PartExamState" NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "decisionNote" TEXT NOT NULL DEFAULT '',
    "retryOn" DATE,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "requestKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,

    CONSTRAINT "PartExam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamAction" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "supervisorId" TEXT NOT NULL,
    "supervisorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "requestKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemorizationBaseline_studentId_key" ON "MemorizationBaseline"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "MemorizationBaseline_requestKey_key" ON "MemorizationBaseline"("requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "PartExam_requestKey_key" ON "PartExam"("requestKey");

-- CreateIndex
CREATE INDEX "PartExam_state_submittedAt_idx" ON "PartExam"("state", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartExam_studentId_juz_attempt_key" ON "PartExam"("studentId", "juz", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "ExamAction_requestKey_key" ON "ExamAction"("requestKey");

-- CreateIndex
CREATE INDEX "ExamAction_examId_createdAt_idx" ON "ExamAction"("examId", "createdAt");

-- AddForeignKey
ALTER TABLE "MemorizationBaseline" ADD CONSTRAINT "MemorizationBaseline_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartExam" ADD CONSTRAINT "PartExam_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamAction" ADD CONSTRAINT "ExamAction_examId_fkey" FOREIGN KEY ("examId") REFERENCES "PartExam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
