import data from "../data/madani-604.json";
import type { QuranRange, MadaniPageMap } from "./quran";

const fractions = new Map<string, number>(
  data.verses.map(([s, a, portions]) => [
    `${s}:${a}`,
    (portions as (number | string)[][]).reduce(
      (sum, [, n, d]) => sum + Number(n) / Number(d),
      0,
    ),
  ]),
);
export const madaniPageMap: MadaniPageMap = {
  edition: "madani-604",
  version: data.version,
  fraction(surah, ayah) {
    const fraction = fractions.get(`${surah}:${ayah}`);
    if (fraction === undefined) throw new Error("Incomplete Madani page map");
    return fraction;
  },
};
// Same precision as PostgreSQL Decimal(8,4). Round after summing a range.
export const roundPages = (amount: number) =>
  Math.round(amount * 10000) / 10000;
export const formatPages = (amount: number) =>
  new Intl.NumberFormat("ar", { maximumFractionDigits: 4 }).format(amount);

export type PageEntry = QuranRange & {
  pageAmount?: number | null;
  pageMappingVersion?: string | null;
};
