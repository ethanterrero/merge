import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rideDateLine, rideKindBadge } from './rideKind';

test('only a First Ride carries a badge', () => {
  assert.equal(rideKindBadge('first_ride'), 'First Ride');
  assert.equal(rideKindBadge('ride_again'), null);
  assert.equal(rideKindBadge('crew'), null);
});

test('rideDateLine names one date and the First Ride badge', () => {
  assert.equal(rideDateLine('2026-10-12', 'first_ride'), 'Mon, Oct 12 · First Ride');
  assert.equal(rideDateLine('2026-10-13', 'first_ride'), 'Tue, Oct 13 · First Ride');
});

test('rideDateLine shows the date alone for kinds without a badge', () => {
  assert.equal(rideDateLine('2026-10-12', 'ride_again'), 'Mon, Oct 12');
  assert.equal(rideDateLine('2026-10-14', 'crew'), 'Wed, Oct 14');
});

test('rideDateLine rejects a date that is not YYYY-MM-DD', () => {
  assert.throws(() => rideDateLine('Mon–Thu', 'first_ride'), RangeError);
});
