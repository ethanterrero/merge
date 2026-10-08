// Pure First Ride connection rules, mirroring `resolve_connection` in the First
// Ride spec. No React Native imports here, so `npm test` can run this file under Node.

export type RideAgainAnswer = 'yes' | 'individual' | 'no';
export type ConnectionOutcome = 'none' | 'ride_again' | 'ride_again_crew_eligible';
export type CrewStatus = 'proposed' | 'active' | 'paused' | 'ended' | 'not_started';

const OPEN_TO_RIDE_AGAIN: (RideAgainAnswer | null)[] = ['yes', 'individual'];

/**
 * Rules 1–2. "No" and "not answered" give the same result, so nothing built on
 * this can reveal which one the other person chose.
 */
export function resolveConnection(mine: RideAgainAnswer | null, theirs: RideAgainAnswer | null): ConnectionOutcome {
  if (!OPEN_TO_RIDE_AGAIN.includes(mine) || !OPEN_TO_RIDE_AGAIN.includes(theirs)) return 'none';
  return mine === 'yes' && theirs === 'yes' ? 'ride_again_crew_eligible' : 'ride_again';
}

/**
 * Rules 3–4. With no connection, an open Crew ends. Losing Crew eligibility
 * only withdraws a pending proposal: members end an active or paused Crew themselves.
 */
export function crewStatusAfter(outcome: ConnectionOutcome, current: CrewStatus): CrewStatus {
  if (outcome === 'none' && (current === 'proposed' || current === 'active' || current === 'paused')) return 'ended';
  if (outcome === 'ride_again' && current === 'proposed') return 'not_started';
  return current;
}
