// Pure labels for a ride's commitment level (First Ride spec, "Commitment
// levels"). Every request is for one date; `kind` mirrors `rides.kind`. No React
// Native imports here, so `npm test` can run this file under Node.

import { formatRideDate } from './dates';

export type RideKind = 'first_ride' | 'ride_again' | 'crew';

/** "First Ride" for a new match's first trip. Ride Again and Crew rides carry no badge. */
export function rideKindBadge(kind: RideKind): string | null {
  return kind === 'first_ride' ? 'First Ride' : null;
}

/** '2026-10-12', 'first_ride' → 'Mon, Oct 12 · First Ride'; other kinds give the date alone. */
export function rideDateLine(rideDate: string, kind: RideKind): string {
  const date = formatRideDate(rideDate);
  const badge = rideKindBadge(kind);
  return badge ? `${date} · ${badge}` : date;
}
