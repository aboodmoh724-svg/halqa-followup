-- Existing records retain their original two-activity track.
ALTER TABLE "Enrollment" ADD COLUMN "reviewOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DailyStudentStatus" ADD COLUMN "reviewOnly" BOOLEAN NOT NULL DEFAULT false;
