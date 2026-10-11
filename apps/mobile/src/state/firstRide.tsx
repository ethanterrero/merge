import React, { createContext, useContext, useMemo, useReducer } from 'react';
import { resolveConnection, type ConnectionOutcome, type RideAgainAnswer } from './connection';
import {
  INITIAL_FIRST_RIDE_STATE,
  connectionFor,
  firstRideReducer,
  relationshipFor,
  type Feedback,
  type FirstRideState,
  type MatchRelationship,
} from '../lib/firstRide';

/**
 * Per-match First Ride relationship state: ride status, my feedback and the
 * simulated partner answer. Local-only (mock data). Kept out of state/commute.tsx
 * per D-21. The rules live in src/lib/firstRide.ts.
 */
type Ctx = {
  state: FirstRideState;
  relationship: (matchId: string) => MatchRelationship;
  /** The pair's connection through resolveConnection. Never shows whether the other person said no. */
  connection: (matchId: string) => ConnectionOutcome;
  completeRide: (matchId: string) => void;
  submitFeedback: (matchId: string, feedback: Feedback) => void;
  /** Prototype only: stands in for the other person's answer. */
  simulatePartnerAnswer: (matchId: string, answer: RideAgainAnswer) => void;
};

const FirstRideContext = createContext<Ctx | null>(null);

export function FirstRideProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(firstRideReducer, INITIAL_FIRST_RIDE_STATE);
  const value = useMemo<Ctx>(
    () => ({
      state,
      relationship: (matchId) => relationshipFor(state, matchId),
      connection: (matchId) => connectionFor(relationshipFor(state, matchId), resolveConnection),
      completeRide: (matchId) => dispatch({ type: 'rideCompleted', matchId }),
      submitFeedback: (matchId, feedback) => dispatch({ type: 'feedbackSubmitted', matchId, feedback }),
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
