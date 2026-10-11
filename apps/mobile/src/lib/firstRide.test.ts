import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConnection, type RideAgainAnswer } from '../state/connection';
import {
  INITIAL_FIRST_RIDE_STATE,
  canSubmitFeedback,
  connectionFor,
  firstRideReducer,
  isConnected,
  latestRide,
  myLatestRideAgain,
  postRideRoute,
  type Feedback,
  type FirstRideAction,
  type FirstRideState,
} from './firstRide';

const ANSWERS: (RideAgainAnswer | null)[] = ['yes', 'individual', 'no', null];

function run(...actions: FirstRideAction[]): FirstRideState {
  return actions.reduce(firstRideReducer, INITIAL_FIRST_RIDE_STATE);
}

function apply(state: FirstRideState, ...actions: FirstRideAction[]): FirstRideState {
  return actions.reduce(firstRideReducer, state);
}

const book = (matchId = 'priya'): FirstRideAction => ({ type: 'rideBooked', matchId });
const complete = (matchId = 'priya'): FirstRideAction => ({ type: 'rideCompleted', matchId });
const partner = (answer: RideAgainAnswer, matchId = 'priya'): FirstRideAction => ({ type: 'partnerAnswerSimulated', matchId, answer });

/** Submits feedback on the match's latest ride. */
function answer(state: FirstRideState, feedback: Feedback, matchId = 'priya'): FirstRideState {
  const ride = latestRide(state, matchId);
  assert.ok(ride, `no ride for ${matchId}`);
  return firstRideReducer(state, { type: 'feedbackSubmitted', rideId: ride.id, feedback });
}

function completedRide(feedback: Feedback, matchId = 'priya'): FirstRideState {
  return answer(run(book(matchId), complete(matchId)), feedback, matchId);
}

function withPartner(state: FirstRideState, theirs: RideAgainAnswer | null, matchId = 'priya'): FirstRideState {
  return theirs === null ? state : firstRideReducer(state, partner(theirs, matchId));
}

const outcome = (state: FirstRideState, matchId = 'priya') => connectionFor(state, matchId, resolveConnection);

test('canSubmitFeedback needs at least one answer', () => {
  assert.equal(canSubmitFeedback({ experience: null, rideAgain: null }), false);
  assert.equal(canSubmitFeedback({ experience: 'good', rideAgain: null }), true);
  assert.equal(canSubmitFeedback({ experience: null, rideAgain: 'no' }), true);
  assert.equal(canSubmitFeedback({ experience: 'not_a_fit', rideAgain: 'individual' }), true);
});

test('a match has no ride until one is booked', () => {
  assert.equal(latestRide(INITIAL_FIRST_RIDE_STATE, 'priya'), null);
  const ride = latestRide(run(book()), 'priya');
  assert.ok(ride);
  assert.equal(ride.matchId, 'priya');
  assert.equal(ride.status, 'confirmed');
  assert.equal(ride.myFeedback, null);
});

test('booking again while the ride is still confirmed keeps the same ride', () => {
  const once = run(book());
  assert.equal(firstRideReducer(once, book()), once);
});

test('rideCompleted completes the latest confirmed ride and leaves a completed one alone', () => {
  const state = run(book(), complete());
  assert.equal(latestRide(state, 'priya')?.status, 'completed');
  assert.equal(firstRideReducer(state, complete()), state);
  assert.equal(firstRideReducer(INITIAL_FIRST_RIDE_STATE, complete()), INITIAL_FIRST_RIDE_STATE);
});

test('feedbackSubmitted records either answer on a completed ride', () => {
  assert.deepEqual(latestRide(completedRide({ experience: 'great', rideAgain: null }), 'priya')?.myFeedback, { experience: 'great', rideAgain: null });
  assert.deepEqual(latestRide(completedRide({ experience: null, rideAgain: 'individual' }), 'priya')?.myFeedback, {
    experience: null,
    rideAgain: 'individual',
  });
});

test('feedbackSubmitted is ignored before the ride is completed, or for an unknown ride', () => {
  const booked = run(book());
  assert.equal(answer(booked, { experience: 'great', rideAgain: 'yes' }), booked);
  assert.equal(firstRideReducer(booked, { type: 'feedbackSubmitted', rideId: 'nope', feedback: { experience: 'good', rideAgain: null } }), booked);
});

test('feedbackSubmitted is ignored with no answer, so "Decide later" records nothing', () => {
  const before = run(book(), complete());
  const after = answer(before, { experience: null, rideAgain: null });
  assert.equal(after, before);
  assert.equal(latestRide(after, 'priya')?.myFeedback, null);
});

test('feedbackSubmitted keeps the first answer on a ride: the prototype has no editing', () => {
  const first = completedRide({ experience: 'good', rideAgain: 'yes' });
  assert.equal(answer(first, { experience: null, rideAgain: 'no' }), first);
});

test('booking the same match again after an answered ride starts a fresh ride', () => {
  const first = completedRide({ experience: 'good', rideAgain: 'yes' });
  const firstId = latestRide(first, 'priya')?.id;
  assert.ok(firstId);

  const rebooked = firstRideReducer(first, book());
  const second = latestRide(rebooked, 'priya');
  assert.ok(second);
  assert.notEqual(second.id, firstId);
  assert.equal(second.status, 'confirmed');
  assert.equal(second.myFeedback, null);
  assert.equal(postRideRoute(second), 'postRide');

  // The second ride takes its own feedback, and the first ride's stays as it was.
  const answered = answer(apply(rebooked, complete()), { experience: 'great', rideAgain: 'individual' });
  assert.deepEqual(latestRide(answered, 'priya')?.myFeedback, { experience: 'great', rideAgain: 'individual' });
  assert.deepEqual(answered.rides[firstId].myFeedback, { experience: 'good', rideAgain: 'yes' });
});

test('booking again after "Decide later" starts a fresh ride too', () => {
  const dismissed = run(book(), complete());
  const firstId = latestRide(dismissed, 'priya')?.id;
  const rebooked = firstRideReducer(dismissed, book());
  assert.notEqual(latestRide(rebooked, 'priya')?.id, firstId);
});

test('rides of one match never touch another match', () => {
  const state = completedRide({ experience: 'great', rideAgain: 'yes' }, 'priya');
  const other = apply(state, book('marcus'), complete('marcus'), partner('yes', 'marcus'));
  assert.deepEqual(latestRide(other, 'priya'), latestRide(state, 'priya'));
  assert.equal(outcome(other, 'priya'), outcome(state, 'priya'));
  assert.equal(outcome(other, 'marcus'), 'none');
});

test('postRideRoute opens Post-ride until the ride has feedback, then Thanks', () => {
  const unanswered = latestRide(run(book(), complete()), 'priya');
  const answered = latestRide(completedRide({ experience: 'good', rideAgain: null }), 'priya');
  assert.ok(unanswered && answered);
  assert.equal(postRideRoute(unanswered), 'postRide');
  assert.equal(postRideRoute(answered), 'postRideThanks');
});

test("myLatestRideAgain takes the latest non-null answer across the pair's completed rides", () => {
  const yes = completedRide({ experience: null, rideAgain: 'yes' });
  assert.equal(myLatestRideAgain(yes, 'priya'), 'yes');

  // A later experience-only answer doesn't erase the earlier "yes".
  const experienceOnly = answer(apply(yes, book(), complete()), { experience: 'good', rideAgain: null });
  assert.equal(myLatestRideAgain(experienceOnly, 'priya'), 'yes');

  // A later "no" replaces it.
  const no = answer(apply(experienceOnly, book(), complete()), { experience: null, rideAgain: 'no' });
  assert.equal(myLatestRideAgain(no, 'priya'), 'no');

  // An open ride counts for nothing.
  assert.equal(myLatestRideAgain(run(book()), 'priya'), null);
});

test('connectionFor follows resolveConnection for every pair of answers', () => {
  for (const mine of ANSWERS) {
    for (const theirs of ANSWERS) {
      const state = withPartner(completedRide({ experience: 'good', rideAgain: mine }), theirs);
      assert.equal(outcome(state), resolveConnection(mine, theirs), `mine=${mine} theirs=${theirs}`);
    }
  }
});

test('connectionFor: Yes + Yes is Crew-eligible, Yes + Individual is Ride Again', () => {
  assert.equal(outcome(withPartner(completedRide({ experience: null, rideAgain: 'yes' }), 'yes')), 'ride_again_crew_eligible');
  assert.equal(outcome(withPartner(completedRide({ experience: null, rideAgain: 'yes' }), 'individual')), 'ride_again');
});

test('connectionFor uses my latest answer when the same match is booked twice', () => {
  const firstYes = withPartner(completedRide({ experience: null, rideAgain: 'yes' }), 'yes');
  assert.equal(outcome(firstYes), 'ride_again_crew_eligible');

  // While the second ride is open, the first ride's answer still stands.
  const rebooked = apply(firstYes, book());
  assert.equal(outcome(rebooked), 'ride_again_crew_eligible');

  const thenIndividual = answer(apply(rebooked, complete()), { experience: null, rideAgain: 'individual' });
  assert.equal(outcome(thenIndividual), 'ride_again');

  const thenNo = answer(apply(thenIndividual, book(), complete()), { experience: 'not_a_fit', rideAgain: 'no' });
  assert.equal(outcome(thenNo), 'none');
});

test('nothing connects before a ride is completed', () => {
  assert.equal(outcome(apply(run(book()), partner('yes'))), 'none');
  assert.equal(outcome(withPartner(INITIAL_FIRST_RIDE_STATE, 'yes')), 'none');
});

test('the partner saying "no" looks exactly like the partner not answering', () => {
  for (const mine of ANSWERS) {
    const base = completedRide({ experience: 'great', rideAgain: mine });
    const no = outcome(withPartner(base, 'no'));
    const unanswered = outcome(base);
    assert.equal(no, unanswered, `mine=${mine}`);
    assert.equal(isConnected(no), isConnected(unanswered), `mine=${mine}`);
  }
});

test('my own "no" or no ride-again answer never connects, whatever the partner says', () => {
  for (const mine of ['no', null] as const) {
    for (const theirs of ANSWERS) {
      const state = withPartner(completedRide({ experience: 'good', rideAgain: mine }), theirs);
      assert.equal(isConnected(outcome(state)), false, `mine=${mine} theirs=${theirs}`);
    }
  }
});

test('partnerAnswerSimulated sets only that pair, and repeating it changes nothing', () => {
  const state = run(partner('individual'));
  assert.equal(state.partnerAnswers.priya, 'individual');
  assert.equal(state.partnerAnswers.marcus, undefined);
  assert.equal(firstRideReducer(state, partner('individual')), state);
});

test('isConnected is true for both Ride Again outcomes only', () => {
  assert.equal(isConnected('none'), false);
  assert.equal(isConnected('ride_again'), true);
  assert.equal(isConnected('ride_again_crew_eligible'), true);
});

test('ownerChanged clears every ride and answer when the signed-in person changes', () => {
  const owned = firstRideReducer(INITIAL_FIRST_RIDE_STATE, { type: 'ownerChanged', owner: 'user-a' });
  const withRides = answer(apply(owned, book(), complete(), partner('yes')), { experience: 'great', rideAgain: 'yes' });
  assert.equal(outcome(withRides), 'ride_again_crew_eligible');
  assert.equal(firstRideReducer(withRides, { type: 'ownerChanged', owner: 'user-a' }), withRides);

  const switched = firstRideReducer(withRides, { type: 'ownerChanged', owner: 'user-b' });
  assert.equal(switched.owner, 'user-b');
  assert.deepEqual(switched.rides, {});
  assert.deepEqual(switched.partnerAnswers, {});
  assert.equal(latestRide(switched, 'priya'), null);
  assert.equal(outcome(switched), 'none');

  const signedOut = firstRideReducer(withRides, { type: 'ownerChanged', owner: null });
  assert.equal(signedOut.owner, null);
  assert.equal(latestRide(signedOut, 'priya'), null);
  assert.equal(outcome(signedOut), 'none');
});
