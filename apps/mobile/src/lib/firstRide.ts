// Pure First Ride relationship rules for the prototype (First Ride spec,
// "Safeguards", "New screens" 1–2 and "State"). The provider in
// src/state/firstRide.tsx holds this state; nothing here imports React Native,
// Expo or app state, so `npm test` can run it under Node. `resolveConnection` is
// passed in rather than imported, the same way authRules.ts keeps platform code out.
//
// Feedback belongs to a ride (one `ride_feedback` row per ride and author), and
// the pair's connection is derived from all of that pair's completed rides, as
// `resolve_connection` does.

import type { ConnectionOutcome, RideAgainAnswer } from '../state/connection';

export type Experience = 'great' | 'good' | 'not_a_fit';

/** Mirrors `rides.status`. */
export type RideStatus = 'confirmed' | 'completed' | 'cancelled';

/** My post-ride answers. Either may be missing, as in `ride_feedback`. */
export type Feedback = { experience: Experience | null; rideAgain: RideAgainAnswer | null };

export type Ride = {
  id: string;
  matchId: string;
  status: RideStatus;
  /** Null until I submit. "Decide later" leaves it null: nothing is recorded. */
  myFeedback: Feedback | null;
  /**
   * Orders my answers across rides, standing in for the server-set
   * `ride_feedback.ride_again_at`. Null until feedback is recorded.
   */
  answeredSeq: number | null;
};

/**
 * Local First Ride state for one signed-in person (`owner`). M-28 adds the
 * Crew per pair here (status, days, time), and applies `crewStatusAfter`
 * whenever the pair's connection outcome changes.
 */
export type FirstRideState = {
  /** Whose state this is: 'prototype', the signed-in user's id, or null when signed out. */
  owner: string | null;
  rides: Record<string, Ride>;
  /** Each match's most recently booked ride id. */
  latestRideId: Record<string, string>;
  /**
   * Prototype only: stands in for the other person's latest ride-again answer,
   * per pair. Missing means "not answered", which the UI never tells apart from "no".
   */
  partnerAnswers: Record<string, RideAgainAnswer>;
  /** Counter for ride ids and answer order. */
  seq: number;
};

export type FirstRideAction =
  | { type: 'rideBooked'; matchId: string }
  | { type: 'rideCompleted'; matchId: string }
  | { type: 'feedbackSubmitted'; rideId: string; feedback: Feedback }
  | { type: 'partnerAnswerSimulated'; matchId: string; answer: RideAgainAnswer }
  | { type: 'ownerChanged'; owner: string | null };

export type ResolveConnection = (mine: RideAgainAnswer | null, theirs: RideAgainAnswer | null) => ConnectionOutcome;

export function emptyFirstRideState(owner: string | null): FirstRideState {
  return { owner, rides: {}, latestRideId: {}, partnerAnswers: {}, seq: 0 };
}

export const INITIAL_FIRST_RIDE_STATE: FirstRideState = emptyFirstRideState(null);

export function latestRide(state: FirstRideState, matchId: string): Ride | null {
  const id = state.latestRideId[matchId];
  return id === undefined ? null : (state.rides[id] ?? null);
}

/** Submit is enabled once either question is answered. */
export function canSubmitFeedback(feedback: Feedback): boolean {
  return feedback.experience !== null || feedback.rideAgain !== null;
}

/** Returns the same state object when an action changes nothing. */
export function firstRideReducer(state: FirstRideState, action: FirstRideAction): FirstRideState {
  switch (action.type) {
    case 'rideBooked': {
      // Requesting the same match again while its ride is still open keeps that ride.
      if (latestRide(state, action.matchId)?.status === 'confirmed') return state;
      const seq = state.seq + 1;
      const ride: Ride = { id: `ride-${seq}`, matchId: action.matchId, status: 'confirmed', myFeedback: null, answeredSeq: null };
      return {
        ...state,
        seq,
        rides: { ...state.rides, [ride.id]: ride },
        latestRideId: { ...state.latestRideId, [action.matchId]: ride.id },
      };
    }
    case 'rideCompleted': {
      const ride = latestRide(state, action.matchId);
      if (ride?.status !== 'confirmed') return state;
      return withRide(state, { ...ride, status: 'completed' });
    }
    case 'feedbackSubmitted': {
      const ride = state.rides[action.rideId];
      // Mirrors the `ride_feedback` RLS rule (completed rides only). The prototype
      // doesn't edit a submitted answer (spec, "Out of scope").
      if (ride?.status !== 'completed' || ride.myFeedback !== null || !canSubmitFeedback(action.feedback)) return state;
      const seq = state.seq + 1;
      return { ...withRide(state, { ...ride, myFeedback: { ...action.feedback }, answeredSeq: seq }), seq };
    }
    case 'partnerAnswerSimulated':
      if (state.partnerAnswers[action.matchId] === action.answer) return state;
      return { ...state, partnerAnswers: { ...state.partnerAnswers, [action.matchId]: action.answer } };
    case 'ownerChanged':
      // A different person (or signing out) never sees the previous person's rides or answers.
      return state.owner === action.owner ? state : emptyFirstRideState(action.owner);
  }
}

function withRide(state: FirstRideState, ride: Ride): FirstRideState {
  return { ...state, rides: { ...state.rides, [ride.id]: ride } };
}

/** Where "simulate ride completed" leads: the form until the ride has my answer, then Thanks. */
export function postRideRoute(ride: Ride): 'postRide' | 'postRideThanks' {
  return ride.myFeedback === null ? 'postRide' : 'postRideThanks';
}

/**
 * Rule 1 of `resolve_connection`: my most recent non-null ride-again answer
 * across the pair's completed rides.
 */
export function myLatestRideAgain(state: FirstRideState, matchId: string): RideAgainAnswer | null {
  let latest: Ride | null = null;
  for (const ride of Object.values(state.rides)) {
    if (ride.matchId !== matchId || ride.status !== 'completed' || ride.myFeedback?.rideAgain == null || ride.answeredSeq === null) continue;
    if (latest === null || (latest.answeredSeq ?? 0) < ride.answeredSeq) latest = ride;
  }
  return latest?.myFeedback?.rideAgain ?? null;
}

/** The pair's connection. The partner's "no" and "not answered" give the same outcome. */
export function connectionFor(state: FirstRideState, matchId: string, resolve: ResolveConnection): ConnectionOutcome {
  return resolve(myLatestRideAgain(state, matchId), state.partnerAnswers[matchId] ?? null);
}

/** Both are open to riding again. Crew eligibility is M-28's to show, on Ride Again. */
export function isConnected(outcome: ConnectionOutcome): boolean {
  return outcome !== 'none';
}
