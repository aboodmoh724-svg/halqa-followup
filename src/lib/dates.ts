export function calendarKey(
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
export function dailyWindow(
  now = new Date(),
  timezone = process.env.APP_TIMEZONE || "Europe/Istanbul",
) {
  const calendar = calendarKey(now, timezone);
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
  const previous = new Date(`${calendar}T00:00:00.000Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return {
    date: hour < 6 ? previous.toISOString().slice(0, 10) : calendar,
    writable: hour >= 6,
  };
}
export function dayKey(
  now = new Date(),
  timezone = process.env.APP_TIMEZONE || "Europe/Istanbul",
) {
  return dailyWindow(now, timezone).date;
}
export function dayReadOnlyReason(
  date: string,
  now = new Date(),
  timezone = process.env.APP_TIMEZONE || "Europe/Istanbul",
) {
  const window = dailyWindow(now, timezone);
  if (date !== window.date)
    return "انتهى وقت إدخال هذا التقرير. يبدأ يوم جديد الساعة 6 صباحًا.";
  return window.writable
    ? null
    : "انتهى وقت الإدخال عند منتصف الليل. يبدأ التقرير الجديد الساعة 6 صباحًا.";
}
