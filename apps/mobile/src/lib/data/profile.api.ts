// The profile sample: types, interface and cache keys. Pure.
// Read-only on purpose: name and role edits go through saveProfile in
// state/auth.tsx, and preference / discovery writes belong to commute.ts (M-34).

import type { RidePref, Role } from '../../state/commute';
import type { Result } from './types';

export type ProfileSummary = {
  id: string;
  displayName: string;
  role: Role;
  ridePrefs: RidePref[];
  discoveryOptIn: boolean;
};

export interface ProfileApi {
  /** The signed-in member's own profile. null if it doesn't exist yet. */
  getMyProfile(): Promise<Result<ProfileSummary | null>>;
  /** null for an unknown id, and for any row RLS hides (everyone else's, per 0002). */
  getProfile(id: string): Promise<Result<ProfileSummary | null>>;
}

export const profileKeys = {
  all: 'profile',
  me: 'profile:me',
  byId: (id: string) => `profile:id:${id}`,
};
