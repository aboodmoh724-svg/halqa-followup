import { z } from "zod";
// Tanzil/Quran chapter metadata: canonical Hafs verse counts; no page estimates.
const names =
  "الفاتحة,البقرة,آل عمران,النساء,المائدة,الأنعام,الأعراف,الأنفال,التوبة,يونس,هود,يوسف,الرعد,إبراهيم,الحجر,النحل,الإسراء,الكهف,مريم,طه,الأنبياء,الحج,المؤمنون,النور,الفرقان,الشعراء,النمل,القصص,العنكبوت,الروم,لقمان,السجدة,الأحزاب,سبأ,فاطر,يس,الصافات,ص,الزمر,غافر,فصلت,الشورى,الزخرف,الدخان,الجاثية,الأحقاف,محمد,الفتح,الحجرات,ق,الذاريات,الطور,النجم,القمر,الرحمن,الواقعة,الحديد,المجادلة,الحشر,الممتحنة,الصف,الجمعة,المنافقون,التغابن,الطلاق,التحريم,الملك,القلم,الحاقة,المعارج,نوح,الجن,المزمل,المدثر,القيامة,الإنسان,المرسلات,النبأ,النازعات,عبس,التكوير,الانفطار,المطففين,الانشقاق,البروج,الطارق,الأعلى,الغاشية,الفجر,البلد,الشمس,الليل,الضحى,الشرح,التين,العلق,القدر,البينة,الزلزلة,العاديات,القارعة,التكاثر,العصر,الهمزة,الفيل,قريش,الماعون,الكوثر,الكافرون,النصر,المسد,الإخلاص,الفلق,الناس".split(
    ",",
  );
const counts = [
  7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111,
  110, 98, 135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45,
  83, 182, 88, 75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55,
  78, 96, 29, 22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20,
  56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25, 22, 17, 19, 26, 30, 20, 15, 21,
  11, 8, 8, 19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6,
];
export const surahs = names.map((name, i) => ({
  id: i + 1,
  name,
  ayahs: counts[i],
}));
export const rangeSchema = z
  .object({
    startSurah: z.number().int().min(1).max(114),
    startAyah: z.number().int().min(1),
    endSurah: z.number().int().min(1).max(114),
    endAyah: z.number().int().min(1),
  })
  .superRefine((r, ctx) => {
    if (r.startAyah > counts[r.startSurah - 1])
      ctx.addIssue({
        code: "custom",
        path: ["startAyah"],
        message: "آية البداية غير صحيحة لهذه السورة",
      });
    if (r.endAyah > counts[r.endSurah - 1])
      ctx.addIssue({
        code: "custom",
        path: ["endAyah"],
        message: "آية النهاية غير صحيحة لهذه السورة",
      });
    if (
      r.endSurah < r.startSurah ||
      (r.endSurah === r.startSurah && r.endAyah < r.startAyah)
    )
      ctx.addIssue({
        code: "custom",
        message: "نهاية المدى يجب أن تأتي بعد بدايته",
      });
  });
export type QuranRange = z.infer<typeof rangeSchema>;
export function rangeText(r: QuranRange | null | undefined) {
  if (!r) return "لم يحدد";
  return r.startSurah === r.endSurah
    ? `${names[r.startSurah - 1]} ${r.startAyah} – ${r.endAyah}`
    : `${names[r.startSurah - 1]} ${r.startAyah} إلى ${names[r.endSurah - 1]} ${r.endAyah}`;
}
export function ayahAmount(r: QuranRange) {
  rangeSchema.parse(r);
  if (r.startSurah === r.endSurah) return r.endAyah - r.startAyah + 1;
  return (
    counts[r.startSurah - 1] -
    r.startAyah +
    1 +
    counts.slice(r.startSurah, r.endSurah - 1).reduce((a, b) => a + b, 0) +
    r.endAyah
  );
}
// A future verified per-ayah fractional Madani-page map plugs in here.
// Never substitute a touched-page count or a uniform ayah/page estimate.
export interface MadaniPageMap {
  version: string;
  edition: "madani-604";
  fraction(surah: number, ayah: number): number;
}
export function pageAmount(
  r: QuranRange,
  map?: MadaniPageMap,
): { amount: number; version: string } | null {
  rangeSchema.parse(r);
  if (!map) return null;
  let amount = 0;
  for (let s = r.startSurah; s <= r.endSurah; s++)
    for (
      let a = s === r.startSurah ? r.startAyah : 1;
      a <= (s === r.endSurah ? r.endAyah : counts[s - 1]);
      a++
    ) {
      const fraction = map.fraction(s, a);
      if (!Number.isFinite(fraction) || fraction <= 0)
        throw new Error("Incomplete Madani page map");
      amount += fraction;
    }
  return { amount, version: map.version };
}
