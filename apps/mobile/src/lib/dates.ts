// Pure date, time and weekday helpers shared by screens and data code. Commutes
// are in America/Los_Angeles, but nothing here reads the clock or a time zone:
// callers pass "today" as a 'YYYY-MM-DD' LA calendar date and, where needed, the
// LA wall-clock time as minutes since midnight. Ride dates are calendar-date
// strings, and day arithmetic runs on date-only values in UTC, so DST changes
// can't shift a date.

import type { Weekday } from '../data/mock';

/** Drivers must reply by 8 PM LA the evening before a ride (D-02). */
export const REPLY_CUTOFF_MINUTES = 20 * 60;
/** Cancellations close at 9 PM LA the evening before a ride. */
export const CANCEL_CUTOFF_MINUTES = 21 * 60;

const MINUTES_PER_DAY = 24 * 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Index + 1 is the ISO weekday used by the integer[] columns.
const ISO_WEEKDAYS: Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function weekdayToIso(day: Weekday): number {
  return ISO_WEEKDAYS.indexOf(day) + 1;
}

export function isoToWeekday(iso: number): Weekday {
  const day = ISO_WEEKDAYS[iso - 1];
  if (!Number.isInteger(iso) || day === undefined) throw new RangeError(`Not a commute weekday: ${iso}`);
  return day;
}

/** Sorted, de-duplicated ISO numbers for a `weekdays integer[]` column. */
export function toIsoWeekdays(days: Weekday[]): number[] {
  return [...new Set(days.map(weekdayToIso))].sort((a, b) => a - b);
}

export function fromIsoWeekdays(isos: number[]): Weekday[] {
  return [...new Set(isos)].sort((a, b) => a - b).map(isoToWeekday);
}

/** 'Mon–Thu' for a contiguous run, 'Mon, Wed, Thu' otherwise, 'Tue only' for one day. */
export function formatDays(days: Weekday[]): string {
  const isos = toIsoWeekdays(days);
  if (isos.length === 0) return '';
  if (isos.length === 1) return `${isoToWeekday(isos[0])} only`;
  const first = isos[0];
  const last = isos[isos.length - 1];
  if (last - first === isos.length - 1) return `${isoToWeekday(first)}–${isoToWeekday(last)}`;
  return isos.map(isoToWeekday).join(', ');
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function parsePickerMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/.exec(time.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  const pm = match[3].toUpperCase() === 'PM';
  return ((hour % 12) + (pm ? 12 : 0)) * 60 + minute;
}

function parsePostgresMinutes(time: string): number | null {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59 || Number(match[3] ?? 0) > 59) return null;
  return hour * 60 + minute;
}

/** '7:45 AM' → '07:45:00' for a Postgres `time` column. */
export function parseTime(time: string): string {
  const minutes = parsePickerMinutes(time);
  if (minutes === null) throw new RangeError(`Not a time like '7:45 AM': ${time}`);
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}:00`;
}

/** Postgres '07:45:00' (or '07:45') → '7:45 AM'. Seconds are dropped. */
export function formatTime(time: string): string {
  const minutes = parsePostgresMinutes(time);
  if (minutes === null) throw new RangeError(`Not a Postgres time like '07:45:00': ${time}`);
  return `${clockLabel(minutes)} ${minutes < 12 * 60 ? 'AM' : 'PM'}`;
}

// 12-hour 'H:MM' without AM/PM, wrapping past midnight.
function clockLabel(minutes: number): string {
  const m = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hour = Math.floor(m / 60) % 12 || 12;
  return `${hour}:${pad2(m % 60)}`;
}

/**
 * '7:30–8:00' for a 7:45 departure with 15 minutes of flex. Takes a picker time
 * ('7:45 AM') or a Postgres time ('07:45:00'). Zero flex gives just '7:45'.
 */
export function departureWindow(time: string, flexMinutes: number): string {
  const minutes = parsePickerMinutes(time) ?? parsePostgresMinutes(time);
  if (minutes === null) throw new RangeError(`Not a time: ${time}`);
  if (!Number.isInteger(flexMinutes) || flexMinutes < 0) throw new RangeError(`Bad flex: ${flexMinutes}`);
  if (flexMinutes === 0) return clockLabel(minutes);
  return `${clockLabel(minutes - flexMinutes)}–${clockLabel(minutes + flexMinutes)}`;
}

// 'YYYY-MM-DD' → days since 1970-01-01, rejecting impossible dates like Feb 30.
function toDayNumber(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const ms = match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : NaN;
  if (Number.isNaN(ms) || fromDayNumber(ms / MS_PER_DAY) !== date) {
    throw new RangeError(`Not a date like '2026-10-12': ${date}`);
  }
  return ms / MS_PER_DAY;
}

function fromDayNumber(day: number): string {
  const d = new Date(day * MS_PER_DAY);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// ISO weekday 1 (Mon) to 7 (Sun). 1970-01-01 was a Thursday.
function isoWeekdayOf(day: number): number {
  return ((((day + 3) % 7) + 7) % 7) + 1;
}

export function addDays(date: string, days: number): string {
  return fromDayNumber(toDayNumber(date) + days);
}

/** The next `count` ride dates on or after `fromDate` that fall on `weekdays`. */
export function nextRideDates(weekdays: Weekday[], fromDate: string, count: number): string[] {
  const isos = new Set(toIsoWeekdays(weekdays));
  let day = toDayNumber(fromDate);
  const dates: string[] = [];
  if (isos.size === 0) return dates;
  while (dates.length < count) {
    if (isos.has(isoWeekdayOf(day))) dates.push(fromDayNumber(day));
    day += 1;
  }
  return dates;
}

/** '2026-10-12' → 'Mon, Oct 12'. */
export function formatRideDate(date: string): string {
  const d = new Date(toDayNumber(date) * MS_PER_DAY);
  return `${DAY_NAMES[d.getUTCDay()]}, ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function checkMinutes(minutes: number): void {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= MINUTES_PER_DAY) {
    throw new RangeError(`Not minutes since midnight: ${minutes}`);
  }
}

/**
 * True once `cutoffMinutes` LA time on the evening before `rideDate` has
 * arrived (at the cutoff minute itself, too). Use `REPLY_CUTOFF_MINUTES` or
 * `CANCEL_CUTOFF_MINUTES`.
 */
export function isPastCutoff(rideDate: string, today: string, nowMinutesLA: number, cutoffMinutes: number): boolean {
  checkMinutes(nowMinutesLA);
  checkMinutes(cutoffMinutes);
  const eveningBefore = toDayNumber(rideDate) - 1;
  const todayDay = toDayNumber(today);
  if (todayDay !== eveningBefore) return todayDay > eveningBefore;
  return nowMinutesLA >= cutoffMinutes;
}

/**
 * The first date a passenger can still request: tomorrow before 8 PM, the day
 * after tomorrow from 8 PM on. This is a calendar date and may be a weekend;
 * pass it to `nextRideDates` to find the next commute day.
 */
export function earliestRequestDate(today: string, nowMinutesLA: number): string {
  checkMinutes(nowMinutesLA);
  return addDays(today, nowMinutesLA < REPLY_CUTOFF_MINUTES ? 1 : 2);
}
