CREATE TYPE "RangeDirection" AS ENUM ('FORWARD', 'REVERSE');
ALTER TABLE "RecitationEntry" ADD COLUMN "direction" "RangeDirection" NOT NULL DEFAULT 'FORWARD';
ALTER TABLE "RecitationEntry" DROP CONSTRAINT "valid_quran_range";
ALTER TABLE "RecitationEntry" ADD CONSTRAINT "valid_quran_range" CHECK (
 "startSurah" BETWEEN 1 AND 114 AND "endSurah" BETWEEN 1 AND 114
 AND "startAyah" BETWEEN 1 AND quran_ayah_limit("startSurah")
 AND "endAyah" BETWEEN 1 AND quran_ayah_limit("endSurah")
 AND (("startSurah" = "endSurah" AND "endAyah" >= "startAyah")
 OR ("direction" = 'FORWARD' AND "endSurah" > "startSurah")
 OR ("direction" = 'REVERSE' AND "endSurah" < "startSurah"))
);
