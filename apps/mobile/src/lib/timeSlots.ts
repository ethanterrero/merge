// Pure helpers for the departure time picker. Departures are stored as the
// picker display string ('7:45 AM', see CommuteDraft.departure); these convert
// it to and from minutes, 5-minute slots and the Date the native picker uses.
// Parsing and formatting go through parseTime/formatTime in ./dates.

import { formatTime, parseTime } from './dates';

/** Departures move in 5-minute steps. */
export const SLOT_STEP_MINUTES = 5;
/** The web slot list covers the morning commute: 5:00 to 10:00 AM. */
export const SLOT_START_MINUTES = 5 * 60;
export const SLOT_END_MINUTES = 10 * 60;

const MINUTES_PER_DAY = 24 * 60;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** '7:45 AM' → 465. Throws a RangeError for anything that isn't a picker time. */
export function departureMinutes(display: string): number {
  const [hours, minutes] = parseTime(display).split(':').map(Number);
  return hours * 60 + minutes;
}

/** 465 → '7:45 AM'. */
export function minutesToDeparture(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= MINUTES_PER_DAY) {
    throw new RangeError(`Not minutes since midnight: ${minutes}`);
  }
  return formatTime(`${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`);
}

/** Rounds to the nearest `step` minutes (halves round up), wrapping past midnight. */
export function snapMinutes(minutes: number, step: number = SLOT_STEP_MINUTES): number {
  if (!Number.isInteger(step) || step <= 0) throw new RangeError(`Bad step: ${step}`);
  const snapped = Math.round(minutes / step) * step;
  return ((snapped % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** Every `step` minutes from `start` to `end` inclusive, as picker times. */
export function departureSlots(
  start: number = SLOT_START_MINUTES,
  end: number = SLOT_END_MINUTES,
  step: number = SLOT_STEP_MINUTES,
): string[] {
  if (end < start) throw new RangeError(`Slot range ends before it starts: ${start}–${end}`);
  const slots: string[] = [];
  for (let m = start; m <= end; m += step) slots.push(minutesToDeparture(m));
  return slots;
}

/**
 * `slots` with `current` added in time order when it isn't already listed, so
 * a departure outside the slot range still shows as selected. Returns `slots`
 * itself when there's nothing to add (or `current` isn't a picker time).
 */
export function slotsWith(slots: string[], current: string): string[] {
  if (slots.includes(current)) return slots;
  let at: number;
  try {
    at = departureMinutes(current);
  } catch {
    return slots;
  }
  const index = slots.findIndex((s) => departureMinutes(s) > at);
  return index === -1 ? [...slots, current] : [...slots.slice(0, index), current, ...slots.slice(index)];
}

/** The departure as a Date on `base`'s local calendar day, for the native picker. */
export function departureToDate(display: string, base: Date): Date {
  const minutes = departureMinutes(display);
  const date = new Date(base.getTime());
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date;
}

/** The local wall-clock time of a picker Date, snapped to `step`, as a picker time. */
export function dateToDeparture(date: Date, step: number = SLOT_STEP_MINUTES): string {
  return minutesToDeparture(snapMinutes(date.getHours() * 60 + date.getMinutes(), step));
}
