// Pure Commute Crew rules for the prototype (First Ride spec, "Commitment
// levels" and `commute_crews`). The provider in src/state/firstRide.tsx holds
// this state. It wraps the First Ride state, because a Crew's status follows the
// pair's connection. Nothing here imports React Native, Expo or app state, so
// `npm test` can run it under Node. `resolveConnection` and `crewStatusAfter` are
// passed in as `CrewRules` rather than imported, the way lib/firstRide.ts takes
// `resolveConnection`.
//
// Crew transitions mirror the RPCs: a proposal needs Crew eligibility and no open
// Crew, the other person's answer works only on a `proposed` Crew, and either
// member can pause, resume or end. A Crew never creates rides on its own:
// `crewRideAnswered` only records my answer for one date.

import type { Weekday } from '../data/mock';
import type { ConnectionOutcome, CrewStatus } from '../state/connection';
import { fromIsoWeekdays, nextRideDates, toIsoWeekdays } from './dates';
import {
  connectionFor,
  emptyFirstRideState,
  firstRideReducer,
  type FirstRideAction,
  type FirstRideState,
  type ResolveConnection,
} from './firstRide';

/** My answer to one Crew ride's invitation. Skipping declines that day only. */
export type CrewRideAnswer = 'confirmed' | 'skipped';

export type Crew = {
  status: CrewStatus;
  days: Weekday[];
  /** A picker time like '7:45 AM'. */
  departureTime: string;
  /** My answer per date, keyed by 'YYYY-MM-DD'. A date with no entry is unanswered. */
  rides: Record<string, CrewRideAnswer>;
};

export type CrewAction =
  | { type: 'crewProposed'; matchId: string; days: Weekday[]; sharedDays: Weekday[]; departureTime: string }
  /** Prototype only: stands in for the other person accepting or declining the proposal. */
  | { type: 'crewAnswerSimulated'; matchId: string; accept: boolean }
  | { type: 'crewStatusChanged'; matchId: string; status: 'active' | 'paused' | 'ended' }
  | { type: 'crewRideAnswered'; matchId: string; rideDate: string; answer: CrewRideAnswer };

/** First Ride state plus each pair's Crew, keyed by match id. */
export type RelationshipState = { firstRide: FirstRideState; crews: Record<string, Crew> };

export type RelationshipAction = FirstRideAction | CrewAction;

export type CrewRules = {
  resolveConnection: ResolveConnection;
  crewStatusAfter: (outcome: ConnectionOutcome, current: CrewStatus) => CrewStatus;
};

export function emptyRelationshipState(owner: string | null): RelationshipState {
  return { firstRide: emptyFirstRideState(owner), crews: {} };
}

export function crewFor(state: RelationshipState, matchId: string): Crew | null {
  return state.crews[matchId] ?? null;
}

/** Proposed, active or paused: the pair's one non-terminal Crew. */
export function isOpenCrew(crew: Crew | null): boolean {
  return crew?.status === 'proposed' || crew?.status === 'active' || crew?.status === 'paused';
}

/** Both answered `yes` and the pair has no open Crew. */
export function canProposeCrew(outcome: ConnectionOutcome, crew: Crew | null): boolean {
  return outcome === 'ride_again_crew_eligible' && !isOpenCrew(crew);
}

/** A Crew's days are a non-empty subset of the pair's shared days. */
export function isValidCrewDays(days: Weekday[], sharedDays: Weekday[]): boolean {
  return days.length > 0 && days.every((day) => sharedDays.includes(day));
}

// Each answered date can hide at most one slot, so answered count + 1 dates always
// include an unanswered one.
function unansweredDates(crew: Crew, fromDate: string): string[] {
  const answered = Object.keys(crew.rides).length;
  return nextRideDates(crew.days, fromDate, answered + 1).filter((date) => crew.rides[date] === undefined);
}

/**
 * The first date on or after `fromDate` on the Crew's days with no answer.
 * Null unless the Crew is `active`, so a paused Crew shows no next ride and
 * resuming brings the same one back.
 */
export function nextCrewRide(crew: Crew, fromDate: string): string | null {
  if (crew.status !== 'active') return null;
  return unansweredDates(crew, fromDate)[0] ?? null;
}

/** Confirmed dates on or after `fromDate`, ascending. */
export function confirmedCrewRides(crew: Crew, fromDate: string): string[] {
  return Object.keys(crew.rides)
    .filter((date) => crew.rides[date] === 'confirmed' && date >= fromDate)
    .sort();
}

// True for a real calendar date that falls on one of the Crew's days.
function isCrewDate(crew: Crew, date: string): boolean {
  try {
    return nextRideDates(crew.days, date, 1)[0] === date;
  } catch {
    return false;
  }
}

function withCrew(state: RelationshipState, matchId: string, crew: Crew): RelationshipState {
  return { ...state, crews: { ...state.crews, [matchId]: crew } };
}

function crewReducer(state: RelationshipState, action: CrewAction, rules: CrewRules): RelationshipState {
  const crew = crewFor(state, action.matchId);
  switch (action.type) {
    case 'crewProposed': {
      const outcome = connectionFor(state.firstRide, action.matchId, rules.resolveConnection);
      if (!canProposeCrew(outcome, crew) || !isValidCrewDays(action.days, action.sharedDays)) return state;
      // A re-proposal after `ended` or `not_started` replaces the old Crew.
      return withCrew(state, action.matchId, {
        status: 'proposed',
        days: fromIsoWeekdays(toIsoWeekdays(action.days)),
        departureTime: action.departureTime,
        rides: {},
      });
    }
    case 'crewAnswerSimulated':
      if (crew?.status !== 'proposed') return state;
      return withCrew(state, action.matchId, { ...crew, status: action.accept ? 'active' : 'not_started' });
    case 'crewStatusChanged': {
      if (crew === null) return state;
      const allowed =
        (action.status === 'paused' && crew.status === 'active') ||
        (action.status === 'active' && crew.status === 'paused') ||
        (action.status === 'ended' && (crew.status === 'active' || crew.status === 'paused'));
      return allowed ? withCrew(state, action.matchId, { ...crew, status: action.status }) : state;
    }
    case 'crewRideAnswered':
      if (crew?.status !== 'active' || crew.rides[action.rideDate] !== undefined || !isCrewDate(crew, action.rideDate)) return state;
      return withCrew(state, action.matchId, { ...crew, rides: { ...crew.rides, [action.rideDate]: action.answer } });
  }
}

// Applies `crewStatusAfter` to every Crew, keeping object identity when nothing changes.
function settleCrews(state: RelationshipState, rules: CrewRules): RelationshipState {
  let crews = state.crews;
  for (const [matchId, crew] of Object.entries(state.crews)) {
    const outcome = connectionFor(state.firstRide, matchId, rules.resolveConnection);
    const status = rules.crewStatusAfter(outcome, crew.status);
    if (status !== crew.status) crews = { ...crews, [matchId]: { ...crew, status } };
  }
  return crews === state.crews ? state : { ...state, crews };
}

function isCrewAction(action: RelationshipAction): action is CrewAction {
  return (
    action.type === 'crewProposed' ||
    action.type === 'crewAnswerSimulated' ||
    action.type === 'crewStatusChanged' ||
    action.type === 'crewRideAnswered'
  );
}

/** Returns the same state object when an action changes nothing. */
export function relationshipReducer(state: RelationshipState, action: RelationshipAction, rules: CrewRules): RelationshipState {
  if (isCrewAction(action)) return settleCrews(crewReducer(state, action, rules), rules);
  const firstRide = firstRideReducer(state.firstRide, action);
  if (firstRide === state.firstRide) return state;
  // A different person (or signing out) never sees the previous person's Crews either.
  const crews = action.type === 'ownerChanged' && state.firstRide.owner !== action.owner ? {} : state.crews;
  return settleCrews({ firstRide, crews }, rules);
}
