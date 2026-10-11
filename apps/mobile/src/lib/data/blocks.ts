// Public entry for blocks (binding file, M-24): hooks over the mock or Supabase
// backend, chosen by useAuth().status. List screens (Discover M-42, the driver inbox
// M-36, …) filter with useBlockedIds(); this task doesn't filter them.

import { useMemo } from 'react';
import { defineBackends, useBackendApi, useDataContext, useDataMutation, useDataQuery } from './backend';
import {
  blocksKeys,
  toBlockedIds,
  withBlockListUpdates,
  type BlockedIds,
  type BlockedPerson,
  type BlockListCache,
  type BlocksApi,
} from './blocks.api';
import { createBlocksMock } from './blocks.mock';
import { createBlocksSupabase } from './blocks.supabase';
import { queryStore } from './hooks';

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

/** The member's cached blocks:list entry (the same scoped key useBlockedPeople reads). */
function blockListCache(scope: string | null): BlockListCache | null {
  if (!scope) return null;
  const key = `${scope}:${blocksKeys.list}`;
  return {
    read: () => {
      const snap = queryStore.getSnapshot(key);
      return snap.hasValue ? (snap.value as BlockedPerson[]) : undefined;
    },
    write: (list) => queryStore.setQueryData<BlockedPerson[]>(key, () => list),
  };
}

/**
 * block(id) / unblock(id). On success the cached list is updated first, so
 * useBlockedIds() flips at once; then, because a block ends connections and Crews and
 * hides people across features, every key in the member's scope is invalidated.
 */
export function useBlockActions() {
  const { scope } = useDataContext();
  const actions = useMemo(() => {
    const cache = blockListCache(scope);
    return {
      block: (api: BlocksApi, id: string) => withBlockListUpdates(api, cache).block(id),
      unblock: (api: BlocksApi, id: string) => withBlockListUpdates(api, cache).unblock(id),
    };
  }, [scope]);
  return useDataMutation(backends, actions, { invalidate: 'all' });
}

/** For event handlers that need a one-off call. null while the data mode is 'off'. */
export function useBlocksApi() {
  return useBackendApi(backends);
}

export { blockedOnLabel, blocksKeys, FORMER_MEMBER, isBlocked, isPersonId, toBlockedIds } from './blocks.api';
export type { BlockedIds, BlockedPerson, BlocksApi } from './blocks.api';
