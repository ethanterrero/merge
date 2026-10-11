// Public entry for the profile sample (binding file): hooks over the mock or
// Supabase backend, chosen by useAuth().status.

import { defineBackends, useBackendApi, useDataQuery } from './backend';
import { profileKeys } from './profile.api';
import { createProfileMock } from './profile.mock';
import { createProfileSupabase } from './profile.supabase';

const backends = defineBackends({ mock: createProfileMock(), supabase: createProfileSupabase });

/** The signed-in member's profile (in prototype mode, the prototype member's). */
export function useMyProfile() {
  return useDataQuery(backends, profileKeys.me, (api) => api.getMyProfile());
}

/** A profile by id. `empty` for an unknown id or anyone else's (RLS hides it). */
export function useProfile(id: string | null) {
  return useDataQuery(backends, id ? profileKeys.byId(id) : null, (api) => api.getProfile(id ?? ''));
}

/** For event handlers that need a one-off call. null while the data mode is 'off'. */
export function useProfileApi() {
  return useBackendApi(backends);
}

export { profileKeys } from './profile.api';
export type { ProfileApi, ProfileSummary } from './profile.api';
