ALTER TABLE "Assignment" ADD COLUMN "autoMemorizationStatusId" TEXT, ADD COLUMN "memorizationManual" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Assignment" SET "memorizationManual" = true WHERE "memorization" IS NOT NULL;
