import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConnection, type RideAgainAnswer } from '../state/connection';
import {
  INITIAL_FIRST_RIDE_STATE,
  canSubmitFeedback,
  connectionFor,
  firstRideReducer,
  isConnected,
  postRideRoute,
  relationshipFor,
  type Feedback,
  type FirstRideState,
  type MatchRelationship,
} from './firstRide';

const ANSWERS: (RideAgainAnswer | null)[] = ['yes', 'individual', 'no', null];

function completed(matchId = 'priya'): FirstRideState {
  return firstRideReducer(INITIAL_FIRST_RIDE_STATE, { type: 'rideCompleted', matchId });
}

function submitted(feedback: Feedback, matchId = 'priya'): FirstRideState {
  return firstRideReducer(completed(matchId), { type: 'feedbackSubmitted', matchId, feedback });
}

function withPartner(state: FirstRideState, answer: RideAgainAnswer | null, matchId = 'priya'): FirstRideState {
  return answer === null ? state : firstRideReducer(state, { type: 'partnerAnswerSimulated', matchId, answer });
}

test('canSubmitFeedback needs at least one answer', () => {
  assert.equal(canSubmitFeedback({ experience: null, rideAgain: null }), false);
  assert.equal(canSubmitFeedback({ experience: 'good', rideAgain: null }), true);
  assert.equal(canSubmitFeedback({ experience: null, rideAgain: 'no' }), true);
  assert.equal(canSubmitFeedback({ experience: 'not_a_fit', rideAgain: 'individual' }), true);
});

test('relationshipFor gives an unknown match a confirmed ride with nothing recorded', () => {
  const rel = relationshipFor(INITIAL_FIRST_RIDE_STATE, 'nobody');
  assert.deepEqual(rel, { rideStatus: 'confirmed', myFeedback: null, simulatedPartnerAnswer: null });
});

test('rideCompleted completes a confirmed ride and leaves completed or cancelled rides alone', () => {
  assert.equal(relationshipFor(completed(), 'priya').rideStatus, 'completed');

  const again = firstRideReducer(completed(), { type: 'rideCompleted', matchId: 'priya' });
  assert.equal(relationshipFor(again, 'priya').rideStatus, 'completed');

  const cancelled: FirstRideState = { matches: { priya: { rideStatus: 'cancelled', myFeedback: null, simulatedPartnerAnswer: null } } };
  assert.equal(firstRideReducer(cancelled, { type: 'rideCompleted', matchId: 'priya' }), cancelled);
});

test('feedbackSubmitted records either answer on a completed ride', () => {
  const onlyExperience = submitted({ experience: 'great', rideAgain: null });
  assert.deepEqual(relationshipFor(onlyExperience, 'priya').myFeedback, { experience: 'great', rideAgain: null });

  const onlyRideAgain = submitted({ experience: null, rideAgain: 'individual' });
  assert.deepEqual(relationshipFor(onlyRideAgain, 'priya').myFeedback, { experience: null, rideAgain: 'individual' });
});

test('feedbackSubmitted is ignored before the ride is completed', () => {
  const state = firstRideReducer(INITIAL_FIRST_RIDE_STATE, {
    type: 'feedbackSubmitted',
    matchId: 'priya',
    feedback: { experience: 'great', rideAgain: 'yes' },
  });
  assert.equal(state, INITIAL_FIRST_RIDE_STATE);
});

test('feedbackSubmitted is ignored with no answer, so "Decide later" records nothing', () => {
  const before = completed();
  const after = firstRideReducer(before, { type: 'feedbackSubmitted', matchId: 'priya', feedback: { experience: null, rideAgain: null } });
  assert.equal(after, before);
  assert.equal(relationshipFor(after, 'priya').myFeedback, null);
});

test('feedbackSubmitted keeps the first answer: the prototype has no editing', () => {
  const first = submitted({ experience: 'good', rideAgain: 'yes' });
  const second = firstRideReducer(first, { type: 'feedbackSubmitted', matchId: 'priya', feedback: { experience: null, rideAgain: 'no' } });
  assert.equal(second, first);
});

test('partnerAnswerSimulated sets only that match', () => {
  const state = withPartner(completed(), 'individual');
  assert.equal(relationshipFor(state, 'priya').simulatedPartnerAnswer, 'individual');
  assert.equal(relationshipFor(state, 'marcus').simulatedPartnerAnswer, null);

  const changed = withPartner(state, 'no');
  assert.equal(relationshipFor(changed, 'priya').simulatedPartnerAnswer, 'no');
});

test('actions on one match never touch another', () => {
  const state = submitted({ experience: 'great', rideAgain: 'yes' }, 'priya');
  const other = firstRideReducer(state, { type: 'rideCompleted', matchId: 'marcus' });
  assert.equal(relationshipFor(other, 'priya'), relationshipFor(state, 'priya'));
});

test('postRideRoute opens Post-ride until feedback is recorded, then Thanks', () => {
  assert.equal(postRideRoute(relationshipFor(completed(), 'priya')), 'postRide');
  assert.equal(postRideRoute(relationshipFor(submitted({ experience: 'good', rideAgain: null }), 'priya')), 'postRideThanks');
});

test('connectionFor follows resolveConnection for every pair of answers', () => {
  for (const mine of ANSWERS) {
    for (const theirs of ANSWERS) {
      const state = withPartner(submitted({ experience: 'good', rideAgain: mine }), theirs);
      assert.equal(connectionFor(relationshipFor(state, 'priya'), resolveConnection), resolveConnection(mine, theirs), `mine=${mine} theirs=${theirs}`);
    }
  }
});

test('connectionFor: Yes + Yes is Crew-eligible, Yes + Individual is Ride Again', () => {
  const yesYes = withPartner(submitted({ experience: null, rideAgain: 'yes' }), 'yes');
  assert.equal(connectionFor(relationshipFor(yesYes, 'priya'), resolveConnection), 'ride_again_crew_eligible');

  const yesIndividual = withPartner(submitted({ experience: null, rideAgain: 'yes' }), 'individual');
  assert.equal(connectionFor(relationshipFor(yesIndividual, 'priya'), resolveConnection), 'ride_again');
});

test('connectionFor never connects a ride that is not completed', () => {
  const rel: MatchRelationship = { rideStatus: 'cancelled', myFeedback: { experience: null, rideAgain: 'yes' }, simulatedPartnerAnswer: 'yes' };
  assert.equal(connectionFor(rel, resolveConnection), 'none');
  assert.equal(connectionFor({ ...rel, rideStatus: 'confirmed' }, resolveConnection), 'none');
});

test('the partner saying "no" looks exactly like the partner not answering', () => {
  for (const mine of ANSWERS) {
    const base = submitted({ experience: 'great', rideAgain: mine });
    const no = connectionFor(relationshipFor(withPartner(base, 'no'), 'priya'), resolveConnection);
    const unanswered = connectionFor(relationshipFor(base, 'priya'), resolveConnection);
    assert.equal(no, unanswered, `mine=${mine}`);
    assert.equal(isConnected(no), isConnected(unanswered), `mine=${mine}`);
  }
});

test('my own "no" or no ride-again answer never connects, whatever the partner says', () => {
  for (const mine of ['no', null] as const) {
    for (const theirs of ANSWERS) {
      const state = withPartner(submitted({ experience: 'good', rideAgain: mine }), theirs);
      assert.equal(isConnected(connectionFor(relationshipFor(state, 'priya'), resolveConnection)), false, `mine=${mine} theirs=${theirs}`);
    }
  }
});

test('isConnected is true for both Ride Again outcomes only', () => {
  assert.equal(isConnected('none'), false);
  assert.equal(isConnected('ride_again'), true);
  assert.equal(isConnected('ride_again_crew_eligible'), true);
});
