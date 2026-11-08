/**
 * Timezone-aware calendar helpers with no dependencies.
 * A "date string" is always a local calendar day: "YYYY-MM-DD".
 */

export type DateString = string;

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string) {
  let f = partsFormatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    partsFormatterCache.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

export function localParts(instant: Date, timeZone: string): LocalParts {
  const map: Record<string, string> = {};
  for (const p of partsFormatter(timeZone).formatToParts(instant)) map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: WEEKDAYS.indexOf(map.weekday ?? "Sun"),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function toDateString(year: number, month: number, day: number): DateString {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function localDate(instant: Date, timeZone: string): DateString {
  const p = localParts(instant, timeZone);
  return toDateString(p.year, p.month, p.day);
}

function parseDateString(d: DateString): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) throw new Error(`Invalid date string: ${d}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function addDays(d: DateString, days: number): DateString {
  const [y, m, day] = parseDateString(d);
  const t = new Date(Date.UTC(y, m - 1, day + days));
  return toDateString(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(d: DateString): number {
  const [y, m, day] = parseDateString(d);
  return new Date(Date.UTC(y, m - 1, day)).getUTCDay();
}

/** Whole days from a to b (b − a). */
export function diffDays(a: DateString, b: DateString): number {
  const [y1, m1, d1] = parseDateString(a);
  const [y2, m2, d2] = parseDateString(b);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** Monday of the week containing d. */
export function startOfWeek(d: DateString): DateString {
  const wd = weekdayOf(d);
  return addDays(d, wd === 0 ? -6 : 1 - wd);
}

/** Converts a local wall-clock time in `timeZone` to a UTC instant. */
export function zonedTimeToUtc(d: DateString, time: string, timeZone: string): Date {
  const [y, m, day] = parseDateString(d);
  const tm = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!tm) throw new Error(`Invalid time: ${time}`);
  const hour = Number(tm[1]);
  const minute = Number(tm[2]);
  const wall = Date.UTC(y, m - 1, day, hour, minute);
  let guess = wall;
  // Two passes handle DST transitions.
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), timeZone);
    const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += wall - asIfUtc;
  }
  return new Date(guess);
}

/** Start of a local day as a UTC instant. */
export function startOfLocalDay(d: DateString, timeZone: string): Date {
  return zonedTimeToUtc(d, "00:00", timeZone);
}

export function formatTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(instant);
}

export function formatDay(d: DateString, today: DateString): string {
  const delta = diffDays(today, d);
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  if (delta === -1) return "Yesterday";
  const [y, m, day] = parseDateString(d);
  const date = new Date(Date.UTC(y, m - 1, day));
  if (delta > 1 && delta < 7) return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(date);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

export function greetingFor(hour: number): string {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
