-- Defense in depth: canonical Hafs chapter bounds for actual recitations.
CREATE FUNCTION quran_ayah_limit(surah integer) RETURNS integer
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT (ARRAY[7,286,200,176,120,165,206,75,129,109,123,111,43,52,99,128,111,110,98,135,112,78,118,64,77,227,93,88,69,60,34,30,73,54,45,83,182,88,75,85,54,53,89,59,37,35,38,29,18,45,60,49,62,55,78,96,29,22,24,13,14,11,11,18,12,12,30,52,52,44,28,28,20,56,40,31,50,40,46,42,29,19,36,25,22,17,19,26,30,20,15,21,11,8,8,19,5,8,8,11,11,8,3,9,5,4,7,3,6,3,5,4,5,6])[surah];
$$;
ALTER TABLE "RecitationEntry" ADD CONSTRAINT "valid_quran_range" CHECK (
  "startSurah" BETWEEN 1 AND 114 AND "endSurah" BETWEEN 1 AND 114
  AND "startAyah" BETWEEN 1 AND quran_ayah_limit("startSurah")
  AND "endAyah" BETWEEN 1 AND quran_ayah_limit("endSurah")
  AND ("endSurah" > "startSurah" OR ("endSurah" = "startSurah" AND "endAyah" >= "startAyah"))
);
ALTER TABLE "RecitationEntry" ADD CONSTRAINT "versioned_page_amount" CHECK (
  ("pageAmount" IS NULL AND "pageMappingVersion" IS NULL)
  OR ("pageAmount" IS NOT NULL AND "pageAmount" >= 0 AND "pageMappingVersion" IS NOT NULL)
);
ALTER TABLE "DailyStudentStatus" ADD CONSTRAINT "bounded_daily_note" CHECK (length(note) <= 500);
ALTER TABLE "Assignment" ADD CONSTRAINT "bounded_assignment_text" CHECK (length(note) <= 500 AND length("imageName") <= 100);
