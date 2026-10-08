import React, { createContext, useContext, useMemo, useState } from 'react';
import type { Weekday } from '../data/mock';

export type Role = 'driver' | 'passenger' | 'both';
export type RidePref = 'Quiet ride' | 'Smoke-free' | 'Women-only';

/** The commute profile a person builds during onboarding. Local-only for now. */
export type CommuteDraft = {
  role: Role;
  pickupArea: string;
  dropoffArea: string;
  days: Weekday[];
  departure: string;
  flexMinutes: 5 | 10 | 15;
  seatsOffered: number;
  trunkSpace: boolean;
  bringsCargo: boolean;
  ridePrefs: RidePref[];
  discoverable: boolean;
  /** Booked ride, set once a request is confirmed. */
  bookedMatchId?: string;
  /** Ride requests this person accepted as a driver. */
  acceptedRequests: string[];
};

const initial: CommuteDraft = {
  role: 'both',
  pickupArea: 'Park St area, Alameda',
  dropoffArea: 'Financial District, SF',
  days: ['Mon', 'Tue', 'Wed', 'Thu'],
  departure: '7:45 AM',
  flexMinutes: 15,
  seatsOffered: 2,
  trunkSpace: true,
  bringsCargo: true,
  ridePrefs: ['Quiet ride', 'Smoke-free'],
  discoverable: true,
  acceptedRequests: [],
};

type Ctx = {
  commute: CommuteDraft;
  update: (patch: Partial<CommuteDraft>) => void;
};

const CommuteContext = createContext<Ctx | null>(null);

export function CommuteProvider({ children }: { children: React.ReactNode }) {
  const [commute, setCommute] = useState<CommuteDraft>(initial);
  const value = useMemo<Ctx>(
    () => ({ commute, update: (patch) => setCommute((c) => ({ ...c, ...patch })) }),
    [commute],
  );
  return <CommuteContext.Provider value={value}>{children}</CommuteContext.Provider>;
}

export function useCommute(): Ctx {
  const ctx = useContext(CommuteContext);
  if (!ctx) throw new Error('useCommute must be used inside CommuteProvider');
  return ctx;
}

export function toggleIn<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}
