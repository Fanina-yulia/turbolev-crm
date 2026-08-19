const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK_RE = /^(\d{1,2}):(\d{2})$/;

function offsetMinutesAt(date: Date, timeZone: string) {
  const value = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
  }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value || "GMT+0";
  const match = value.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  const sign = match[1] === "+" ? 1 : -1;
  return sign * (Number(match[2]) * 60 + Number(match[3] || 0));
}

export function minuteLabel(value: number) {
  const minute = Math.max(0, Math.min(24 * 60, Math.round(value)));
  const hour = Math.floor(minute / 60);
  const rest = minute % 60;
  return `${String(hour).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export function addDateKey(dateKey: string, days: number) {
  const match = DATE_KEY_RE.exec(dateKey);
  if (!match) throw new Error("INVALID_DATE_KEY");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function zonedDateTimeToDate(dateKey: string, clock: string, timeZone = "Europe/Kyiv") {
  const dateMatch = DATE_KEY_RE.exec(dateKey);
  const clockMatch = CLOCK_RE.exec(clock);
  if (!dateMatch || !clockMatch) throw new Error("INVALID_ZONED_DATETIME");

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(clockMatch[1]);
  const minute = Number(clockMatch[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) throw new Error("INVALID_ZONED_DATETIME");

  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let instant = localAsUtc;
  for (let pass = 0; pass < 3; pass += 1) {
    const offset = offsetMinutesAt(new Date(instant), timeZone);
    const next = localAsUtc - offset * 60_000;
    if (next === instant) break;
    instant = next;
  }
  return new Date(instant);
}

export function zonedDayRange(dateKey: string, timeZone = "Europe/Kyiv") {
  return {
    from: zonedDateTimeToDate(dateKey, "00:00", timeZone),
    to: zonedDateTimeToDate(addDateKey(dateKey, 1), "00:00", timeZone),
  };
}

export function zonedDateKey(date = new Date(), timeZone = "Europe/Kyiv") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
