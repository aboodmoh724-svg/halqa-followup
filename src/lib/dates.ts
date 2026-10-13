export function dayKey(
  now = new Date(),
  timezone = process.env.APP_TIMEZONE || "Europe/Istanbul",
) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function dayDate(key = dayKey()) {
  return new Date(`${key}T00:00:00.000Z`);
}
export function nextDay(key: string) {
  const d = dayDate(key);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
