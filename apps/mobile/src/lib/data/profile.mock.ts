// In-memory profile backend for prototype mode. Pure.

import { findById, mockResult, type MockOptions } from './mockUtil';
import type { ProfileApi, ProfileSummary } from './profile.api';

export const PROTOTYPE_MEMBER_ID = 'prototype-member';

export const DEFAULT_PROFILES: readonly ProfileSummary[] = [
  {
    id: PROTOTYPE_MEMBER_ID,
    displayName: 'Prototype Member',
    role: 'both',
    ridePrefs: ['Quiet ride', 'Smoke-free'],
    discoveryOptIn: false, // D-14: discovery is off by default
  },
];

export type ProfileMockOptions = MockOptions & {
  profiles?: readonly ProfileSummary[];
  meId?: string;
};

export function createProfileMock(options: ProfileMockOptions = {}) {
  const profiles = [...(options.profiles ?? DEFAULT_PROFILES)];
  const meId = options.meId ?? PROTOTYPE_MEMBER_ID;
  // Mirrors RLS on profiles (0002): a member can read only their own row.
  const visible = (id: string) => (id === meId ? findById(profiles, id) : null);
  return {
    getMyProfile: () => mockResult('getMyProfile', options, () => visible(meId)),
    getProfile: (id: string) => mockResult('getProfile', options, () => visible(id)),
  } satisfies ProfileApi;
}
