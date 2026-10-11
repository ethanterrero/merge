// Sample data for the UI prototype only. Names are fictional, locations are
// generalized areas, and nothing here is real user data. Replace with
// server-side matching results once the Supabase API exists.

import type { RideKind } from '../lib/rideKind';

export type Weekday = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri';
export const WEEKDAYS: Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export type Reason = { label: string; ok: boolean };

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
  /** Position of the generalized area marker on the stylized map, 0–1. */
  marker: { x: number; y: number; size: number };
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
    marker: { x: 0.65, y: 0.66, size: 96 },
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
    marker: { x: 0.78, y: 0.48, size: 72 },
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
    marker: { x: 0.86, y: 0.76, size: 64 },
    window: '7:35–8:05',
  },
];

export const findMatch = (id: string): Match => MATCHES.find((m) => m.id === id) ?? MATCHES[0];

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
