// Supabase profile backend. Pure: the client is injected, and only types are
// imported from supabase-js, so this loads under Node.

import { settle } from './errors';
import type { ProfileApi } from './profile.api';
import { PROFILE_COLUMNS, toProfileSummary } from './profile.map';
import type { TypedClient } from './types';

export function createProfileSupabase(client: TypedClient, userId: string) {
  const byId = (id: string) =>
    settle(client.from('profiles').select(PROFILE_COLUMNS).eq('id', id).maybeSingle(), (row) =>
      row ? toProfileSummary(row) : null,
    );
  return { getMyProfile: () => byId(userId), getProfile: byId } satisfies ProfileApi;
}
