import React, { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import { crewStatusAfter, resolveConnection, type ConnectionOutcome, type RideAgainAnswer } from './connection';
import { useAuth } from './auth';
import {
  connectionFor,
  latestRide,
  myLatestRideAgain,
  type Feedback,
  type Ride,
} from '../lib/firstRide';
import {
  crewFor,
  emptyRelationshipState,
  relationshipReducer,
  type Crew,
  type CrewRideAnswer,
  type CrewRules,
  type RelationshipAction,
  type RelationshipState,
} from '../lib/crew';
import type { Weekday } from '../data/mock';

/**
 * Per-ride First Ride state (ride status, my feedback), the simulated partner
 * answer per pair, and each pair's Commute Crew. Local-only (mock data), and
 * cleared whenever the signed-in person changes or signs out. Kept out of
 * state/commute.tsx per D-21. The rules live in src/lib/firstRide.ts and
 * src/lib/crew.ts.
 */
type Ctx = {
  /** The match's most recently booked ride, or null if none was booked. */
  latestRide: (matchId: string) => Ride | null;
  /** My latest ride-again answer for the pair. Only ever my own answer. */
  myRideAgain: (matchId: string) => RideAgainAnswer | null;
  /** The pair's connection through resolveConnection. Never shows whether the other person said no. */
  connection: (matchId: string) => ConnectionOutcome;
  /** Prototype only: the simulated answer, to show which simulator option is selected. */
  simulatedPartnerAnswer: (matchId: string) => RideAgainAnswer | null;
  /** Starts a new ride with the match, unless its latest ride is still open. */
  bookRide: (matchId: string) => void;
  completeRide: (matchId: string) => void;
  submitFeedback: (rideId: string, feedback: Feedback) => void;
  /** Prototype only: stands in for the other person's answer. */
  simulatePartnerAnswer: (matchId: string, answer: RideAgainAnswer) => void;
  /** The pair's Commute Crew, or null if none was ever proposed. */
  crew: (matchId: string) => Crew | null;
  /** Proposes a Crew on a subset of the shared days. Ignored unless the pair is Crew-eligible with no open Crew. */
  proposeCrew: (matchId: string, days: Weekday[], sharedDays: Weekday[], departureTime: string) => void;
  /** Prototype only: stands in for the other person accepting or declining the proposal. */
  simulateCrewAnswer: (matchId: string, accept: boolean) => void;
  /** Pauses, resumes or ends the Crew. Ignored when the move isn't allowed from its current status. */
  setCrewStatus: (matchId: string, status: 'active' | 'paused' | 'ended') => void;
  /** Records my answer for one Crew ride date. Skipping declines that day only. */
  answerCrewRide: (matchId: string, rideDate: string, answer: CrewRideAnswer) => void;
};

// Module-level so the reducer function identity is stable across renders.
const RULES: CrewRules = { resolveConnection, crewStatusAfter };
const reducer = (s: RelationshipState, a: RelationshipAction) => relationshipReducer(s, a, RULES);

const FirstRideContext = createContext<Ctx | null>(null);

export function FirstRideProvider({ children }: { children: React.ReactNode }) {
  const { status, profile } = useAuth();
  // profiles.id is the auth user id. Prototype mode has one local person.
  const owner = status === 'prototype' ? 'prototype' : (profile?.id ?? null);
  const [stored, dispatch] = useReducer(reducer, owner, emptyRelationshipState);

  useEffect(() => dispatch({ type: 'ownerChanged', owner }), [owner]);

  // Until the reset lands, never render the previous person's state.
  const state = stored.firstRide.owner === owner ? stored : emptyRelationshipState(owner);

  const value = useMemo<Ctx>(
    () => ({
      latestRide: (matchId) => latestRide(state.firstRide, matchId),
      myRideAgain: (matchId) => myLatestRideAgain(state.firstRide, matchId),
      connection: (matchId) => connectionFor(state.firstRide, matchId, resolveConnection),
      simulatedPartnerAnswer: (matchId) => state.firstRide.partnerAnswers[matchId] ?? null,
      bookRide: (matchId) => dispatch({ type: 'rideBooked', matchId }),
      completeRide: (matchId) => dispatch({ type: 'rideCompleted', matchId }),
      submitFeedback: (rideId, feedback) => dispatch({ type: 'feedbackSubmitted', rideId, feedback }),
      simulatePartnerAnswer: (matchId, answer) => dispatch({ type: 'partnerAnswerSimulated', matchId, answer }),
      crew: (matchId) => crewFor(state, matchId),
      proposeCrew: (matchId, days, sharedDays, departureTime) =>
        dispatch({ type: 'crewProposed', matchId, days, sharedDays, departureTime }),
      simulateCrewAnswer: (matchId, accept) => dispatch({ type: 'crewAnswerSimulated', matchId, accept }),
      setCrewStatus: (matchId, status) => dispatch({ type: 'crewStatusChanged', matchId, status }),
      answerCrewRide: (matchId, rideDate, answer) => dispatch({ type: 'crewRideAnswered', matchId, rideDate, answer }),
    }),
    [state],
  );
  return <FirstRideContext.Provider value={value}>{children}</FirstRideContext.Provider>;
}

export function useFirstRide(): Ctx {
  const ctx = useContext(FirstRideContext);
  if (!ctx) throw new Error('useFirstRide must be used inside FirstRideProvider');
  return ctx;
}
