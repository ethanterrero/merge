// Public entry for blocks (binding file, M-24): hooks over the mock or Supabase
// backend, chosen by useAuth().status. List screens (Discover M-42, the driver inbox
// M-36, …) filter with useBlockedIds(); this task doesn't filter them.

import { useMemo } from 'react';
import { defineBackends, useBackendApi, useDataMutation, useDataQuery } from './backend';
import { blocksKeys, toBlockedIds, type BlockedIds, type BlocksApi } from './blocks.api';
import { createBlocksMock } from './blocks.mock';
import { createBlocksSupabase } from './blocks.supabase';

const backends = defineBackends({ mock: createBlocksMock(), supabase: createBlocksSupabase });

/** People I blocked, newest first. `empty` when there are none. */
export function useBlockedPeople() {
  return useDataQuery(backends, blocksKeys.list, (api) => api.listBlocked());
}

/** The ids I blocked, for filtering lists and for Match detail's blocked state. */
export function useBlockedIds(): BlockedIds {
  const query = useBlockedPeople();
  const people = query.status === 'success' ? query.data : null;
  // Stable while the list is unchanged, so callers can use it in effect deps.
  return useMemo(() => toBlockedIds(query.status, people), [query.status, people]);
}

const BLOCK_ACTIONS = {
  block: (api: BlocksApi, id: string) => api.block(id),
  unblock: (api: BlocksApi, id: string) => api.unblock(id),
};

/**
 * block(id) / unblock(id). A block ends connections and Crews and hides people across
 * features, so success invalidates every key in the member's scope.
 */
export function useBlockActions() {
  return useDataMutation(backends, BLOCK_ACTIONS, { invalidate: 'all' });
}

/** For event handlers that need a one-off call. null while the data mode is 'off'. */
export function useBlocksApi() {
  return useBackendApi(backends);
}

export { blockedOnLabel, blocksKeys, FORMER_MEMBER, isBlocked, toBlockedIds } from './blocks.api';
export type { BlockedIds, BlockedPerson, BlocksApi } from './blocks.api';
