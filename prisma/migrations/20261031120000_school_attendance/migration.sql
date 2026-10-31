ALTER TABLE "Halqa" ADD COLUMN "attendanceOnly" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "attendanceStartsOn" DATE;
ALTER TABLE "DailySession" ADD COLUMN "attendanceConfirmedAt" TIMESTAMP(3), ADD COLUMN "attendanceRecordedBy" TEXT;
ALTER TABLE "DailyStudentStatus" ADD COLUMN "attendance" TEXT;
CREATE TABLE "AttendanceEdit" ("id" TEXT NOT NULL,"halqaId" TEXT NOT NULL,"date" DATE NOT NULL,"actorKind" TEXT NOT NULL,"actorId" TEXT NOT NULL,"actorName" TEXT NOT NULL,"requestKey" TEXT NOT NULL,"payloadHash" TEXT NOT NULL,"before" JSONB NOT NULL,"after" JSONB NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "AttendanceEdit_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "AttendanceEdit_requestKey_key" ON "AttendanceEdit"("requestKey");
CREATE INDEX "AttendanceEdit_halqaId_date_createdAt_idx" ON "AttendanceEdit"("halqaId","date","createdAt");
ALTER TABLE "AttendanceEdit" ADD CONSTRAINT "AttendanceEdit_halqaId_fkey" FOREIGN KEY ("halqaId") REFERENCES "Halqa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
