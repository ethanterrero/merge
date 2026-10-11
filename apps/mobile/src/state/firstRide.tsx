import React, { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import { resolveConnection, type ConnectionOutcome, type RideAgainAnswer } from './connection';
import { useAuth } from './auth';
import {
  connectionFor,
  emptyFirstRideState,
  firstRideReducer,
  latestRide,
  myLatestRideAgain,
  type Feedback,
  type Ride,
} from '../lib/firstRide';

/**
 * Per-ride First Ride state (ride status, my feedback) and the simulated
 * partner answer per pair. Local-only (mock data), and cleared whenever the
 * signed-in person changes or signs out. Kept out of state/commute.tsx per D-21.
 * The rules live in src/lib/firstRide.ts.
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
};

const FirstRideContext = createContext<Ctx | null>(null);

export function FirstRideProvider({ children }: { children: React.ReactNode }) {
  const { status, profile } = useAuth();
  // profiles.id is the auth user id. Prototype mode has one local person.
  const owner = status === 'prototype' ? 'prototype' : (profile?.id ?? null);
  const [stored, dispatch] = useReducer(firstRideReducer, owner, emptyFirstRideState);

  useEffect(() => dispatch({ type: 'ownerChanged', owner }), [owner]);

  // Until the reset lands, never render the previous person's state.
  const state = stored.owner === owner ? stored : emptyFirstRideState(owner);

  const value = useMemo<Ctx>(
    () => ({
      latestRide: (matchId) => latestRide(state, matchId),
      myRideAgain: (matchId) => myLatestRideAgain(state, matchId),
      connection: (matchId) => connectionFor(state, matchId, resolveConnection),
      simulatedPartnerAnswer: (matchId) => state.partnerAnswers[matchId] ?? null,
      bookRide: (matchId) => dispatch({ type: 'rideBooked', matchId }),
      completeRide: (matchId) => dispatch({ type: 'rideCompleted', matchId }),
      submitFeedback: (rideId, feedback) => dispatch({ type: 'feedbackSubmitted', rideId, feedback }),
      simulatePartnerAnswer: (matchId, answer) => dispatch({ type: 'partnerAnswerSimulated', matchId, answer }),
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
