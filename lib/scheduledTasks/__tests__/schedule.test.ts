import { describe, it, expect } from "vitest";
import {
  computeNextRunAt,
  describeSchedule,
  validateSchedule,
  zonedTimeToUtc,
  type TaskSchedule,
} from "@/lib/scheduledTasks/schedule";

const NY = "America/New_York";

describe("validateSchedule", () => {
  it("accepts valid daily/weekly/monthly schedules", () => {
    expect(validateSchedule({ type: "daily", time: "07:00" })).toBeNull();
    expect(validateSchedule({ type: "weekly", time: "17:00", weekday: 0 })).toBeNull();
    expect(validateSchedule({ type: "monthly", time: "09:30", day: 1 })).toBeNull();
  });

  it("rejects bad types, times, weekdays, and days", () => {
    expect(validateSchedule(null)).not.toBeNull();
    expect(validateSchedule({ type: "hourly", time: "07:00" })).not.toBeNull();
    expect(validateSchedule({ type: "daily", time: "25:00" })).not.toBeNull();
    expect(validateSchedule({ type: "daily", time: "7am" })).not.toBeNull();
    expect(validateSchedule({ type: "weekly", time: "07:00" })).not.toBeNull();
    expect(validateSchedule({ type: "weekly", time: "07:00", weekday: 7 })).not.toBeNull();
    expect(validateSchedule({ type: "monthly", time: "07:00", day: 0 })).not.toBeNull();
    expect(validateSchedule({ type: "monthly", time: "07:00", day: 32 })).not.toBeNull();
  });
});

describe("zonedTimeToUtc", () => {
  it("converts EST wall time (UTC-5)", () => {
    // Jan 15 2026, 07:00 New York = 12:00 UTC
    const d = zonedTimeToUtc(2026, 1, 15, 7, 0, NY);
    expect(d.toISOString()).toBe("2026-01-15T12:00:00.000Z");
  });

  it("converts EDT wall time (UTC-4)", () => {
    // Jul 15 2026, 07:00 New York = 11:00 UTC
    const d = zonedTimeToUtc(2026, 7, 15, 7, 0, NY);
    expect(d.toISOString()).toBe("2026-07-15T11:00:00.000Z");
  });

  it("handles UTC itself", () => {
    const d = zonedTimeToUtc(2026, 6, 1, 12, 30, "UTC");
    expect(d.toISOString()).toBe("2026-06-01T12:30:00.000Z");
  });
});

describe("computeNextRunAt", () => {
  const daily7am: TaskSchedule = { type: "daily", time: "07:00" };

  it("daily: today if the time hasn't passed yet", () => {
    // 05:00 NY on Jun 10 2026 (EDT) = 09:00 UTC
    const after = new Date("2026-06-10T09:00:00.000Z");
    const next = computeNextRunAt(daily7am, NY, after);
    expect(next.toISOString()).toBe("2026-06-10T11:00:00.000Z"); // 07:00 EDT
  });

  it("daily: tomorrow if the time already passed", () => {
    // 08:00 NY on Jun 10 2026 = 12:00 UTC
    const after = new Date("2026-06-10T12:00:00.000Z");
    const next = computeNextRunAt(daily7am, NY, after);
    expect(next.toISOString()).toBe("2026-06-11T11:00:00.000Z");
  });

  it("daily: strictly after — an exact-match instant rolls to the next day", () => {
    const after = new Date("2026-06-10T11:00:00.000Z"); // exactly 07:00 EDT
    const next = computeNextRunAt(daily7am, NY, after);
    expect(next.toISOString()).toBe("2026-06-11T11:00:00.000Z");
  });

  it("weekly: lands on the requested weekday", () => {
    const sunday5pm: TaskSchedule = { type: "weekly", time: "17:00", weekday: 0 };
    // Wed Jun 10 2026 → next Sunday is Jun 14
    const after = new Date("2026-06-10T12:00:00.000Z");
    const next = computeNextRunAt(sunday5pm, NY, after);
    expect(next.toISOString()).toBe("2026-06-14T21:00:00.000Z"); // 17:00 EDT
    expect(next.getUTCDay()).toBe(0);
  });

  it("weekly: same weekday later time runs today", () => {
    const wed2pm: TaskSchedule = { type: "weekly", time: "14:00", weekday: 3 };
    // Wed Jun 10 2026 08:00 NY
    const after = new Date("2026-06-10T12:00:00.000Z");
    const next = computeNextRunAt(wed2pm, NY, after);
    expect(next.toISOString()).toBe("2026-06-10T18:00:00.000Z");
  });

  it("monthly: next month when this month's day has passed", () => {
    const first9am: TaskSchedule = { type: "monthly", time: "09:00", day: 1 };
    const after = new Date("2026-06-10T12:00:00.000Z");
    const next = computeNextRunAt(first9am, NY, after);
    expect(next.toISOString()).toBe("2026-07-01T13:00:00.000Z"); // Jul 1, 09:00 EDT
  });

  it("monthly: day 31 skips short months", () => {
    const thirtyFirst: TaskSchedule = { type: "monthly", time: "09:00", day: 31 };
    // After Jan 31 2026 — Feb has no 31st, so next is Mar 31
    const after = new Date("2026-02-01T00:00:00.000Z");
    const next = computeNextRunAt(thirtyFirst, NY, after);
    expect(next.toISOString().startsWith("2026-03-31")).toBe(true);
  });

  it("crosses the spring DST boundary correctly", () => {
    // DST starts Mar 8 2026 in the US. 07:00 NY on Mar 7 = 12:00 UTC (EST);
    // on Mar 8 it must be 11:00 UTC (EDT).
    const after = new Date("2026-03-07T13:00:00.000Z"); // past 07:00 EST Mar 7
    const next = computeNextRunAt(daily7am, NY, after);
    expect(next.toISOString()).toBe("2026-03-08T11:00:00.000Z");
  });

  it("throws on an invalid schedule", () => {
    expect(() =>
      computeNextRunAt({ type: "weekly", time: "07:00" } as TaskSchedule, NY)
    ).toThrow();
  });
});

describe("describeSchedule", () => {
  it("formats daily, weekly, and monthly", () => {
    expect(describeSchedule({ type: "daily", time: "07:00" })).toBe("every day at 7:00 AM");
    expect(describeSchedule({ type: "weekly", time: "17:00", weekday: 0 })).toBe("every Sunday at 5:00 PM");
    expect(describeSchedule({ type: "monthly", time: "12:00", day: 1 })).toBe("on the 1st of each month at 12:00 PM");
    expect(describeSchedule({ type: "monthly", time: "00:30", day: 22 })).toBe("on the 22nd of each month at 12:30 AM");
  });
});
