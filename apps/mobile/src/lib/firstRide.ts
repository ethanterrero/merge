// Pure First Ride relationship rules for the prototype (First Ride spec,
// "Safeguards", "New screens" 1–2 and "State"). The provider in
// src/state/firstRide.tsx holds this state; nothing here imports React Native,
// Expo or app state, so `npm test` can run it under Node. `resolveConnection` is
// passed in rather than imported, the same way authRules.ts keeps platform code out.

import type { ConnectionOutcome, RideAgainAnswer } from '../state/connection';

export type Experience = 'great' | 'good' | 'not_a_fit';

/** Mirrors `rides.status`. */
export type RideStatus = 'confirmed' | 'completed' | 'cancelled';

/** My post-ride answers. Either may be missing, as in `ride_feedback`. */
export type Feedback = { experience: Experience | null; rideAgain: RideAgainAnswer | null };

/**
 * Per-match relationship state. M-28 adds the Crew here (status, days, time),
 * and applies `crewStatusAfter` whenever the connection outcome changes.
 */
export type MatchRelationship = {
  rideStatus: RideStatus;
  /** Null until I submit. "Decide later" leaves it null: nothing is recorded. */
  myFeedback: Feedback | null;
  /**
   * Prototype only: stands in for the other person's latest ride-again answer.
   * Null means "not answered", which the UI must never tell apart from "no".
   */
  simulatedPartnerAnswer: RideAgainAnswer | null;
};

export type FirstRideState = { matches: Record<string, MatchRelationship> };

export type FirstRideAction =
  | { type: 'rideCompleted'; matchId: string }
  | { type: 'feedbackSubmitted'; matchId: string; feedback: Feedback }
  | { type: 'partnerAnswerSimulated'; matchId: string; answer: RideAgainAnswer };

export type ResolveConnection = (mine: RideAgainAnswer | null, theirs: RideAgainAnswer | null) => ConnectionOutcome;

export const INITIAL_FIRST_RIDE_STATE: FirstRideState = { matches: {} };

const NEW_RELATIONSHIP: MatchRelationship = { rideStatus: 'confirmed', myFeedback: null, simulatedPartnerAnswer: null };

export function relationshipFor(state: FirstRideState, matchId: string): MatchRelationship {
  return state.matches[matchId] ?? NEW_RELATIONSHIP;
}

/** Submit is enabled once either question is answered. */
export function canSubmitFeedback(feedback: Feedback): boolean {
  return feedback.experience !== null || feedback.rideAgain !== null;
}

/**
 * Returns the same state object when an action changes nothing, mirroring the
 * `ride_feedback` RLS rule that feedback needs a completed ride.
 */
export function firstRideReducer(state: FirstRideState, action: FirstRideAction): FirstRideState {
  const rel = relationshipFor(state, action.matchId);
  switch (action.type) {
    case 'rideCompleted':
      if (rel.rideStatus !== 'confirmed') return state;
      return withRelationship(state, action.matchId, { ...rel, rideStatus: 'completed' });
    case 'feedbackSubmitted':
      // The prototype doesn't edit a submitted answer (spec, "Out of scope").
      if (rel.rideStatus !== 'completed' || rel.myFeedback !== null || !canSubmitFeedback(action.feedback)) return state;
      return withRelationship(state, action.matchId, { ...rel, myFeedback: { ...action.feedback } });
    case 'partnerAnswerSimulated':
      if (rel.simulatedPartnerAnswer === action.answer) return state;
      return withRelationship(state, action.matchId, { ...rel, simulatedPartnerAnswer: action.answer });
  }
}

function withRelationship(state: FirstRideState, matchId: string, rel: MatchRelationship): FirstRideState {
  return { matches: { ...state.matches, [matchId]: rel } };
}

/** Where "simulate ride completed" leads: the form until I've answered, then Thanks. */
export function postRideRoute(rel: MatchRelationship): 'postRide' | 'postRideThanks' {
  return rel.myFeedback === null ? 'postRide' : 'postRideThanks';
}

/**
 * The pair's connection, per `resolve_connection`: only answers on a completed
 * ride count. The partner's "no" and "not answered" give the same outcome.
 */
export function connectionFor(rel: MatchRelationship, resolve: ResolveConnection): ConnectionOutcome {
  const mine = rel.rideStatus === 'completed' ? (rel.myFeedback?.rideAgain ?? null) : null;
  return resolve(mine, rel.simulatedPartnerAnswer);
}

/** Both are open to riding again. Crew eligibility is M-28's to show, on Ride Again. */
export function isConnected(outcome: ConnectionOutcome): boolean {
  return outcome !== 'none';
}
