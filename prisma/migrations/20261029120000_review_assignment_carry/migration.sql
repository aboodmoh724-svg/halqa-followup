ALTER TABLE "Assignment"
  ADD COLUMN "autoReviewStatusId" TEXT,
  ADD COLUMN "reviewManual" BOOLEAN NOT NULL DEFAULT false;
