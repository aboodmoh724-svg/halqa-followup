ALTER TABLE "RecitationEntry" ADD COLUMN "masteryResult" TEXT;
ALTER TABLE "RecitationEntry" ADD CONSTRAINT "recitation_mastery_result_check" CHECK ("masteryResult" IS NULL OR "masteryResult" IN ('MASTERED','NOT_MASTERED'));
CREATE TABLE "MemorizationSequence" (
 "id" TEXT NOT NULL, "enrollmentId" TEXT NOT NULL, "startSurah" INTEGER NOT NULL,
 "startAyah" INTEGER NOT NULL, "initialDirection" "RangeDirection", "anchorEntryId" TEXT,
 "anchorMastered" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "MemorizationSequence_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "memory_sequence_start_check" CHECK ("startSurah" BETWEEN 1 AND 114 AND "startAyah" >= 1)
);
CREATE UNIQUE INDEX "MemorizationSequence_enrollmentId_key" ON "MemorizationSequence"("enrollmentId");
ALTER TABLE "MemorizationSequence" ADD CONSTRAINT "MemorizationSequence_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
