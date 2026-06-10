// Pure schedule math for standing tasks — no server imports, fully unit-tested.
//
// Schedules are structured recurrence (not cron expressions — no parser
// dependency, validatable at write time): a wall-clock time in the task's IANA
// timezone plus a daily/weekly/monthly rule. next_run_at is computed in UTC at
// write time and after every run, so the cron dispatcher is a single indexed
// `next_run_at <= now()` query.

export interface TaskSchedule {
  type: "daily" | "weekly" | "monthly";
  /** Wall-clock "HH:MM" (24h) in the task's timezone. */
  time: string;
  /** 0 (Sunday) – 6 (Saturday). Required for weekly. */
  weekday?: number;
  /** 1–31. Required for monthly. Days a month lacks are skipped (31st → only 31-day months). */
  day?: number;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Returns an error message, or null when the schedule is valid. */
export function validateSchedule(s: unknown): string | null {
  if (!s || typeof s !== "object") return "schedule must be an object";
  const sched = s as Record<string, unknown>;
  if (sched.type !== "daily" && sched.type !== "weekly" && sched.type !== "monthly") {
    return 'schedule.type must be "daily", "weekly", or "monthly"';
  }
  if (typeof sched.time !== "string" || !TIME_RE.test(sched.time)) {
    return 'schedule.time must be "HH:MM" (24-hour)';
  }
  if (sched.type === "weekly") {
    if (typeof sched.weekday !== "number" || sched.weekday < 0 || sched.weekday > 6 || !Number.isInteger(sched.weekday)) {
      return "schedule.weekday must be an integer 0 (Sunday) through 6 (Saturday) for weekly schedules";
    }
  }
  if (sched.type === "monthly") {
    if (typeof sched.day !== "number" || sched.day < 1 || sched.day > 31 || !Number.isInteger(sched.day)) {
      return "schedule.day must be an integer 1 through 31 for monthly schedules";
    }
  }
  return null;
}

function tzParts(date: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts: Record<string, number> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = parseInt(p.value, 10);
  }
  return parts as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Milliseconds the zone is ahead of UTC at the given instant. */
function tzOffsetMs(date: Date, timeZone: string): number {
  const p = tzParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

/**
 * The UTC instant for a wall-clock time in a timezone. Two offset passes
 * handle DST boundaries (the first guess can land on the wrong side of a
 * transition; the second corrects it).
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let utc = naive - tzOffsetMs(new Date(naive), timeZone);
  utc = naive - tzOffsetMs(new Date(utc), timeZone);
  return new Date(utc);
}

/**
 * The next occurrence of the schedule strictly after `after`, in UTC.
 * Scans forward day-by-day from `after`'s local date (62-day horizon covers
 * every monthly case, including day-31 across short months).
 */
export function computeNextRunAt(
  schedule: TaskSchedule,
  timeZone: string,
  after: Date = new Date()
): Date {
  const err = validateSchedule(schedule);
  if (err) throw new Error(err);
  const [hh, mm] = schedule.time.split(":").map(Number);
  const start = tzParts(after, timeZone);

  for (let i = 0; i <= 62; i++) {
    // Local calendar date = start date + i days, via UTC date arithmetic
    // (Date.UTC normalizes day overflow across month/year boundaries).
    const cand = new Date(Date.UTC(start.year, start.month - 1, start.day + i));
    const y = cand.getUTCFullYear();
    const mo = cand.getUTCMonth() + 1;
    const d = cand.getUTCDate();
    if (schedule.type === "weekly" && cand.getUTCDay() !== schedule.weekday) continue;
    if (schedule.type === "monthly" && d !== schedule.day) continue;
    const runAt = zonedTimeToUtc(y, mo, d, hh, mm, timeZone);
    if (runAt.getTime() > after.getTime()) return runAt;
  }
  throw new Error("Could not compute next run time within 62 days");
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Human-readable schedule, e.g. "every Sunday at 5:00 PM". */
export function describeSchedule(schedule: TaskSchedule): string {
  const [hh, mm] = schedule.time.split(":").map(Number);
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  const ampm = hh < 12 ? "AM" : "PM";
  const time = `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;
  if (schedule.type === "daily") return `every day at ${time}`;
  if (schedule.type === "weekly") return `every ${WEEKDAYS[schedule.weekday ?? 0]} at ${time}`;
  return `on the ${ordinal(schedule.day ?? 1)} of each month at ${time}`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
