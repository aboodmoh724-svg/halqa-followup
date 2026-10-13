-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Outcome" AS ENUM ('MEMORIZED', 'NOT_MEMORIZED', 'ABSENT');

-- CreateEnum
CREATE TYPE "RecitationKind" AS ENUM ('MEMORIZATION', 'REVIEW');

-- CreateTable
CREATE TABLE "Teacher" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "codeLookup" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,

    CONSTRAINT "Teacher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherSession" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeacherSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginBucket" (
    "key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoginBucket_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Halqa" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,

    CONSTRAINT "Halqa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "halqaId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailySession" (
    "id" TEXT NOT NULL,
    "halqaId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "DailySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyStudentStatus" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "halqaId" TEXT NOT NULL,
    "outcome" "Outcome",
    "note" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyStudentStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecitationEntry" (
    "id" TEXT NOT NULL,
    "dailyStatusId" TEXT NOT NULL,
    "kind" "RecitationKind" NOT NULL,
    "startSurah" INTEGER NOT NULL,
    "startAyah" INTEGER NOT NULL,
    "endSurah" INTEGER NOT NULL,
    "endAyah" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pageAmount" DECIMAL(8,4),
    "pageMappingVersion" TEXT,
    "requestKey" TEXT NOT NULL,

    CONSTRAINT "RecitationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "memorization" JSONB,
    "review" JSONB,
    "note" TEXT NOT NULL DEFAULT '',
    "imageName" TEXT NOT NULL DEFAULT '',
    "carriedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_codeLookup_key" ON "Teacher"("codeLookup");

-- CreateIndex
CREATE INDEX "TeacherSession_expiresAt_idx" ON "TeacherSession"("expiresAt");

-- CreateIndex
CREATE INDEX "Halqa_teacherId_idx" ON "Halqa"("teacherId");

-- CreateIndex
CREATE INDEX "Enrollment_halqaId_active_idx" ON "Enrollment"("halqaId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_studentId_halqaId_key" ON "Enrollment"("studentId", "halqaId");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_id_halqaId_key" ON "Enrollment"("id", "halqaId");

-- CreateIndex
CREATE UNIQUE INDEX "DailySession_halqaId_date_key" ON "DailySession"("halqaId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailySession_id_halqaId_key" ON "DailySession"("id", "halqaId");

-- CreateIndex
CREATE INDEX "DailyStudentStatus_enrollmentId_halqaId_idx" ON "DailyStudentStatus"("enrollmentId", "halqaId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyStudentStatus_sessionId_enrollmentId_key" ON "DailyStudentStatus"("sessionId", "enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "RecitationEntry_requestKey_key" ON "RecitationEntry"("requestKey");

-- CreateIndex
CREATE INDEX "RecitationEntry_dailyStatusId_createdAt_idx" ON "RecitationEntry"("dailyStatusId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_enrollmentId_dueDate_key" ON "Assignment"("enrollmentId", "dueDate");

-- AddForeignKey
ALTER TABLE "TeacherSession" ADD CONSTRAINT "TeacherSession_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Halqa" ADD CONSTRAINT "Halqa_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_halqaId_fkey" FOREIGN KEY ("halqaId") REFERENCES "Halqa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySession" ADD CONSTRAINT "DailySession_halqaId_fkey" FOREIGN KEY ("halqaId") REFERENCES "Halqa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyStudentStatus" ADD CONSTRAINT "DailyStudentStatus_sessionId_halqaId_fkey" FOREIGN KEY ("sessionId", "halqaId") REFERENCES "DailySession"("id", "halqaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyStudentStatus" ADD CONSTRAINT "DailyStudentStatus_enrollmentId_halqaId_fkey" FOREIGN KEY ("enrollmentId", "halqaId") REFERENCES "Enrollment"("id", "halqaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecitationEntry" ADD CONSTRAINT "RecitationEntry_dailyStatusId_fkey" FOREIGN KEY ("dailyStatusId") REFERENCES "DailyStudentStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_carriedFromId_fkey" FOREIGN KEY ("carriedFromId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
