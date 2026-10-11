// Sample data for the UI prototype only. Names are fictional, locations are
// generalized areas, and nothing here is real user data. Replace with
// server-side matching results once the Supabase API exists.

import type { RideKind } from '../lib/rideKind';

export type Weekday = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri';
export const WEEKDAYS: Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export type Reason = { label: string; ok: boolean };

/**
 * A generalized area: the center of a ~0.5 mi circle, like the stored
 * `origin_area` / `destination_area` that matching returns (M-18, M-26).
 * Never an address or an exact pin. The coordinates below are made up and
 * rounded to about 100 m.
 */
export type AreaCenter = { lat: number; lng: number; label: string };

export type Match = {
  id: string;
  name: string;
  initials: string;
  role: 'driver' | 'passenger';
  verified: boolean;
  seatsOpen?: number;
  departs: string;
  departsNote: string;
  detourMinutes?: number;
  sharedDays: Weekday[];
  reasons: Reason[];
  vehicle?: { description: string; seats: number; cargoFits: boolean };
  ridePrefs: string[];
  stats: { rides: string; onTime: string; memberSince: string };
  /** Where they start: their origin area, drawn as a circle on Discover. */
  originArea: AreaCenter;
  destinationArea: AreaCenter;
  window: string;
};

export const MATCHES: Match[] = [
  {
    id: 'priya',
    name: 'Priya S.',
    initials: 'PS',
    role: 'driver',
    verified: true,
    seatsOpen: 2,
    departs: '7:40',
    departsNote: 'Departs, 5 min early',
    detourMinutes: 4,
    sharedDays: ['Mon', 'Tue', 'Wed', 'Thu'],
    reasons: [
      { label: '4 min detour', ok: true },
      { label: 'Same departure window', ok: true },
      { label: 'Mon–Thu overlap', ok: true },
      { label: 'Your scooter fits', ok: true },
    ],
    vehicle: { description: '[Make, model, color]', seats: 4, cargoFits: true },
    ridePrefs: ['Smoke-free', 'Quiet ride'],
    stats: { rides: '[N]', onTime: '[X]%', memberSince: '[Mon YY]' },
    originArea: { lat: 37.768, lng: -122.24, label: 'Park Street area, Alameda' },
    destinationArea: { lat: 37.791, lng: -122.399, label: 'Financial District/South Beach area, San Francisco' },
    window: '7:25–7:55',
  },
  {
    id: 'marcus',
    name: 'Marcus L.',
    initials: 'ML',
    role: 'driver',
    verified: true,
    seatsOpen: 1,
    departs: '7:55',
    departsNote: 'Departs, 10 min late',
    detourMinutes: 5,
    sharedDays: ['Mon', 'Wed', 'Thu'],
    reasons: [
      { label: '5 min detour', ok: true },
      { label: 'Leaves 10 min later', ok: false },
    ],
    vehicle: { description: '[Make, model, color]', seats: 4, cargoFits: false },
    ridePrefs: ['Smoke-free'],
    stats: { rides: '[N]', onTime: '[X]%', memberSince: '[Mon YY]' },
    originArea: { lat: 37.776, lng: -122.278, label: 'West End area, Alameda' },
    destinationArea: { lat: 37.782, lng: -122.401, label: 'South of Market area, San Francisco' },
    window: '7:40–8:10',
  },
  {
    id: 'jordan',
    name: 'Jordan T.',
    initials: 'JT',
    role: 'passenger',
    verified: true,
    departs: '7:50',
    departsNote: 'Wants to leave',
    sharedDays: ['Mon', 'Tue', 'Wed', 'Thu'],
    reasons: [
      { label: 'Same departure window', ok: true },
      { label: 'Mon–Thu overlap', ok: true },
    ],
    ridePrefs: ['Quiet ride'],
    stats: { rides: '[N]', onTime: '[X]%', memberSince: '[Mon YY]' },
    originArea: { lat: 37.762, lng: -122.231, label: 'East End area, Alameda' },
    destinationArea: { lat: 37.794, lng: -122.402, label: 'Financial District/South Beach area, San Francisco' },
    window: '7:35–8:05',
  },
];

export const findMatch = (id: string): Match => MATCHES.find((m) => m.id === id) ?? MATCHES[0];

/**
 * The prototype person's own pickup and drop-off areas, for "Where and when".
 * Their labels match the commute draft's defaults in state/commute.tsx.
 */
export const PROTOTYPE_COMMUTE_AREAS: { pickup: AreaCenter; dropoff: AreaCenter } = {
  pickup: { lat: 37.766, lng: -122.246, label: 'Park St area, Alameda' },
  dropoff: { lat: 37.792, lng: -122.398, label: 'Financial District, SF' },
};

/** The one date ('YYYY-MM-DD') the prototype requests and books with a match. */
export const PROTOTYPE_RIDE_DATE = '2026-10-12';

export type RideRequest = {
  id: string;
  name: string;
  initials: string;
  verified: boolean;
  /** Every request is for one date, 'YYYY-MM-DD'. */
  rideDate: string;
  kind: RideKind;
  addedDetour: string;
  pickupTime: string;
  pickupSpot: string;
  seats: number;
  cargo?: { label: string; detail: string };
  replyBy: string;
  ridePrefs: string[];
  stats: { rides: string; onTime: string };
};

export const REQUESTS: RideRequest[] = [
  {
    id: 'req-jordan',
    name: 'Jordan T.',
    initials: 'JT',
    verified: true,
    rideDate: '2026-10-12',
    kind: 'first_ride',
    addedDetour: '+4 min',
    pickupTime: '7:40',
    pickupSpot: 'Park St & Central Ave',
    seats: 1,
    cargo: { label: 'Foldable scooter', detail: 'Medium · [dimensions] · [weight]' },
    replyBy: '[time]',
    ridePrefs: ['Quiet ride'],
    stats: { rides: '[N]', onTime: '[X]%' },
  },
  {
    id: 'req-alex',
    name: 'Alex K.',
    initials: 'AK',
    verified: false,
    rideDate: '2026-10-13',
    kind: 'first_ride',
    addedDetour: '+2 min',
    pickupTime: '7:45',
    pickupSpot: '[Pickup spot]',
    seats: 1,
    replyBy: '[time]',
    ridePrefs: [],
    stats: { rides: '[N]', onTime: '[X]%' },
  },
];

export const findRequest = (id: string): RideRequest => REQUESTS.find((r) => r.id === id) ?? REQUESTS[0];
