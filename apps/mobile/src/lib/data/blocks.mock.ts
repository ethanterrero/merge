// In-memory blocks backend for prototype mode. Pure.
// Mirrors 0005: one row per pair, no self-block, a duplicate block is a no-op (the
// app inserts with on conflict do nothing), and the list holds only my blocks.

import { BLOCK_SELF_ERROR, type BlockedPerson, type BlocksApi } from './blocks.api';
import { mockResult, type MockOptions } from './mockUtil';
import { PROTOTYPE_MEMBER_ID } from './profile.mock';
import type { Result } from './types';

export type BlocksMockOptions = MockOptions & {
  /** People the member has already blocked. */
  blocks?: readonly BlockedPerson[];
  meId?: string;
  /** Clock for new blocks' timestamps. */
  now?: () => Date;
};

const newestFirst = (a: BlockedPerson, b: BlockedPerson) => Date.parse(b.blockedAt) - Date.parse(a.blockedAt);

export function createBlocksMock(options: BlocksMockOptions = {}) {
  let blocks: BlockedPerson[] = [...(options.blocks ?? [])];
  const meId = options.meId ?? PROTOTYPE_MEMBER_ID;
  const now = options.now ?? (() => new Date());

  const write = async (method: string, id: string, apply: () => void): Promise<Result<null>> => {
    if (!id || id === meId) return { ok: false, error: BLOCK_SELF_ERROR };
    const result = await mockResult(method, options, () => null);
    if (result.ok) apply();
    return result;
  };

  return {
    listBlocked: () => mockResult('listBlocked', options, () => [...blocks].sort(newestFirst)),
    block: (id: string) =>
      write('block', id, () => {
        if (!blocks.some((person) => person.id === id)) blocks = [...blocks, { id, blockedAt: now().toISOString() }];
      }),
    unblock: (id: string) =>
      write('unblock', id, () => {
        blocks = blocks.filter((person) => person.id !== id);
      }),
  } satisfies BlocksApi;
}
