import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crewStatusAfter, resolveConnection, type ConnectionOutcome, type CrewStatus, type RideAgainAnswer } from '../state/connection';
import { emptyFirstRideState, latestRide } from './firstRide';
import {
  canProposeCrew,
  confirmedCrewRides,
  crewFor,
  emptyRelationshipState,
  isOpenCrew,
  isValidCrewDays,
  nextCrewRide,
  relationshipReducer,
  type Crew,
  type RelationshipAction,
  type RelationshipState,
} from './crew';

const rules = { resolveConnection, crewStatusAfter };

function apply(state: RelationshipState, ...actions: RelationshipAction[]): RelationshipState {
  return actions.reduce((s, a) => relationshipReducer(s, a, rules), state);
}

/** Books, completes and answers `mine` for a ride with priya, then simulates her answer. */
function afterRide(mine: RideAgainAnswer, theirs: RideAgainAnswer | null, matchId = 'priya'): RelationshipState {
  let state = apply(emptyRelationshipState('prototype'), { type: 'rideBooked', matchId }, { type: 'rideCompleted', matchId });
  const ride = latestRide(state.firstRide, matchId);
  assert.ok(ride, 'no ride');
  state = apply(state, { type: 'feedbackSubmitted', rideId: ride.id, feedback: { experience: 'great', rideAgain: mine } });
  return theirs === null ? state : apply(state, { type: 'partnerAnswerSimulated', matchId, answer: theirs });
}

const SHARED = ['Mon', 'Wed', 'Fri'] as const;
const propose = (days: Crew['days'] = ['Mon', 'Wed'], matchId = 'priya'): RelationshipAction => ({
  type: 'crewProposed',
  matchId,
  days,
  sharedDays: [...SHARED],
  departureTime: '7:45 AM',
});
const accept = (matchId = 'priya'): RelationshipAction => ({ type: 'crewAnswerSimulated', matchId, accept: true });
const decline = (matchId = 'priya'): RelationshipAction => ({ type: 'crewAnswerSimulated', matchId, accept: false });
const setStatus = (status: 'active' | 'paused' | 'ended', matchId = 'priya'): RelationshipAction => ({ type: 'crewStatusChanged', matchId, status });
const answerRide = (rideDate: string, answer: 'confirmed' | 'skipped', matchId = 'priya'): RelationshipAction => ({
  type: 'crewRideAnswered',
  matchId,
  rideDate,
  answer,
});

const status = (state: RelationshipState) => crewFor(state, 'priya')?.status ?? null;

function activeCrew(): RelationshipState {
  return apply(afterRide('yes', 'yes'), propose(), accept());
}

const crew = (overrides: Partial<Crew> = {}): Crew => ({ status: 'proposed', days: ['Mon'], departureTime: '7:45 AM', rides: {}, ...overrides });

test('canProposeCrew needs Crew eligibility and no open Crew', () => {
  const outcomes: ConnectionOutcome[] = ['none', 'ride_again', 'ride_again_crew_eligible'];
  const statuses: CrewStatus[] = ['proposed', 'active', 'paused', 'ended', 'not_started'];
  for (const outcome of outcomes) {
    assert.equal(canProposeCrew(outcome, null), outcome === 'ride_again_crew_eligible', outcome);
    for (const s of statuses) {
      const open = s === 'proposed' || s === 'active' || s === 'paused';
      assert.equal(canProposeCrew(outcome, crew({ status: s })), outcome === 'ride_again_crew_eligible' && !open, `${outcome} ${s}`);
    }
  }
});

test('isOpenCrew is true for proposed, active and paused only', () => {
  assert.equal(isOpenCrew(null), false);
  assert.equal(isOpenCrew(crew({ status: 'proposed' })), true);
  assert.equal(isOpenCrew(crew({ status: 'active' })), true);
  assert.equal(isOpenCrew(crew({ status: 'paused' })), true);
  assert.equal(isOpenCrew(crew({ status: 'ended' })), false);
  assert.equal(isOpenCrew(crew({ status: 'not_started' })), false);
});

test('isValidCrewDays is a non-empty subset of the shared days', () => {
  assert.equal(isValidCrewDays([], ['Mon', 'Tue']), false);
  assert.equal(isValidCrewDays(['Thu'], ['Mon', 'Tue']), false);
  assert.equal(isValidCrewDays(['Mon', 'Thu'], ['Mon', 'Tue']), false);
  assert.equal(isValidCrewDays(['Tue'], ['Mon', 'Tue']), true);
  assert.equal(isValidCrewDays(['Tue', 'Mon'], ['Mon', 'Tue']), true);
});

test('an empty relationship state has no Crews', () => {
  const state = emptyRelationshipState('u1');
  assert.deepEqual(state, { firstRide: emptyFirstRideState('u1'), crews: {} });
  assert.equal(crewFor(state, 'priya'), null);
});

test('crewProposed creates a proposed Crew with sorted, de-duplicated days for Yes and Yes', () => {
  const before = afterRide('yes', 'yes');
  const state = apply(before, propose(['Fri', 'Mon', 'Fri']));
  assert.deepEqual(crewFor(state, 'priya'), { status: 'proposed', days: ['Mon', 'Fri'], departureTime: '7:45 AM', rides: {} });
  assert.equal(crewFor(before, 'priya'), null);
});

test('crewProposed is ignored without Crew eligibility', () => {
  for (const state of [afterRide('yes', 'individual'), afterRide('individual', 'yes'), afterRide('yes', 'no'), afterRide('yes', null)]) {
    assert.equal(apply(state, propose()), state);
  }
  const fresh = emptyRelationshipState('prototype');
  assert.equal(apply(fresh, propose()), fresh);
});

test('crewProposed is ignored for invalid days', () => {
  const state = afterRide('yes', 'yes');
  assert.equal(apply(state, propose([])), state);
  assert.equal(apply(state, propose(['Tue'])), state);
  assert.equal(apply(state, propose(['Mon', 'Thu'])), state);
});

test('crewProposed is ignored while a Crew is open', () => {
  const proposed = apply(afterRide('yes', 'yes'), propose());
  assert.equal(apply(proposed, propose(['Fri'])), proposed);
  const active = apply(proposed, accept());
  assert.equal(apply(active, propose(['Fri'])), active);
  const paused = apply(active, setStatus('paused'));
  assert.equal(apply(paused, propose(['Fri'])), paused);
});

test('a Crew for one match leaves other matches alone', () => {
  const state = apply(afterRide('yes', 'yes'), propose());
  assert.equal(crewFor(state, 'sam'), null);
});

test('crewAnswerSimulated: accept activates, decline gives not_started', () => {
  const proposed = apply(afterRide('yes', 'yes'), propose());
  assert.equal(status(apply(proposed, accept())), 'active');
  assert.equal(status(apply(proposed, decline())), 'not_started');
});

test('crewAnswerSimulated is ignored unless the Crew is proposed', () => {
  const none = afterRide('yes', 'yes');
  assert.equal(apply(none, accept()), none);
  const active = activeCrew();
  assert.equal(apply(active, accept()), active);
  assert.equal(apply(active, decline()), active);
  const paused = apply(active, setStatus('paused'));
  assert.equal(apply(paused, accept()), paused);
  const ended = apply(active, setStatus('ended'));
  assert.equal(apply(ended, accept()), ended);
  const declined = apply(afterRide('yes', 'yes'), propose(), decline());
  assert.equal(apply(declined, accept()), declined);
});

test('crewStatusChanged: active, paused, active, ended', () => {
  const active = activeCrew();
  const paused = apply(active, setStatus('paused'));
  assert.equal(status(paused), 'paused');
  const resumed = apply(paused, setStatus('active'));
  assert.equal(status(resumed), 'active');
  assert.equal(status(apply(resumed, setStatus('ended'))), 'ended');
  assert.equal(status(apply(paused, setStatus('ended'))), 'ended');
});

test('crewStatusChanged keeps the Crew days, time and answers', () => {
  const state = apply(activeCrew(), answerRide('2026-10-12', 'confirmed'), setStatus('paused'));
  assert.deepEqual(crewFor(state, 'priya'), { status: 'paused', days: ['Mon', 'Wed'], departureTime: '7:45 AM', rides: { '2026-10-12': 'confirmed' } });
});

test('crewStatusChanged ignores transitions the RPCs reject', () => {
  const proposed = apply(afterRide('yes', 'yes'), propose());
  assert.equal(apply(proposed, setStatus('paused')), proposed);
  assert.equal(apply(proposed, setStatus('active')), proposed);
  assert.equal(apply(proposed, setStatus('ended')), proposed);
  const ended = apply(activeCrew(), setStatus('ended'));
  assert.equal(apply(ended, setStatus('active')), ended);
  assert.equal(apply(ended, setStatus('paused')), ended);
  const notStarted = apply(afterRide('yes', 'yes'), propose(), decline());
  assert.equal(apply(notStarted, setStatus('active')), notStarted);
  const none = afterRide('yes', 'yes');
  assert.equal(apply(none, setStatus('ended')), none);
  const active = activeCrew();
  assert.equal(apply(active, setStatus('active')), active);
  const paused = apply(active, setStatus('paused'));
  assert.equal(apply(paused, setStatus('paused')), paused);
});

test('a new proposal after ended or not_started replaces the Crew with a fresh one', () => {
  const ended = apply(activeCrew(), answerRide('2026-10-12', 'confirmed'), setStatus('ended'));
  const again = apply(ended, propose(['Fri']));
  assert.deepEqual(crewFor(again, 'priya'), { status: 'proposed', days: ['Fri'], departureTime: '7:45 AM', rides: {} });
  const declined = apply(afterRide('yes', 'yes'), propose(), decline());
  assert.equal(status(apply(declined, propose())), 'proposed');
});

test('a proposed Crew becomes not_started when the partner is only open to individual rides', () => {
  const state = apply(afterRide('yes', 'yes'), propose(), { type: 'partnerAnswerSimulated', matchId: 'priya', answer: 'individual' });
  assert.equal(status(state), 'not_started');
});

test('an active Crew stays active when the partner changes to individual, and ends on no', () => {
  const active = activeCrew();
  const individual = apply(active, { type: 'partnerAnswerSimulated', matchId: 'priya', answer: 'individual' });
  assert.equal(status(individual), 'active');
  assert.equal(status(apply(active, { type: 'partnerAnswerSimulated', matchId: 'priya', answer: 'no' })), 'ended');
});

test('a paused Crew ends when the partner says no and stays paused on individual', () => {
  const paused = apply(activeCrew(), setStatus('paused'));
  assert.equal(status(apply(paused, { type: 'partnerAnswerSimulated', matchId: 'priya', answer: 'individual' })), 'paused');
  assert.equal(status(apply(paused, { type: 'partnerAnswerSimulated', matchId: 'priya', answer: 'no' })), 'ended');
});

test('a Crew ends when my own answer changes the connection to none', () => {
  const state = apply(activeCrew(), { type: 'rideBooked', matchId: 'priya' }, { type: 'rideCompleted', matchId: 'priya' });
  const ride = latestRide(state.firstRide, 'priya');
  assert.ok(ride);
  const noMore = apply(state, { type: 'feedbackSubmitted', rideId: ride.id, feedback: { experience: 'not_a_fit', rideAgain: 'no' } });
  assert.equal(status(noMore), 'ended');
});

test('a later partner yes never reopens an ended Crew', () => {
  const ended = apply(activeCrew(), { type: 'partnerAnswerSimulated', matchId: 'priya', answer: 'no' });
  assert.equal(status(ended), 'ended');
  const back = apply(ended, { type: 'partnerAnswerSimulated', matchId: 'priya', answer: 'yes' });
  assert.equal(status(back), 'ended');
});

test('connection changes keep object identity when no Crew changes', () => {
  const active = activeCrew();
  const next = apply(active, { type: 'partnerAnswerSimulated', matchId: 'priya', answer: 'individual' });
  assert.equal(crewFor(next, 'priya'), crewFor(active, 'priya'));
  assert.equal(next.crews, active.crews);
});

test('nextCrewRide walks the Crew days and skips answered dates', () => {
  let state = activeCrew();
  const next = (from = '2026-10-13') => nextCrewRide(crewFor(state, 'priya') as Crew, from);
  assert.equal(next(), '2026-10-14');
  state = apply(state, answerRide('2026-10-14', 'skipped'));
  assert.equal(next(), '2026-10-19');
  state = apply(state, answerRide('2026-10-19', 'confirmed'));
  assert.equal(next(), '2026-10-21');
  assert.deepEqual(confirmedCrewRides(crewFor(state, 'priya') as Crew, '2026-10-13'), ['2026-10-19']);
});

test('nextCrewRide includes the from date itself', () => {
  assert.equal(nextCrewRide(crew({ status: 'active', days: ['Mon', 'Wed'] }), '2026-10-12'), '2026-10-12');
});

test('nextCrewRide is null unless the Crew is active, and resumes at the same date', () => {
  const proposed = apply(afterRide('yes', 'yes'), propose());
  assert.equal(nextCrewRide(crewFor(proposed, 'priya') as Crew, '2026-10-13'), null);
  const active = apply(proposed, accept());
  const paused = apply(active, setStatus('paused'));
  assert.equal(nextCrewRide(crewFor(paused, 'priya') as Crew, '2026-10-13'), null);
  const resumed = apply(paused, setStatus('active'));
  assert.equal(nextCrewRide(crewFor(resumed, 'priya') as Crew, '2026-10-13'), '2026-10-14');
  for (const s of ['ended', 'not_started'] as const) {
    assert.equal(nextCrewRide(crew({ status: s, days: ['Mon'] }), '2026-10-13'), null);
  }
});

test('confirmedCrewRides is ascending, on or after the from date, and confirmed only', () => {
  const rides = { '2026-10-21': 'confirmed', '2026-10-12': 'confirmed', '2026-10-14': 'skipped', '2026-10-19': 'confirmed' } as const;
  const c = crew({ status: 'paused', days: ['Mon', 'Wed'], rides: { ...rides } });
  assert.deepEqual(confirmedCrewRides(c, '2026-10-13'), ['2026-10-19', '2026-10-21']);
  assert.deepEqual(confirmedCrewRides(c, '2026-10-12'), ['2026-10-12', '2026-10-19', '2026-10-21']);
  assert.deepEqual(confirmedCrewRides(c, '2026-10-22'), []);
});

test('crewRideAnswered is ignored unless the Crew is active', () => {
  const proposed = apply(afterRide('yes', 'yes'), propose());
  assert.equal(apply(proposed, answerRide('2026-10-12', 'confirmed')), proposed);
  const paused = apply(activeCrew(), setStatus('paused'));
  assert.equal(apply(paused, answerRide('2026-10-12', 'confirmed')), paused);
  const none = afterRide('yes', 'yes');
  assert.equal(apply(none, answerRide('2026-10-12', 'confirmed')), none);
});

test('crewRideAnswered is ignored for a date off the Crew days and for an answered date', () => {
  const active = activeCrew();
  assert.equal(apply(active, answerRide('2026-10-13', 'confirmed')), active);
  assert.equal(apply(active, answerRide('2026-10-17', 'skipped')), active);
  assert.equal(apply(active, answerRide('not-a-date', 'skipped')), active);
  const answered = apply(active, answerRide('2026-10-12', 'skipped'));
  assert.deepEqual(crewFor(answered, 'priya')?.rides, { '2026-10-12': 'skipped' });
  assert.equal(apply(answered, answerRide('2026-10-12', 'confirmed')), answered);
});

test('crewRideAnswered only records my answer and creates no rides', () => {
  const active = activeCrew();
  const answered = apply(active, answerRide('2026-10-12', 'confirmed'));
  assert.deepEqual(crewFor(answered, 'priya')?.rides, { '2026-10-12': 'confirmed' });
  assert.equal(answered.firstRide, active.firstRide);
});

test('ownerChanged to another owner clears Crews and First Ride state; the same owner is a no-op', () => {
  const state = activeCrew();
  assert.equal(apply(state, { type: 'ownerChanged', owner: 'prototype' }), state);
  const other = apply(state, { type: 'ownerChanged', owner: 'u2' });
  assert.deepEqual(other, emptyRelationshipState('u2'));
  assert.deepEqual(apply(state, { type: 'ownerChanged', owner: null }), emptyRelationshipState(null));
});
