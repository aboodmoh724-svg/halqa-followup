export function englishDigits(value: string) {
  return value.replace(/[٠-٩۰-۹]/g, (c) =>
    String(c.charCodeAt(0) - (c <= "٩" ? 0x660 : 0x6f0)),
  );
}
export const reportNumber = (value: number) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(value);
export const reportPercent = (part: number, total: number) =>
  total
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(
        (part / total) * 100,
      ) + "%"
    : "—";
export function schoolClassCompare(a: { name: string }, b: { name: string }) {
  const rank = (name: string) => {
    const n = name.replace(/[أإآ]/g, "ا");
    if (n.includes("تاهيلي")) return 0;
    const index = [
      "الاول",
      "الثاني",
      "الثالث",
      "الرابع",
      "الخامس",
      "السادس",
    ].findIndex((x) => n.includes(x));
    return index < 0 ? -1 : index + 1;
  };
  const x = rank(a.name),
    y = rank(b.name);
  return (
    (x < 0 ? 99 : x) - (y < 0 ? 99 : y) || a.name.localeCompare(b.name, "ar")
  );
}
