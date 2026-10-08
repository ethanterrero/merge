import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CANCEL_CUTOFF_MINUTES,
  REPLY_CUTOFF_MINUTES,
  addDays,
  departureWindow,
  earliestRequestDate,
  formatDays,
  formatRideDate,
  formatTime,
  fromIsoWeekdays,
  isPastCutoff,
  isoToWeekday,
  nextRideDates,
  parseTime,
  toIsoWeekdays,
  weekdayToIso,
} from './dates';

test('weekdays map to ISO numbers 1 to 5 and back', () => {
  assert.equal(weekdayToIso('Mon'), 1);
  assert.equal(weekdayToIso('Fri'), 5);
  assert.equal(isoToWeekday(1), 'Mon');
  assert.equal(isoToWeekday(5), 'Fri');
  assert.throws(() => isoToWeekday(0), RangeError);
  assert.throws(() => isoToWeekday(6), RangeError);
  assert.throws(() => isoToWeekday(1.5), RangeError);
});

test('weekday lists convert to and from the integer[] columns in Monday-first order', () => {
  assert.deepEqual(toIsoWeekdays(['Thu', 'Mon', 'Wed', 'Mon']), [1, 3, 4]);
  assert.deepEqual(fromIsoWeekdays([4, 1, 3, 1]), ['Mon', 'Wed', 'Thu']);
  assert.deepEqual(fromIsoWeekdays([]), []);
  assert.throws(() => fromIsoWeekdays([1, 7]), RangeError);
});

test('formatDays collapses a contiguous run into a range', () => {
  assert.equal(formatDays(['Mon', 'Tue', 'Wed', 'Thu']), 'Mon–Thu');
  assert.equal(formatDays(['Thu', 'Tue', 'Wed']), 'Tue–Thu');
  assert.equal(formatDays(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']), 'Mon–Fri');
  assert.equal(formatDays(['Thu', 'Fri']), 'Thu–Fri');
});

test('formatDays lists days with a gap and names a single day', () => {
  assert.equal(formatDays(['Mon', 'Wed', 'Thu']), 'Mon, Wed, Thu');
  assert.equal(formatDays(['Fri', 'Mon']), 'Mon, Fri');
  assert.equal(formatDays(['Tue']), 'Tue only');
  assert.equal(formatDays(['Tue', 'Tue']), 'Tue only');
  assert.equal(formatDays([]), '');
});

test('parseTime turns a picker time into a Postgres time', () => {
  assert.equal(parseTime('7:45 AM'), '07:45:00');
  assert.equal(parseTime('07:05 am'), '07:05:00');
  assert.equal(parseTime('5:30PM'), '17:30:00');
  assert.equal(parseTime('12:00 AM'), '00:00:00');
  assert.equal(parseTime('12:15 PM'), '12:15:00');
  assert.equal(parseTime(' 11:59 PM '), '23:59:00');
});

test('parseTime rejects malformed times', () => {
  for (const bad of ['', '7:45', '13:00 PM', '0:30 AM', '7:60 AM', '7:5 AM', 'noon']) {
    assert.throws(() => parseTime(bad), RangeError, bad);
  }
});

test('formatTime turns a Postgres time into a picker time', () => {
  assert.equal(formatTime('07:45:00'), '7:45 AM');
  assert.equal(formatTime('07:45'), '7:45 AM');
  assert.equal(formatTime('00:00:00'), '12:00 AM');
  assert.equal(formatTime('12:15:00'), '12:15 PM');
  assert.equal(formatTime('17:30:00'), '5:30 PM');
  assert.throws(() => formatTime('24:00:00'), RangeError);
  assert.throws(() => formatTime('7:45 AM'), RangeError);
});

test('parseTime and formatTime round-trip', () => {
  for (const t of ['6:00 AM', '7:45 AM', '9:05 AM', '12:00 PM', '4:30 PM', '12:00 AM']) {
    assert.equal(formatTime(parseTime(t)), t);
  }
});

test('departureWindow spans the flex on both sides', () => {
  assert.equal(departureWindow('7:45 AM', 15), '7:30–8:00');
  assert.equal(departureWindow('07:40:00', 15), '7:25–7:55');
  assert.equal(departureWindow('7:55 AM', 15), '7:40–8:10');
  assert.equal(departureWindow('12:05 PM', 10), '11:55–12:15');
  assert.equal(departureWindow('7:45 AM', 0), '7:45');
  assert.throws(() => departureWindow('7:45 AM', -5), RangeError);
});

test('addDays crosses month, year and leap-day boundaries', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  assert.throws(() => addDays('2026-02-30', 1), RangeError);
  assert.throws(() => addDays('2026-10-8', 1), RangeError);
});

test('nextRideDates starts on fromDate and skips days off', () => {
  assert.deepEqual(nextRideDates(['Mon', 'Wed'], '2026-10-12', 3), ['2026-10-12', '2026-10-14', '2026-10-19']);
  assert.deepEqual(nextRideDates(['Tue'], '2026-10-12', 2), ['2026-10-13', '2026-10-20']);
  assert.deepEqual(nextRideDates([], '2026-10-12', 3), []);
  assert.deepEqual(nextRideDates(['Mon'], '2026-10-12', 0), []);
});

test('nextRideDates crosses a month end', () => {
  assert.deepEqual(nextRideDates(['Mon', 'Tue', 'Wed', 'Thu'], '2026-10-29', 3), [
    '2026-10-29',
    '2026-11-02',
    '2026-11-03',
  ]);
});

test('nextRideDates crosses a year end', () => {
  assert.deepEqual(nextRideDates(['Mon', 'Wed', 'Thu', 'Fri'], '2026-12-30', 4), [
    '2026-12-30',
    '2026-12-31',
    '2027-01-01',
    '2027-01-04',
  ]);
});

test('nextRideDates is unaffected by the DST changes', () => {
  // Clocks fall back on Sun 2026-11-01 and spring forward on Sun 2027-03-14.
  assert.deepEqual(nextRideDates(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], '2026-10-30', 3), [
    '2026-10-30',
    '2026-11-02',
    '2026-11-03',
  ]);
  assert.deepEqual(nextRideDates(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], '2027-03-12', 3), [
    '2027-03-12',
    '2027-03-15',
    '2027-03-16',
  ]);
});

test('formatRideDate', () => {
  assert.equal(formatRideDate('2026-10-12'), 'Mon, Oct 12');
  assert.equal(formatRideDate('2026-10-13'), 'Tue, Oct 13');
  assert.equal(formatRideDate('2026-11-01'), 'Sun, Nov 1');
  assert.equal(formatRideDate('2027-01-01'), 'Fri, Jan 1');
  assert.equal(formatRideDate('2027-03-14'), 'Sun, Mar 14');
});

test('cutoffs are 8 PM for replies and 9 PM for cancellations', () => {
  assert.equal(REPLY_CUTOFF_MINUTES, 20 * 60);
  assert.equal(CANCEL_CUTOFF_MINUTES, 21 * 60);
});

test('earliestRequestDate is tomorrow until 8 PM, then the day after', () => {
  assert.equal(earliestRequestDate('2026-10-08', 0), '2026-10-09');
  assert.equal(earliestRequestDate('2026-10-08', 19 * 60 + 59), '2026-10-09');
  assert.equal(earliestRequestDate('2026-10-08', 20 * 60), '2026-10-10');
  assert.equal(earliestRequestDate('2026-10-08', 23 * 60 + 59), '2026-10-10');
  assert.throws(() => earliestRequestDate('2026-10-08', 24 * 60), RangeError);
  assert.throws(() => earliestRequestDate('2026-10-08', -1), RangeError);
});

test('earliestRequestDate crosses month and year ends', () => {
  assert.equal(earliestRequestDate('2026-10-31', 19 * 60), '2026-11-01');
  assert.equal(earliestRequestDate('2026-10-30', 20 * 60), '2026-11-01');
  assert.equal(earliestRequestDate('2026-12-30', 21 * 60), '2027-01-01');
});

test('a Friday-night request lands on Sunday by calendar, and nextRideDates finds Monday', () => {
  const earliest = earliestRequestDate('2026-10-09', 20 * 60 + 30);
  assert.equal(earliest, '2026-10-11');
  assert.deepEqual(nextRideDates(['Mon', 'Tue', 'Wed', 'Thu'], earliest, 1), ['2026-10-12']);
  assert.equal(earliestRequestDate('2026-10-09', 19 * 60 + 59), '2026-10-10');
});

test('isPastCutoff closes at 8 PM the evening before for replies', () => {
  const ride = '2026-10-13';
  assert.equal(isPastCutoff(ride, '2026-10-11', 23 * 60, REPLY_CUTOFF_MINUTES), false);
  assert.equal(isPastCutoff(ride, '2026-10-12', 19 * 60 + 59, REPLY_CUTOFF_MINUTES), false);
  assert.equal(isPastCutoff(ride, '2026-10-12', 20 * 60, REPLY_CUTOFF_MINUTES), true);
  assert.equal(isPastCutoff(ride, '2026-10-13', 0, REPLY_CUTOFF_MINUTES), true);
  assert.equal(isPastCutoff(ride, '2026-10-14', 0, REPLY_CUTOFF_MINUTES), true);
});

test('isPastCutoff closes at 9 PM the evening before for cancellations', () => {
  const ride = '2026-10-13';
  assert.equal(isPastCutoff(ride, '2026-10-12', 20 * 60 + 59, CANCEL_CUTOFF_MINUTES), false);
  assert.equal(isPastCutoff(ride, '2026-10-12', 21 * 60, CANCEL_CUTOFF_MINUTES), true);
});

test('isPastCutoff on the DST-change evenings', () => {
  // The evening before Mon 2026-11-02 is the fall-back Sunday.
  assert.equal(isPastCutoff('2026-11-02', '2026-11-01', 19 * 60 + 59, REPLY_CUTOFF_MINUTES), false);
  assert.equal(isPastCutoff('2026-11-02', '2026-11-01', 20 * 60, REPLY_CUTOFF_MINUTES), true);
  // The evening before Mon 2027-03-15 is the spring-forward Sunday.
  assert.equal(isPastCutoff('2027-03-15', '2027-03-14', 20 * 60 + 59, CANCEL_CUTOFF_MINUTES), false);
  assert.equal(isPastCutoff('2027-03-15', '2027-03-14', 21 * 60, CANCEL_CUTOFF_MINUTES), true);
  assert.equal(earliestRequestDate('2026-10-31', 20 * 60), '2026-11-02');
  assert.equal(earliestRequestDate('2027-03-13', 19 * 60 + 59), '2027-03-14');
});

test('isPastCutoff crosses month and year ends', () => {
  assert.equal(isPastCutoff('2026-11-02', '2026-10-31', 23 * 60, REPLY_CUTOFF_MINUTES), false);
  assert.equal(isPastCutoff('2027-01-01', '2026-12-31', 19 * 60 + 59, REPLY_CUTOFF_MINUTES), false);
  assert.equal(isPastCutoff('2027-01-01', '2026-12-31', 20 * 60, REPLY_CUTOFF_MINUTES), true);
});

test('earliestRequestDate is the first date whose reply cutoff has not passed', () => {
  for (const today of ['2026-10-09', '2026-10-31', '2026-12-31', '2027-03-13']) {
    for (const now of [0, 19 * 60 + 59, 20 * 60, 23 * 60 + 59]) {
      const earliest = earliestRequestDate(today, now);
      assert.equal(isPastCutoff(earliest, today, now, REPLY_CUTOFF_MINUTES), false);
      assert.equal(isPastCutoff(addDays(earliest, -1), today, now, REPLY_CUTOFF_MINUTES), true);
    }
  }
});
