import { DateTime } from "luxon";

export type IntervalUnit = "day" | "week" | "month";

export interface ScheduleSpec {
  intervalValue: number;
  intervalUnit: IntervalUnit;
  /** Local wall-clock time "HH:MM" or "HH:MM:SS" in `timezone`. */
  preferredRunTime: string;
  /** IANA time zone, e.g. "America/Chicago". */
  timezone: string;
}

export const DEFAULT_SCHEDULE: Omit<ScheduleSpec, "timezone"> = {
  intervalValue: 7,
  intervalUnit: "day",
  preferredRunTime: "06:00",
};

export const INTERVAL_PRESETS: { label: string; value: number; unit: IntervalUnit }[] = [
  { label: "Daily", value: 1, unit: "day" },
  { label: "Every 3 days", value: 3, unit: "day" },
  { label: "Every 7 days", value: 7, unit: "day" },
  { label: "Every 14 days", value: 14, unit: "day" },
  { label: "Every 30 days", value: 30, unit: "day" },
];

export function isValidTimezone(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid;
}

function parseTime(t: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t);
  if (!m) throw new Error(`Invalid preferred run time: ${t}`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) throw new Error(`Invalid preferred run time: ${t}`);
  return { hour, minute };
}

function validate(spec: ScheduleSpec) {
  if (!Number.isInteger(spec.intervalValue) || spec.intervalValue < 1) {
    throw new Error("Interval must be a positive whole number");
  }
  if (!isValidTimezone(spec.timezone)) throw new Error(`Invalid time zone: ${spec.timezone}`);
}

/** Pins a local date to the preferred wall-clock time (luxon shifts forward across DST gaps). */
function atPreferredTime(local: DateTime, spec: ScheduleSpec): DateTime {
  const { hour, minute } = parseTime(spec.preferredRunTime);
  return local.set({ hour, minute, second: 0, millisecond: 0 });
}

function addInterval(local: DateTime, spec: ScheduleSpec): DateTime {
  const n = spec.intervalValue;
  const advanced =
    spec.intervalUnit === "day" ? local.plus({ days: n })
    : spec.intervalUnit === "week" ? local.plus({ weeks: n })
    : local.plus({ months: n });
  return atPreferredTime(advanced, spec);
}

/**
 * First run for a newly created or re-configured schedule: the next occurrence of the
 * preferred local time that is strictly after `now`.
 */
export function firstRunAt(spec: ScheduleSpec, now: Date): Date {
  validate(spec);
  const localNow = DateTime.fromJSDate(now, { zone: spec.timezone });
  let candidate = atPreferredTime(localNow, spec);
  if (candidate <= localNow) candidate = atPreferredTime(localNow.plus({ days: 1 }), spec);
  return candidate.toUTC().toJSDate();
}

export interface AdvanceResult {
  /** Next scheduled execution (UTC), always strictly after `now`. */
  nextRunAt: Date;
  /** Number of scheduled slots that were skipped because they were missed. */
  missedSlots: number;
}

/**
 * Called when a scheduled slot fires (or is found overdue). Advances from the slot that was
 * due — not from `now` — so the cadence does not drift. Missed slots are counted but never
 * backfilled: the caller enqueues one recovery run at most.
 */
export function advanceSchedule(spec: ScheduleSpec, dueAt: Date, now: Date): AdvanceResult {
  validate(spec);
  const localNow = DateTime.fromJSDate(now, { zone: spec.timezone });
  let next = addInterval(DateTime.fromJSDate(dueAt, { zone: spec.timezone }), spec);
  let missedSlots = 0;
  // Bounded loop: at most ~365 iterations for a daily schedule a year overdue.
  for (let i = 0; next <= localNow && i < 5000; i++) {
    missedSlots++;
    next = addInterval(next, spec);
  }
  return { nextRunAt: next.toUTC().toJSDate(), missedSlots };
}

export function describeInterval(value: number, unit: IntervalUnit): string {
  if (unit === "day" && value === 1) return "Daily";
  if (unit === "week" && value === 1) return "Weekly";
  if (unit === "month" && value === 1) return "Monthly";
  return `Every ${value} ${unit}s`;
}
