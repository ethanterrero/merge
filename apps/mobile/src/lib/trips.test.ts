import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RideRequest } from '../data/mock';
import {
  DRIVING_DAYS,
  MOCK_TRIPS_TODAY,
  PAST_RIDES,
  RECEIVED_INVITES,
  RIDING_RIDES,
  SENT_INVITES,
  SENT_REQUESTS,
} from '../data/mockTrips';
import { formatRideDate } from './dates';
import type { QueryState } from './data/types';
import {
  CANCELLED_COPY,
  UNAVAILABLE_COPY,
  bookedRides,
  canWithdraw,
  createTripsSession,
  declineQuestion,
  defaultSegment,
  emptyState,
  drivingDays,
  fromItems,
  fromToday,
  gateOnBlocks,
  inviteLabel,
  isSegmentEmpty,
  keepUnblockedPerson,
  keepUnblockedRiders,
  needsReplyCount,
  nextDrivingDay,
  onSides,
  replyByLabel,
  rideLabel,
  rideSide,
  rideStatusCopy,
  riderFromRequest,
  seatsOpenOn,
  seatsPillLabel,
  segmentLabel,
  sentItemLabel,
  sentSide,
  sentStatusCopy,
  showSection,
  sidesFor,
  splitRides,
  toIncomingRequest,
  tripsTabLabel,
  withdrawQuestion,
  type BlockGate,
  type DrivingDay,
  type IncomingRequest,
  type ReceivedInvite,
  type SentItem,
  type SentStatus,
  type TripRide,
} from './trips';

// ------------------------------------------------------------------ helpers

const person = (id: string, name = 'Pat Q.') => ({ id, name, initials: 'PQ', verified: true });

const sent = (over: Partial<SentItem> = {}): SentItem => ({
  id: 's1',
  type: 'request',
  sender: 'me',
  person: person('marcus', 'Marcus L.'),
  rideDate: '2026-10-14',
  kind: 'first_ride',
  pickupArea: 'Park St area, Alameda',
  pickupTime: '7:55 AM',
  status: 'pending',
  ...over,
});

const invite = (over: Partial<ReceivedInvite> = {}): ReceivedInvite => ({
  id: 'i1',
  person: person('lena', 'Lena M.'),
  rideDate: '2026-10-15',
  kind: 'first_ride',
  pickupArea: 'Park St area, Alameda',
  pickupTime: '7:40 AM',
  ...over,
});

const ride = (over: Partial<TripRide> = {}): TripRide => ({
  id: 'r1',
  person: person('kai', 'Kai O.'),
  rideDate: '2026-10-14',
  kind: 'first_ride',
  pickupTime: '7:50 AM',
  myRole: 'passenger',
  status: 'confirmed',
  matchId: null,
  ...over,
});

const request = (over: Partial<RideRequest> = {}): RideRequest => ({
  id: 'req-jordan',
  name: 'Jordan T.',
  initials: 'JT',
  verified: true,
  rideDate: '2026-10-12',
  kind: 'first_ride',
  addedDetour: '+4 min',
  pickupTime: '7:40',
  pickupSpot: 'Park St & Central Ave',
  seats: 1,
  replyBy: '[time]',
  ridePrefs: [],
  stats: { rides: '[N]', onTime: '[X]%' },
  ...over,
});

const rider = (id: string, seats = 1) => ({
  id,
  person: person(id),
  pickupTime: '7:38 AM',
  spot: '[Pickup spot]',
  seats,
  cargo: false,
  justBooked: false,
});

const day = (date: string, riderIds: string[]): DrivingDay => ({ date, leaveTime: '7:35 AM', riders: riderIds.map((id) => rider(id)) });

const ready = (blocked: string[] = []): BlockGate => ({ status: 'ready', isBlocked: (id) => Boolean(id && blocked.includes(id)) });

const incoming = (n: number): QueryState<IncomingRequest[]> =>
  fromItems(Array.from({ length: n }, (_, i) => toIncomingRequest(request({ id: `req-${i}` }))));

// ------------------------------------------------------------------ roles

test('sidesFor gives each role its sides', () => {
  assert.deepEqual(sidesFor('driver'), { driving: true, riding: false });
  assert.deepEqual(sidesFor('passenger'), { driving: false, riding: true });
  assert.deepEqual(sidesFor('both'), { driving: true, riding: true });
});

test('sentSide: my requests and invites to me are riding, my invites are driving', () => {
  assert.equal(sentSide(sent({ type: 'request', sender: 'me' })), 'riding');
  assert.equal(sentSide(sent({ type: 'invite', sender: 'me' })), 'driving');
  assert.equal(sentSide(sent({ type: 'invite', sender: 'them', status: 'accepted' })), 'riding');
});

test('fixture seeding by role keeps only that role sides, past rides by drove/rode', () => {
  const allSent = [...SENT_INVITES, ...SENT_REQUESTS];
  assert.deepEqual(
    onSides(allSent, 'driver', sentSide).map((s) => s.id),
    SENT_INVITES.map((s) => s.id),
  );
  assert.deepEqual(
    onSides(allSent, 'passenger', sentSide).map((s) => s.id),
    SENT_REQUESTS.map((s) => s.id),
  );
  assert.equal(onSides(allSent, 'both', sentSide).length, allSent.length);
  assert.deepEqual(onSides(PAST_RIDES, 'driver', rideSide).map((r) => r.myRole), ['driver']);
  assert.ok(onSides(PAST_RIDES, 'passenger', rideSide).every((r) => r.myRole === 'passenger'));
});

// ------------------------------------------------------------------ visibility

test('showSection: loading, error and non-empty show; empty and idle do not', () => {
  assert.equal(showSection({ status: 'loading' }), true);
  assert.equal(showSection({ status: 'error', error: { kind: 'unknown', message: 'x' } }), true);
  assert.equal(showSection(fromItems([1])), true);
  assert.equal(showSection(fromItems([])), false);
  assert.equal(showSection({ status: 'idle' }), false);
});

test('a non-empty driving section shows whatever the role (role only seeds fixtures)', () => {
  // showSection takes no role, so a passenger with a leftover driving day still sees it.
  assert.equal(showSection(fromItems([day('2026-10-12', ['sam'])])), true);
});

test('isSegmentEmpty only when every section is empty or idle', () => {
  assert.equal(isSegmentEmpty([fromItems([]), { status: 'idle' }]), true);
  assert.equal(isSegmentEmpty([fromItems([]), { status: 'loading' }]), false);
  assert.equal(isSegmentEmpty([fromItems([]), { status: 'error', error: { kind: 'unknown', message: 'x' } }]), false);
  assert.equal(isSegmentEmpty([fromItems([]), fromItems([1])]), false);
});

// ------------------------------------------------------------------ blocks

test('gateOnBlocks reads loading until the block list is ready, so nobody blocked flashes up', () => {
  const state = fromItems([sent()]);
  assert.deepEqual(gateOnBlocks(state, { status: 'loading', isBlocked: () => false }, keepUnblockedPerson), { status: 'loading' });
  assert.deepEqual(gateOnBlocks(state, { status: 'idle', isBlocked: () => false }, keepUnblockedPerson), { status: 'loading' });
});

test('gateOnBlocks shows the generic error when the block list failed', () => {
  const gated = gateOnBlocks(fromItems([sent()]), { status: 'error', isBlocked: () => false }, keepUnblockedPerson);
  assert.equal(gated.status, 'error');
  assert.equal(gated.status === 'error' && gated.error.message, 'Something went wrong. Try again.');
});

test('gateOnBlocks drops blocked people and becomes empty when none are left', () => {
  const state = fromItems([sent({ id: 'a', person: person('marcus') }), sent({ id: 'b', person: person('dana') })]);
  const gated = gateOnBlocks(state, ready(['marcus']), keepUnblockedPerson);
  assert.equal(gated.status, 'success');
  assert.deepEqual(gated.status === 'success' && gated.data.map((s) => s.id), ['b']);
  assert.deepEqual(gateOnBlocks(state, ready(['marcus', 'dana']), keepUnblockedPerson), { status: 'empty', refreshing: false });
});

test('gateOnBlocks passes a section error through unchanged', () => {
  const error: QueryState<SentItem[]> = { status: 'error', error: { kind: 'offline', message: 'Check your connection and try again.' } };
  assert.equal(gateOnBlocks<SentItem>(error, ready(), keepUnblockedPerson), error);
});

test('keepUnblockedRiders drops a blocked rider, and the day once nobody is left', () => {
  const d = day('2026-10-12', ['sam', 'req-jordan']);
  assert.deepEqual(keepUnblockedRiders(d, ready(['req-jordan']).isBlocked)?.riders.map((r) => r.id), ['sam']);
  assert.equal(keepUnblockedRiders(d, ready(['sam', 'req-jordan']).isBlocked), null);
  assert.equal(keepUnblockedRiders(d, ready().isBlocked), d);
});

// ------------------------------------------------------------------ counts and labels

test('needsReplyCount counts requests and invites to me only', () => {
  assert.equal(needsReplyCount(incoming(2), fromItems([invite()])), 3);
  assert.equal(needsReplyCount(fromItems([]), fromItems([])), 0);
  assert.equal(needsReplyCount({ status: 'loading' }, { status: 'error', error: { kind: 'unknown', message: 'x' } }), 0);
});

test('tripsTabLabel and segmentLabel carry the count only above zero', () => {
  assert.equal(tripsTabLabel(0), 'Trips');
  assert.equal(tripsTabLabel(1), 'Trips, 1 needs your reply');
  assert.equal(tripsTabLabel(2), 'Trips, 2 need your reply');
  assert.equal(segmentLabel(0), 'Requests');
  assert.equal(segmentLabel(2), 'Requests · 2');
});

test('defaultSegment opens Requests when something needs a reply, an explicit tab wins', () => {
  assert.equal(defaultSegment(2), 'requests');
  assert.equal(defaultSegment(0), 'upcoming');
  assert.equal(defaultSegment(2, 'past'), 'past');
  assert.equal(defaultSegment(0, 'requests'), 'requests');
});

test('replyByLabel is 8:00 PM LA the evening before (D-02)', () => {
  assert.equal(replyByLabel('2026-10-12', 'short'), 'Sun 8:00 PM');
  assert.equal(replyByLabel('2026-10-12', 'long'), 'Sun, Oct 11, 8:00 PM');
  assert.equal(replyByLabel('2026-11-02', 'long'), 'Sun, Nov 1, 8:00 PM');
});

// ------------------------------------------------------------------ no "no"

test('request-state copy never says or hints at a decline', () => {
  const statuses: SentStatus[] = ['pending', 'unavailable', 'accepted'];
  for (const status of statuses) {
    for (const sender of ['me', 'them'] as const) {
      const copy = sentStatusCopy(sent({ status, sender })).toLowerCase();
      assert.ok(!/declin|reject|no longer interested|said no|turned down/.test(copy), `${status}: ${copy}`);
    }
  }
  assert.equal(sentStatusCopy(sent({ status: 'unavailable' })), "This ride isn't available anymore");
  assert.equal(UNAVAILABLE_COPY, "This ride isn't available anymore");
});

test('pending and accepted copy', () => {
  assert.equal(sentStatusCopy(sent()), 'Waiting for Marcus · reply by Tue 8:00 PM');
  assert.equal(
    sentStatusCopy(sent({ sender: 'them', type: 'invite', status: 'accepted', person: person('lena', 'Lena M.') })),
    'You accepted. Lena confirms your seat and sets the pickup spot.',
  );
});

test('only my pending items can be withdrawn', () => {
  assert.equal(canWithdraw(sent()), true);
  assert.equal(canWithdraw(sent({ status: 'unavailable' })), false);
  assert.equal(canWithdraw(sent({ sender: 'them', type: 'invite', status: 'accepted' })), false);
});

test('confirmation questions name the person and date, and decline promises no tell', () => {
  assert.equal(withdrawQuestion(sent()), 'Withdraw your request to Marcus for Wed, Oct 14?');
  assert.equal(withdrawQuestion(sent({ type: 'invite' })), 'Withdraw your invite to Marcus for Wed, Oct 14?');
  assert.equal(declineQuestion(invite()), "Decline Lena's invite for Thu, Oct 15? Lena sees it the same way as an invite nobody answered.");
});

test('fromToday drops rows dated before today and never changes a status', () => {
  const rows = [sent({ id: 'old', rideDate: '2026-10-09' }), sent({ id: 'today', rideDate: '2026-10-10' }), sent({ id: 'later', rideDate: '2026-10-14' })];
  const kept = fromToday(rows, '2026-10-10');
  assert.deepEqual(kept.map((r) => r.id), ['today', 'later']);
  // A pending request whose reply cutoff has passed stays pending: the server decides (D-22).
  const pastCutoff = fromToday([sent({ rideDate: '2026-10-11', status: 'pending' })], '2026-10-11');
  assert.equal(pastCutoff[0].status, 'pending');
});

test('empty states are role-aware and never imply a "no"', () => {
  assert.deepEqual(emptyState('requests', 'passenger'), {
    text: 'Nothing waiting. Find a driver going your way and request a First Ride.',
    action: 'Find a ride',
  });
  assert.equal(emptyState('requests', 'driver').action, null);
  assert.equal(emptyState('requests', 'both').action, 'Open Discover');
  assert.equal(emptyState('upcoming', 'passenger').action, 'Find a ride');
  assert.equal(emptyState('upcoming', 'both').text, 'No rides booked yet. Rides you drive and ride show up here by date.');
  for (const role of ['driver', 'passenger', 'both'] as const) {
    assert.equal(emptyState('past', role).text, 'Your past rides show up here after each ride.');
    for (const segment of ['requests', 'upcoming', 'past'] as const) {
      assert.ok(!/declin|reject|nobody wants|no one accepted/i.test(emptyState(segment, role).text));
    }
  }
});

// ------------------------------------------------------------------ driving days

test('drivingDays puts each accepted request under its own date only (the M-13 bug)', () => {
  const days = drivingDays([day('2026-10-12', ['sam']), day('2026-10-13', ['morgan'])], [riderFromRequest(request())], '7:35 AM');
  assert.deepEqual(days.map((d) => [d.date, d.riders.map((r) => r.id)]), [
    ['2026-10-12', ['sam', 'req-jordan']],
    ['2026-10-13', ['morgan']],
  ]);
});

test('drivingDays creates a day for a request on a date I had none, sorted, no duplicates', () => {
  const accepted = riderFromRequest(request({ id: 'req-x', rideDate: '2026-10-09' }));
  const days = drivingDays([day('2026-10-12', ['sam'])], [accepted, accepted], '7:35 AM');
  assert.deepEqual(days.map((d) => d.date), ['2026-10-09', '2026-10-12']);
  assert.equal(days[0].riders.length, 1);
  assert.equal(days[0].leaveTime, '7:35 AM');
});

test('drivingDays does not mutate the base days', () => {
  const base = [day('2026-10-12', ['sam'])];
  drivingDays(base, [riderFromRequest(request())], '7:35 AM');
  assert.equal(base[0].riders.length, 1);
});

test('seatsOpenOn is offered minus booked seats, floored at 0, with no phantom rider', () => {
  assert.equal(seatsOpenOn(day('2026-10-12', ['sam']), 2), 1);
  assert.equal(seatsOpenOn(null, 2), 2);
  assert.equal(seatsOpenOn({ date: '2026-10-12', leaveTime: '7:35 AM', riders: [rider('a', 2), rider('b', 1)] }, 2), 0);
});

test('seatsPillLabel names the next driving day', () => {
  const days = [day('2026-10-12', ['sam']), day('2026-10-13', [])];
  assert.equal(seatsPillLabel(nextDrivingDay(days, '2026-10-10'), 2), 'Driving Mon · 1 of 2 seats open');
  assert.equal(seatsPillLabel(nextDrivingDay(days, '2026-10-13'), 2), 'Driving Tue · 2 of 2 seats open');
  assert.equal(seatsPillLabel(nextDrivingDay(days, '2026-10-20'), 1), 'Driving · 1 seat offered');
});

test('toIncomingRequest uses the request id as the requester stand-in and carries no spot', () => {
  const r = toIncomingRequest(request({ cargo: { label: 'Foldable scooter', detail: '' } }));
  assert.equal(r.person.id, 'req-jordan');
  assert.equal(r.cargo, true);
  assert.ok(!('pickupSpot' in r) && !('spot' in r));
});

// ------------------------------------------------------------------ rides

test('splitRides: confirmed and cancelled from today go Upcoming, the rest Past', () => {
  const { upcoming, past } = splitRides(
    [
      ride({ id: 'later', rideDate: '2026-10-16' }),
      ride({ id: 'soon', rideDate: '2026-10-10' }),
      ride({ id: 'cancelled', rideDate: '2026-10-14', status: 'cancelled' }),
      ride({ id: 'done', rideDate: '2026-10-12', status: 'completed' }),
      ride({ id: 'old', rideDate: '2026-10-06', status: 'cancelled' }),
      ride({ id: 'older', rideDate: '2026-10-05', status: 'confirmed' }),
    ],
    '2026-10-10',
  );
  assert.deepEqual(upcoming.map((r) => r.id), ['soon', 'cancelled', 'later']);
  assert.deepEqual(past.map((r) => r.id), ['done', 'old', 'older']);
});

test('bookedRides turns this session bookings into passenger rides on the ride date', () => {
  const rides = bookedRides(
    [{ match: { id: 'priya', name: 'Priya S.', initials: 'PS', verified: true, departs: '7:40' }, ride: { id: 'ride-1', status: 'confirmed' } }],
    '2026-10-12',
  );
  assert.deepEqual(rides, [
    {
      id: 'ride-1',
      person: { id: 'priya', name: 'Priya S.', initials: 'PS', verified: true },
      rideDate: '2026-10-12',
      kind: 'first_ride',
      pickupTime: '7:40 AM',
      myRole: 'passenger',
      status: 'confirmed',
      matchId: 'priya',
    },
  ]);
  assert.deepEqual(bookedRides([], '2026-10-12'), []);
});

test('a cancelled ride never names a cause (D-07)', () => {
  assert.equal(rideStatusCopy(ride({ status: 'cancelled' })), CANCELLED_COPY);
  assert.equal(CANCELLED_COPY, 'Ride cancelled');
  assert.equal(rideStatusCopy(ride()), 'Pickup 7:50 AM');
  assert.equal(rideStatusCopy(ride({ status: 'completed' })), 'Completed');
});

// ------------------------------------------------------------------ session store

const seed = () => ({ sent: [sent({ id: 'a' }), sent({ id: 'gone', status: 'unavailable' })], invites: [invite({ id: 'x' }), invite({ id: 'y' })] });

test('withdraw removes only that pending item', () => {
  const store = createTripsSession(seed());
  store.withdraw('a');
  assert.deepEqual(store.getSnapshot().sent.map((s) => s.id), ['gone']);
  store.withdraw('gone'); // unavailable items can't be withdrawn
  assert.deepEqual(store.getSnapshot().sent.map((s) => s.id), ['gone']);
});

test('acceptInvite moves the invite under sent as accepted', () => {
  const store = createTripsSession(seed());
  store.acceptInvite('x');
  const snap = store.getSnapshot();
  assert.deepEqual(snap.invites.map((i) => i.id), ['y']);
  const accepted = snap.sent.find((s) => s.id === 'x');
  assert.equal(accepted?.status, 'accepted');
  assert.equal(accepted?.sender, 'them');
  assert.equal(accepted?.type, 'invite');
});

test('declineInvite removes it', () => {
  const store = createTripsSession(seed());
  store.declineInvite('y');
  assert.deepEqual(store.getSnapshot().invites.map((i) => i.id), ['x']);
});

test('unknown ids are a no-op and keep the snapshot reference', () => {
  const store = createTripsSession(seed());
  const before = store.getSnapshot();
  let calls = 0;
  store.subscribe(() => calls++);
  store.withdraw('nope');
  store.acceptInvite('nope');
  store.declineInvite('nope');
  assert.equal(store.getSnapshot(), before);
  assert.equal(calls, 0);
});

test('listeners fire on change, snapshots change reference, unsubscribe stops them', () => {
  const store = createTripsSession(seed());
  const before = store.getSnapshot();
  let calls = 0;
  const off = store.subscribe(() => calls++);
  store.declineInvite('x');
  assert.equal(calls, 1);
  assert.notEqual(store.getSnapshot(), before);
  off();
  store.declineInvite('y');
  assert.equal(calls, 1);
});

test('two stores never share state, and the seed is not mutated', () => {
  const s = seed();
  const one = createTripsSession(s);
  const two = createTripsSession(s);
  one.withdraw('a');
  assert.equal(two.getSnapshot().sent.length, 2);
  assert.equal(s.sent.length, 2);
});

// ------------------------------------------------------------------ fixtures

test('no fixture before confirmation carries a spot or coordinates', () => {
  const pre = [...SENT_INVITES, ...SENT_REQUESTS, ...RECEIVED_INVITES];
  for (const item of pre) {
    for (const key of Object.keys(item)) assert.ok(!/spot|lat|lng|coord|address/i.test(key), `${item.id}.${key}`);
  }
});

test('fixture people are fictional "First L." names and every date parses', () => {
  const people = [
    ...SENT_INVITES,
    ...SENT_REQUESTS,
    ...RECEIVED_INVITES,
    ...RIDING_RIDES,
    ...PAST_RIDES,
    ...DRIVING_DAYS.flatMap((d) => d.riders),
  ].map((item) => item.person);
  for (const p of people) assert.match(p.name, /^[A-Z][a-z]+ [A-Z]\.$/);
  const dates = [...SENT_INVITES, ...SENT_REQUESTS, ...RECEIVED_INVITES, ...RIDING_RIDES, ...PAST_RIDES].map((i) => i.rideDate);
  for (const d of [...dates, ...DRIVING_DAYS.map((x) => x.date)]) assert.doesNotThrow(() => formatRideDate(d));
});

test('pending fixtures are still before their reply cutoff on the prototype clock', () => {
  const pending = [...SENT_INVITES, ...SENT_REQUESTS].filter((s) => s.status === 'pending');
  for (const item of [...pending, ...RECEIVED_INVITES]) assert.ok(item.rideDate > MOCK_TRIPS_TODAY, item.id);
});

// ------------------------------------------------------------------ accessibility labels

test('accessibility labels carry name, date and status as words', () => {
  assert.equal(sentItemLabel(sent()), 'Request to Marcus L., Wed, Oct 14, First Ride. Waiting for Marcus, reply by Tue 8:00 PM.');
  assert.equal(
    sentItemLabel(sent({ status: 'unavailable' })),
    "Request to Marcus L., Wed, Oct 14, First Ride. This ride isn't available anymore.",
  );
  assert.equal(
    inviteLabel(invite()),
    'Lena M. invited you to ride, Thu, Oct 15, First Ride. Pickup 7:40 AM, Park St area, Alameda. Reply by Wed, Oct 14, 8:00 PM.',
  );
  assert.equal(rideLabel(ride({ status: 'cancelled' }), 'upcoming'), 'Kai O., Wed, Oct 14, First Ride. Ride cancelled.');
  assert.equal(rideLabel(ride({ status: 'completed', myRole: 'driver' }), 'past'), 'You drove with Kai O., Wed, Oct 14, First Ride. Completed.');
});
