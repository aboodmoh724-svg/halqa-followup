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
export function dayDate(key: string = dayKey()): Date {
  return new Date(`${key}T00:00:00.000Z`);
}
export function nextDay(key: string) {
  const d = dayDate(key);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
export function isStudyDay(key: string): boolean {
  const day = dayDate(key).getUTCDay();
  return day >= 1 && day <= 5;
}
export function nextStudyDay(key: string) {
  let date = nextDay(key);
  while (!isStudyDay(date)) date = nextDay(date);
  return date;
}
// Keep already-issued historical Friday reports on their original calendar
// homework date. The school's weekday policy takes effect from this rollout.
export function nextAssignmentDay(key: string) {
  return key < "2026-10-29" ? nextDay(key) : nextStudyDay(key);
}
export function assignmentDateLabel(key: string) {
  return new Intl.DateTimeFormat("ar", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(dayDate(nextAssignmentDay(key)));
}
export function previousStudyDay(key: string) {
  const date = dayDate(key);
  do {
    date.setUTCDate(date.getUTCDate() - 1);
  } while (!isStudyDay(date.toISOString().slice(0, 10)));
  return date.toISOString().slice(0, 10);
}
// At local midnight yesterday has expired; skip weekends, never today's deadline.
export function lastFinishedStudyDay(now = new Date()) {
  return previousStudyDay(calendarKey(now));
}
export function dailyWindow(
  now = new Date(),
  timezone = process.env.APP_TIMEZONE || "Europe/Istanbul",
): { date: string; writable: boolean } {
  const calendar = calendarKey(now, timezone);
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
  return {
    date:
      hour < 6 || !isStudyDay(calendar) ? previousStudyDay(calendar) : calendar,
    writable: hour >= 6 && isStudyDay(calendar),
  };
}
export function dayKey(
  now = new Date(),
  timezone = process.env.APP_TIMEZONE || "Europe/Istanbul",
): string {
  return dailyWindow(now, timezone).date;
}
export function dayReadOnlyReason(
  date: string,
  now = new Date(),
  timezone = process.env.APP_TIMEZONE || "Europe/Istanbul",
) {
  const window = dailyWindow(now, timezone);
  if (!isStudyDay(calendarKey(now, timezone)))
    return "السبت والأحد عطلة؛ يبدأ التسجيل يوم الاثنين الساعة 6 صباحًا.";
  if (date !== window.date)
    return "انتهى وقت إدخال هذا التقرير. يبدأ يوم جديد الساعة 6 صباحًا.";
  return window.writable
    ? null
    : "انتهى وقت الإدخال عند منتصف الليل. يبدأ التقرير الجديد الساعة 6 صباحًا.";
}
