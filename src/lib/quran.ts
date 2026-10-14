import { z } from "zod";
import {
  madaniPageMap,
  roundPages,
  formatPages,
  type PageEntry,
} from "./madani";
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
    direction: z.enum(["FORWARD", "REVERSE"]).optional(),
    startSurah: z
      .number()
      .int("اختر سورة صحيحة")
      .min(1, "اختر سورة صحيحة")
      .max(114, "اختر سورة صحيحة"),
    startAyah: z
      .number()
      .int("رقم آية البداية يجب أن يكون عددًا صحيحًا")
      .min(1, "آية البداية تبدأ من 1"),
    endSurah: z
      .number()
      .int("اختر سورة صحيحة")
      .min(1, "اختر سورة صحيحة")
      .max(114, "اختر سورة صحيحة"),
    endAyah: z
      .number()
      .int("رقم آية النهاية يجب أن يكون عددًا صحيحًا")
      .min(1, "آية النهاية تبدأ من 1"),
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
    if (r.endSurah === r.startSurah && r.endAyah < r.startAyah)
      ctx.addIssue({
        code: "custom",
        message: "داخل السورة، آية النهاية يجب أن تأتي بعد آية البداية",
      });
  })
  .transform((r) => {
    const normalized = { ...r };
    if (r.startSurah > r.endSurah) normalized.direction = "REVERSE";
    else delete normalized.direction;
    return normalized;
  });
export type QuranRange = z.infer<typeof rangeSchema>;
export function rangeText(r: QuranRange | null | undefined) {
  if (!r) return "لم يحدد";
  return r.startSurah === r.endSurah
    ? `${names[r.startSurah - 1]} ${r.startAyah} – ${r.endAyah}`
    : `${names[r.startSurah - 1]} ${r.startAyah} إلى ${names[r.endSurah - 1]} ${r.endAyah}${r.startSurah > r.endSurah ? " · بعكس ترتيب السور" : ""}`;
}
export function rangeSegments(r: QuranRange) {
  rangeSchema.parse(r);
  const step = r.startSurah > r.endSurah ? -1 : 1;
  const segments: { surah: number; startAyah: number; endAyah: number }[] = [];
  for (let surah = r.startSurah; ; surah += step) {
    segments.push({
      surah,
      startAyah: surah === r.startSurah ? r.startAyah : 1,
      endAyah: surah === r.endSurah ? r.endAyah : counts[surah - 1],
    });
    if (surah === r.endSurah) break;
  }
  return segments;
}
export function ayahAmount(r: QuranRange) {
  return rangeSegments(r).reduce(
    (sum, s) => sum + s.endAyah - s.startAyah + 1,
    0,
  );
}
// Offline layout-derived fractional map; method and provenance in docs/madani-pages.md.
export interface MadaniPageMap {
  version: string;
  edition: "madani-604";
  fraction(surah: number, ayah: number): number;
}
export function pageAmount(
  r: QuranRange,
  map: MadaniPageMap = madaniPageMap,
): { amount: number; version: string } | null {
  let amount = 0;
  for (const segment of rangeSegments(r))
    for (let ayah = segment.startAyah; ayah <= segment.endAyah; ayah++) {
      const fraction = map.fraction(segment.surah, ayah);
      if (!Number.isFinite(fraction) || fraction <= 0)
        throw new Error("Incomplete Madani page map");
      amount += fraction;
    }
  return { amount: roundPages(amount), version: map.version };
}

// Existing foundation rows are computed on read, without modifying closed days.
// Persisted amounts retain their original version; never reinterpret them silently.
export function entryPages(entry: PageEntry) {
  if (entry.pageAmount != null && entry.pageMappingVersion)
    return entry.pageAmount;
  if (entry.pageAmount != null || entry.pageMappingVersion)
    throw new Error("Incomplete persisted page calculation");
  return pageAmount(entry)!.amount;
}
export function totalPages(entries: PageEntry[]) {
  return roundPages(entries.reduce((sum, entry) => sum + entryPages(entry), 0));
}
export function amountText(range: QuranRange | null | undefined) {
  return range ? `${formatPages(pageAmount(range)!.amount)} صفحة` : "لم يحدد";
}
export { formatPages };
export function rangeDescription(range: QuranRange | null | undefined) {
  return range ? `${rangeText(range)} · ${amountText(range)}` : "لم يحدد";
}
