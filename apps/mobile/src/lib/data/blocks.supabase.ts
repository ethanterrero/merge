// Supabase blocks backend. Pure: the client is injected, and only types are
// imported from supabase-js, so this loads under Node.
//
// Writes never read back (no .select()), so they need no select grant beyond the
// blocker's own rows, and nothing about the other person is returned.

import { BLOCK_SELF_ERROR, type BlocksApi } from './blocks.api';
import { BLOCK_COLUMNS, toBlockedPerson, toBlockInsert } from './blocks.map';
import { settle } from './errors';
import type { Result, TypedClient } from './types';

const selfBlock = (): Promise<Result<null>> => Promise.resolve({ ok: false, error: BLOCK_SELF_ERROR });

export function createBlocksSupabase(client: TypedClient, userId: string) {
  return {
    listBlocked: () =>
      settle(
        client.from('blocks').select(BLOCK_COLUMNS).eq('blocker_id', userId).order('created_at', { ascending: false }),
        (rows) => rows.map(toBlockedPerson),
      ),
    block: (id: string) => {
      if (!id || id === userId) return selfBlock();
      // on conflict do nothing: blocking twice is a no-op, not a unique_violation.
      return settle(
        client.from('blocks').upsert(toBlockInsert(userId, id), { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true }),
        () => null,
      );
    },
    unblock: (id: string) => {
      if (!id || id === userId) return selfBlock();
      return settle(client.from('blocks').delete().eq('blocker_id', userId).eq('blocked_id', id), () => null);
    },
  } satisfies BlocksApi;
}
