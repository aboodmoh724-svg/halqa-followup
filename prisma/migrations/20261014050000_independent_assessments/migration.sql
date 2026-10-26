ALTER TABLE "DailyStudentStatus" ADD COLUMN "memorizationResult" TEXT, ADD COLUMN "reviewResult" TEXT;
ALTER TABLE "RecitationEntry" ADD COLUMN "assessment" TEXT;
ALTER TABLE "DailyStudentStatus" ADD CONSTRAINT "memorizationResult_allowed" CHECK ("memorizationResult" IS NULL OR "memorizationResult" IN ('MASTERED','NOT_MASTERED','NOT_REQUIRED'));
ALTER TABLE "DailyStudentStatus" ADD CONSTRAINT "reviewResult_allowed" CHECK ("reviewResult" IS NULL OR "reviewResult" IN ('MASTERED','NOT_MASTERED','NOT_REQUIRED'));
ALTER TABLE "RecitationEntry" ADD CONSTRAINT "assessment_allowed" CHECK ("assessment" IS NULL OR "assessment" IN ('MASTERED','NOT_MASTERED'));
