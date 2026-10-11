// Pure logic for the role-aware Trips tab (M-23). Spec:
// docs/superpowers/specs/2026-10-10-trips-tab-design.md. No React Native, Expo,
// app-state or Supabase imports, so `npm test` runs it under Node; `import type`
// lines are erased by tsx.
//
// Append-only for M-35, M-36 and M-47 (owner question 3): add types, fields and
// functions, and keep both sides on a rebase conflict.

import type { RideRequest } from '../data/mock';
import type { Role } from '../state/commute';
import type { QueryState } from './data/types';
import { GENERIC_ERROR } from './data/errors';
import { REPLY_CUTOFF_MINUTES, addDays, formatRideDate, formatTime } from './dates';
import { rideDateLine, type RideKind } from './rideKind';

export type TripsSegment = 'requests' | 'upcoming' | 'past';
export type Side = 'driving' | 'riding';

/**
 * The other person on a trip item. `id` is their profile id in connected mode. In
 * prototype mode it is the stand-in the block menus use (a match id, or a request id
 * for the driver's request screen), so blocking there hides them here.
 */
export type TripPerson = { id: string; name: string; initials: string; verified: boolean };

/** A passenger's request to me as a driver. No pickup spot exists before confirmation. */
export type IncomingRequest = {
  id: string;
  person: TripPerson;
  rideDate: string;
  kind: RideKind;
  addedDetour: string;
  pickupTime: string;
  seats: number;
  cargo: boolean;
};

/**
 * What a requester can see. There is deliberately no "declined": declined, expired,
 * withdrawn by the other side and "the driver filled up" are all `unavailable`, at
 * the time the server says (D-16, D-22).
 */
export type SentStatus = 'pending' | 'unavailable' | 'accepted';

/**
 * Something I'm waiting on: my request to a driver, my invite to a passenger, or a
 * driver's invite I accepted (sender 'them', status 'accepted').
 */
export type SentItem = {
  id: string;
  type: 'request' | 'invite';
  sender: 'me' | 'them';
  person: TripPerson;
  rideDate: string;
  kind: RideKind;
  /** An approximate area label, never a spot. */
  pickupArea: string;
  pickupTime: string;
  status: SentStatus;
};

/** A driver's invite to me as a passenger, waiting for my reply. */
export type ReceivedInvite = {
  id: string;
  person: TripPerson;
  rideDate: string;
  kind: RideKind;
  pickupArea: string;
  pickupTime: string;
};

/** A confirmed rider on one of my driving days. The spot exists after confirmation only. */
export type DrivingRider = {
  id: string;
  person: TripPerson;
  pickupTime: string;
  spot: string;
  seats: number;
  cargo: boolean;
  /** Confirmed in this session, highlighted in the day card. */
  justBooked: boolean;
};

export type DrivingDay = { date: string; leaveTime: string; riders: DrivingRider[] };

/** Mirrors `rides.status`. */
export type RideStatus = 'confirmed' | 'completed' | 'cancelled';

export type TripRide = {
  id: string;
  person: TripPerson;
  rideDate: string;
  kind: RideKind;
  pickupTime: string;
  myRole: 'driver' | 'passenger';
  status: RideStatus;
  /** Prototype: the match whose Booked screen this ride opens. M-47 switches to ride ids. */
  matchId: string | null;
};

// ---------------------------------------------------------------- roles and sides

export function sidesFor(role: Role): Record<Side, boolean> {
  return { driving: role !== 'passenger', riding: role !== 'driver' };
}

/** I ask drivers (riding), I invite passengers (driving), and a driver's invite to me is riding. */
export function sentSide(item: SentItem): Side {
  if (item.sender === 'them') return 'riding';
  return item.type === 'request' ? 'riding' : 'driving';
}

export function rideSide(ride: TripRide): Side {
  return ride.myRole === 'driver' ? 'driving' : 'riding';
}

/** Prototype seeding: keep only the items on the sides this role has. */
export function onSides<T>(items: readonly T[], role: Role, sideOf: (item: T) => Side): T[] {
  const sides = sidesFor(role);
  return items.filter((item) => sides[sideOf(item)]);
}

// ---------------------------------------------------------------- query states

/** Wrap prototype items as a query state: `empty` for none, `success` otherwise. */
export function fromItems<T>(items: T[]): QueryState<T[]> {
  return items.length ? { status: 'success', data: items, refreshing: false } : { status: 'empty', refreshing: false };
}

/** What gateOnBlocks needs from useBlockedIds(). */
export type BlockGate = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  isBlocked: (id: string | null | undefined) => boolean;
};

/**
 * Hide blocked people. Until the block list is ready the section reads `loading`, so
 * a blocked person is never shown even briefly; if it failed, the section shows the
 * generic error. `keep` returns the item (possibly trimmed) or null to drop it.
 */
export function gateOnBlocks<T>(
  state: QueryState<T[]>,
  blocked: BlockGate,
  keep: (item: T, isBlocked: BlockGate['isBlocked']) => T | null,
): QueryState<T[]> {
  if (state.status === 'error') return state;
  if (blocked.status === 'error') return { status: 'error', error: { kind: 'unknown', message: GENERIC_ERROR } };
  if (blocked.status !== 'ready') return { status: 'loading' };
  if (state.status !== 'success') return state;
  const kept = state.data.map((item) => keep(item, blocked.isBlocked)).filter((item): item is T => item !== null);
  return kept.length ? { ...state, data: kept } : { status: 'empty', refreshing: state.refreshing };
}

export function keepUnblockedPerson<T extends { person: TripPerson }>(item: T, isBlocked: BlockGate['isBlocked']): T | null {
  return isBlocked(item.person.id) ? null : item;
}

/** Drops blocked riders from a day, and the day itself when nobody is left. */
export function keepUnblockedRiders(day: DrivingDay, isBlocked: BlockGate['isBlocked']): DrivingDay | null {
  const riders = day.riders.filter((rider) => !isBlocked(rider.person.id));
  if (riders.length === 0) return null;
  return riders.length === day.riders.length ? day : { ...day, riders };
}

/** A section renders while loading, on error, or with items. */
export function showSection(state: QueryState<unknown[]>): boolean {
  return state.status === 'loading' || state.status === 'error' || state.status === 'success';
}

/** The segment's empty state shows only when every section is empty (or idle). */
export function isSegmentEmpty(states: readonly QueryState<unknown[]>[]): boolean {
  return states.every((state) => state.status === 'empty' || state.status === 'idle');
}

// ---------------------------------------------------------------- counts and labels

const countOf = (state: QueryState<unknown[]>) => (state.status === 'success' ? state.data.length : 0);

/** Items that need my reply: requests to me plus invites to me. Never my own sends. */
export function needsReplyCount(incoming: QueryState<IncomingRequest[]>, invites: QueryState<ReceivedInvite[]>): number {
  return countOf(incoming) + countOf(invites);
}

export function needsReplyPhrase(count: number): string {
  return `${count} ${count === 1 ? 'needs' : 'need'} your reply`;
}

export function tripsTabLabel(count: number): string {
  return count > 0 ? `Trips, ${needsReplyPhrase(count)}` : 'Trips';
}

export function segmentLabel(count: number): string {
  return count > 0 ? `Requests · ${count}` : 'Requests';
}

export function defaultSegment(count: number, param?: TripsSegment): TripsSegment {
  return param ?? (count > 0 ? 'requests' : 'upcoming');
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** The D-02 reply cutoff, the evening before: 'Sun 8:00 PM' or 'Sun, Oct 11, 8:00 PM'. */
export function replyByLabel(rideDate: string, form: 'short' | 'long'): string {
  const evening = formatRideDate(addDays(rideDate, -1));
  const hh = String(Math.floor(REPLY_CUTOFF_MINUTES / 60)).padStart(2, '0');
  const mm = String(REPLY_CUTOFF_MINUTES % 60).padStart(2, '0');
  const time = formatTime(`${hh}:${mm}`);
  return form === 'short' ? `${evening.split(',')[0]} ${time}` : `${evening}, ${time}`;
}

/** The one neutral state for every "no" or lapse (D-16, D-22). */
export const UNAVAILABLE_COPY = "This ride isn't available anymore";
export const CANCELLED_COPY = 'Ride cancelled';

export function sentTitle(item: SentItem): string {
  if (item.sender === 'them') return `${item.person.name}'s invite`;
  return item.type === 'request' ? `Request to ${item.person.name}` : `Invite to ${item.person.name}`;
}

/** The only place request-state copy lives. */
export function sentStatusCopy(item: SentItem): string {
  const first = firstName(item.person.name);
  switch (item.status) {
    case 'pending':
      return `Waiting for ${first} · reply by ${replyByLabel(item.rideDate, 'short')}`;
    case 'unavailable':
      return UNAVAILABLE_COPY;
    case 'accepted':
      return `You accepted. ${first} confirms your seat and sets the pickup spot.`;
  }
}

export function canWithdraw(item: SentItem): boolean {
  return item.sender === 'me' && item.status === 'pending';
}

export function withdrawLabel(item: SentItem): string {
  return item.type === 'request' ? 'Withdraw request' : 'Withdraw invite';
}

export function withdrawQuestion(item: SentItem): string {
  return `Withdraw your ${item.type} to ${firstName(item.person.name)} for ${formatRideDate(item.rideDate)}?`;
}

export function declineQuestion(invite: ReceivedInvite): string {
  const first = firstName(invite.person.name);
  return `Decline ${first}'s invite for ${formatRideDate(invite.rideDate)}? ${first} sees it the same way as an invite nobody answered.`;
}

/**
 * Drops rows whose ride date is before today. It never turns a status into another
 * one from the clock: pending vs unavailable is the server's answer (D-22).
 */
export function fromToday<T extends { rideDate: string }>(items: readonly T[], today: string): T[] {
  return items.filter((item) => item.rideDate >= today);
}

/** A segment's empty state for this role, with an optional button that opens Discover. */
export function emptyState(segment: TripsSegment, role: Role): { text: string; action: string | null } {
  if (segment === 'past') return { text: 'Your past rides show up here after each ride.', action: null };
  if (segment === 'requests') {
    if (role === 'driver') return { text: 'No requests right now. When someone asks to ride with you, it shows up here.', action: null };
    if (role === 'passenger') return { text: 'Nothing waiting. Find a driver going your way and request a First Ride.', action: 'Find a ride' };
    return { text: 'Nothing waiting. Requests you send and receive show up here.', action: 'Open Discover' };
  }
  if (role === 'driver') return { text: 'No rides booked yet. Riders you confirm show up here by date.', action: null };
  if (role === 'passenger') return { text: 'No rides booked yet.', action: 'Find a ride' };
  return { text: 'No rides booked yet. Rides you drive and ride show up here by date.', action: null };
}

// ---------------------------------------------------------------- driving days

/**
 * My driving days, by date: the base days plus each accepted request under its own
 * date only (a day is created if I had none). Riders are never listed twice.
 */
export function drivingDays(
  base: readonly DrivingDay[],
  accepted: readonly { rideDate: string; rider: DrivingRider }[],
  leaveTime: string,
): DrivingDay[] {
  const byDate = new Map<string, DrivingDay>();
  for (const day of base) byDate.set(day.date, { ...day, riders: [...day.riders] });
  for (const { rideDate, rider } of accepted) {
    const day = byDate.get(rideDate) ?? { date: rideDate, leaveTime, riders: [] };
    if (!day.riders.some((r) => r.id === rider.id)) day.riders = [...day.riders, rider];
    byDate.set(rideDate, day);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Seats offered minus booked seats that day, never below 0. No phantom rider. */
export function seatsOpenOn(day: DrivingDay | null, seatsOffered: number): number {
  const booked = day ? day.riders.reduce((n, rider) => n + rider.seats, 0) : 0;
  return Math.max(0, seatsOffered - booked);
}

export function nextDrivingDay(days: readonly DrivingDay[], today: string): DrivingDay | null {
  return days.find((day) => day.date >= today) ?? null;
}

/** 'Driving Mon · 1 of 2 seats open', or 'Driving · 2 seats offered' with no day ahead. */
export function seatsPillLabel(day: DrivingDay | null, seatsOffered: number): string {
  if (!day) return `Driving · ${seatsOffered} ${seatsOffered === 1 ? 'seat' : 'seats'} offered`;
  const weekday = formatRideDate(day.date).split(',')[0];
  return `Driving ${weekday} · ${seatsOpenOn(day, seatsOffered)} of ${seatsOffered} seats open`;
}

// ---------------------------------------------------------------- prototype glue

/** The request id stands in for the requester, as on the driver's request screen. */
export function toIncomingRequest(r: RideRequest): IncomingRequest {
  return {
    id: r.id,
    person: { id: r.id, name: r.name, initials: r.initials, verified: r.verified },
    rideDate: r.rideDate,
    kind: r.kind,
    addedDetour: r.addedDetour,
    pickupTime: r.pickupTime,
    seats: r.seats,
    cargo: Boolean(r.cargo),
  };
}

/** An accepted request as a rider on its date (after confirmation, so the spot shows). */
export function riderFromRequest(r: RideRequest): { rideDate: string; rider: DrivingRider } {
  return {
    rideDate: r.rideDate,
    rider: {
      id: r.id,
      person: { id: r.id, name: r.name, initials: r.initials, verified: r.verified },
      pickupTime: `${r.pickupTime} AM`,
      spot: r.cargo ? `${r.pickupSpot} · scooter in trunk` : r.pickupSpot,
      seats: r.seats,
      cargo: Boolean(r.cargo),
      justBooked: true,
    },
  };
}

export type BookingEntry = {
  match: { id: string; name: string; initials: string; verified: boolean; departs: string };
  ride: { id: string; status: RideStatus };
};

/** Rides booked through Discover → Request → Booked in this session (M-20 state). */
export function bookedRides(entries: readonly BookingEntry[], rideDate: string): TripRide[] {
  return entries.map(({ match, ride }) => ({
    id: ride.id,
    person: { id: match.id, name: match.name, initials: match.initials, verified: match.verified },
    rideDate,
    kind: 'first_ride',
    pickupTime: `${match.departs} AM`,
    myRole: 'passenger',
    status: ride.status,
    matchId: match.id,
  }));
}

/**
 * Upcoming: confirmed or cancelled rides dated today or later, soonest first.
 * Past: completed rides and anything dated before today, newest first.
 */
export function splitRides(rides: readonly TripRide[], today: string): { upcoming: TripRide[]; past: TripRide[] } {
  const upcoming: TripRide[] = [];
  const past: TripRide[] = [];
  for (const ride of rides) (ride.status !== 'completed' && ride.rideDate >= today ? upcoming : past).push(ride);
  upcoming.sort((a, b) => a.rideDate.localeCompare(b.rideDate));
  past.sort((a, b) => b.rideDate.localeCompare(a.rideDate));
  return { upcoming, past };
}

/** Cause-free on purpose (owner question 6, D-07). */
export function rideStatusCopy(ride: TripRide): string {
  if (ride.status === 'cancelled') return CANCELLED_COPY;
  if (ride.status === 'completed') return 'Completed';
  return `Pickup ${ride.pickupTime}`;
}

/** 'You drove' / 'You rode' for a completed ride; 'Driving' / 'Riding' when it was cancelled. */
export function pastRoleLine(ride: TripRide): string {
  if (ride.status === 'cancelled') return ride.myRole === 'driver' ? 'Driving' : 'Riding';
  return ride.myRole === 'driver' ? 'You drove' : 'You rode';
}

// ---------------------------------------------------------------- accessibility labels

const spoken = (text: string) => text.replace(/ · /g, ', ');
const sentence = (text: string) => (/[.?!]$/.test(text) ? text : `${text}.`);

export function sentItemLabel(item: SentItem): string {
  return `${sentTitle(item)}, ${spoken(rideDateLine(item.rideDate, item.kind))}. ${sentence(spoken(sentStatusCopy(item)))}`;
}

export function inviteLabel(invite: ReceivedInvite): string {
  return (
    `${invite.person.name} invited you to ride, ${spoken(rideDateLine(invite.rideDate, invite.kind))}. ` +
    `Pickup ${invite.pickupTime}, ${invite.pickupArea}. Reply by ${replyByLabel(invite.rideDate, 'long')}.`
  );
}

export function rideLabel(ride: TripRide, segment: 'upcoming' | 'past'): string {
  const lead = segment === 'past' ? `${pastRoleLine(ride)} with ${ride.person.name}` : ride.person.name;
  return `${lead}, ${spoken(rideDateLine(ride.rideDate, ride.kind))}. ${sentence(rideStatusCopy(ride))}`;
}

// ---------------------------------------------------------------- prototype session store

export type TripsSessionState = { sent: readonly SentItem[]; invites: readonly ReceivedInvite[] };

/**
 * The prototype's Withdraw / Accept / Decline state, shared by TripsScreen and the
 * tab bar through useSyncExternalStore. Snapshots are immutable and keep their
 * reference until something changes. Unknown ids are a no-op. M-35 replaces it with
 * the invitations data module.
 */
export function createTripsSession(seed: TripsSessionState) {
  let state: TripsSessionState = { sent: [...seed.sent], invites: [...seed.invites] };
  const listeners = new Set<() => void>();
  const set = (next: TripsSessionState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: (): TripsSessionState => state,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    withdraw(id: string) {
      if (!state.sent.some((item) => item.id === id && canWithdraw(item))) return;
      set({ ...state, sent: state.sent.filter((item) => item.id !== id) });
    },
    acceptInvite(id: string) {
      const invite = state.invites.find((item) => item.id === id);
      if (!invite) return;
      const accepted: SentItem = { ...invite, type: 'invite', sender: 'them', status: 'accepted' };
      set({ sent: [...state.sent, accepted], invites: state.invites.filter((item) => item.id !== id) });
    },
    declineInvite(id: string) {
      if (!state.invites.some((item) => item.id === id)) return;
      set({ ...state, invites: state.invites.filter((item) => item.id !== id) });
    },
  };
}

export type TripsSession = ReturnType<typeof createTripsSession>;
