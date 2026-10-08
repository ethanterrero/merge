import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SLOT_STEP_MINUTES,
  dateToDeparture,
  departureMinutes,
  departureSlots,
  departureToDate,
  minutesToDeparture,
  slotsWith,
  snapMinutes,
} from './timeSlots';

test('departureMinutes reads a picker time as minutes since midnight', () => {
  assert.equal(departureMinutes('7:45 AM'), 7 * 60 + 45);
  assert.equal(departureMinutes('12:00 AM'), 0);
  assert.equal(departureMinutes('12:05 PM'), 12 * 60 + 5);
  assert.equal(departureMinutes('11:55 PM'), 23 * 60 + 55);
  assert.throws(() => departureMinutes('07:45:00'), RangeError);
  assert.throws(() => departureMinutes('soon'), RangeError);
});

test('minutesToDeparture formats minutes since midnight as a picker time', () => {
  assert.equal(minutesToDeparture(7 * 60 + 45), '7:45 AM');
  assert.equal(minutesToDeparture(0), '12:00 AM');
  assert.equal(minutesToDeparture(13 * 60 + 5), '1:05 PM');
  assert.throws(() => minutesToDeparture(-1), RangeError);
  assert.throws(() => minutesToDeparture(24 * 60), RangeError);
  assert.throws(() => minutesToDeparture(7.5), RangeError);
});

test('snapMinutes rounds to the nearest 5-minute step and wraps at midnight', () => {
  assert.equal(SLOT_STEP_MINUTES, 5);
  assert.equal(snapMinutes(465), 465);
  assert.equal(snapMinutes(467), 465);
  assert.equal(snapMinutes(468), 470);
  assert.equal(snapMinutes(462.5), 465);
  assert.equal(snapMinutes(23 * 60 + 58), 0);
  assert.equal(snapMinutes(7, 15), 0);
  assert.equal(snapMinutes(8, 15), 15);
  assert.throws(() => snapMinutes(10, 0), RangeError);
});

test('departureSlots lists 5-minute morning slots from 5:00 to 10:00 AM inclusive', () => {
  const slots = departureSlots();
  assert.equal(slots[0], '5:00 AM');
  assert.equal(slots[1], '5:05 AM');
  assert.equal(slots[slots.length - 1], '10:00 AM');
  assert.equal(slots.length, 61);
  assert.ok(slots.includes('7:45 AM'));
});

test('departureSlots takes a custom range and step', () => {
  assert.deepEqual(departureSlots(11 * 60 + 30, 12 * 60 + 30, 30), ['11:30 AM', '12:00 PM', '12:30 PM']);
  assert.throws(() => departureSlots(600, 300), RangeError);
});

test('slotsWith keeps the list and adds an off-list current time in order', () => {
  const slots = ['7:00 AM', '7:05 AM', '7:10 AM'];
  assert.equal(slotsWith(slots, '7:05 AM'), slots);
  assert.deepEqual(slotsWith(slots, '7:07 AM'), ['7:00 AM', '7:05 AM', '7:07 AM', '7:10 AM']);
  assert.deepEqual(slotsWith(slots, '6:30 AM'), ['6:30 AM', '7:00 AM', '7:05 AM', '7:10 AM']);
  assert.deepEqual(slotsWith(slots, '5:30 PM'), ['7:00 AM', '7:05 AM', '7:10 AM', '5:30 PM']);
  assert.equal(slotsWith(slots, 'not a time'), slots);
});

test('departureToDate puts the departure on the given day in local wall-clock time', () => {
  const base = new Date(2026, 9, 12, 15, 30, 12, 345);
  const d = departureToDate('7:45 AM', base);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 9);
  assert.equal(d.getDate(), 12);
  assert.equal(d.getHours(), 7);
  assert.equal(d.getMinutes(), 45);
  assert.equal(d.getSeconds(), 0);
  assert.equal(d.getMilliseconds(), 0);
  assert.equal(base.getHours(), 15, 'does not mutate the base date');
});

test('dateToDeparture reads the local wall clock and snaps to the step', () => {
  assert.equal(dateToDeparture(new Date(2026, 9, 12, 7, 45)), '7:45 AM');
  assert.equal(dateToDeparture(new Date(2026, 9, 12, 7, 43)), '7:45 AM');
  assert.equal(dateToDeparture(new Date(2026, 9, 12, 8, 2, 59)), '8:00 AM');
  assert.equal(dateToDeparture(new Date(2026, 9, 12, 8, 3)), '8:05 AM');
  assert.equal(dateToDeparture(new Date(2026, 9, 12, 23, 58)), '12:00 AM');
  assert.equal(dateToDeparture(new Date(2026, 9, 12, 17, 31), 1), '5:31 PM');
});

test('a departure survives a round trip through a Date', () => {
  for (const slot of departureSlots()) {
    assert.equal(dateToDeparture(departureToDate(slot, new Date(2026, 2, 8))), slot);
  }
});
