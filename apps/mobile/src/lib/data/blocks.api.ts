// Blocks (M-24): types, interface, cache keys and pure helpers. Pure.
// Schema and rules: supabase/migrations/0005_blocks_reports.sql and
// docs/superpowers/specs/2026-10-08-blocks-reports-design.md.
//
// A block is silent: the blocked person is never told and can't read it. RLS shows
// the blocker only their own rows, and public.is_blocked isn't executable by
// clients, so this feature reads blocks from the blocks table and nothing else.

import type { DataError, QueryState, Result } from './types';

/**
 * Someone the signed-in member blocked. No name: profile_cards (0014) returns no
 * row for a blocked pair, so the UI shows the agreed missing-card label instead.
 */
export type BlockedPerson = {
  id: string;
  /** ISO timestamp the server set when the block was created. */
  blockedAt: string;
};

export interface BlocksApi {
  /** People I blocked, newest first. */
  listBlocked(): Promise<Result<BlockedPerson[]>>;
  /** Block someone. Blocking someone already blocked succeeds and changes nothing. */
  block(id: string): Promise<Result<null>>;
  /** Unblock someone. Unblocking someone who isn't blocked succeeds and changes nothing. */
  unblock(id: string): Promise<Result<null>>;
}

export const blocksKeys = {
  all: 'blocks',
  list: 'blocks:list',
};

/** The label for a person whose card isn't available (agreed in M-16, D-15). */
export const FORMER_MEMBER = 'Former member';

export const BLOCK_SELF_ERROR: DataError = { kind: 'invalid', message: "You can't block yourself." };

/** True if `id` is among the people I blocked. False for a missing id. */
export function isBlocked(blocked: ReadonlySet<string> | readonly BlockedPerson[], id: string | null | undefined): boolean {
  if (!id) return false;
  if (blocked instanceof Set) return blocked.has(id);
  return (blocked as readonly BlockedPerson[]).some((person) => person.id === id);
}

/** What list screens read from useBlockedIds(). */
export type BlockedIds = {
  /**
   * 'ready' once the list has loaded (it may be empty). 'idle' while the data mode is
   * off, 'loading' before the first answer, 'error' when it failed with nothing cached.
   */
  status: 'idle' | 'loading' | 'ready' | 'error';
  ids: ReadonlySet<string>;
  isBlocked: (id: string | null | undefined) => boolean;
};

/**
 * Derive the id set list screens filter with from the blocked-people query's status
 * and data (null unless the status is 'success').
 */
export function toBlockedIds(status: QueryState<BlockedPerson[]>['status'], people: readonly BlockedPerson[] | null): BlockedIds {
  const ids = new Set(status === 'success' && people ? people.map((person) => person.id) : []);
  const readiness = status === 'success' || status === 'empty' ? 'ready' : status;
  return { status: readiness, ids, isBlocked: (id) => isBlocked(ids, id) };
}

// Profile ids are Postgres uuids. Anything else (the prototype's 'priya', 'req-jordan')
// would fail with 22P02 in connected mode.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a real profile id (a uuid). */
export function isPersonId(id: string | null | undefined): id is string {
  return typeof id === 'string' && UUID.test(id);
}

/** The cached blocks:list entry: undefined when it hasn't loaded. */
export type BlockListCache = {
  read: () => readonly BlockedPerson[] | undefined;
  write: (list: BlockedPerson[]) => void;
};

/**
 * block / unblock that also update the cached list on success, so isBlocked flips at
 * once instead of waiting for the refetch (which may fail). The invalidation after it
 * still reloads the server's copy. With no cached list there's nothing to update.
 */
export function withBlockListUpdates(
  api: Pick<BlocksApi, 'block' | 'unblock'>,
  cache: BlockListCache | null,
  now: () => Date = () => new Date(),
): Pick<BlocksApi, 'block' | 'unblock'> {
  return {
    block: async (id) => {
      const result = await api.block(id);
      const list = result.ok ? cache?.read() : undefined;
      if (cache && list && !isBlocked(list, id)) cache.write([{ id, blockedAt: now().toISOString() }, ...list]);
      return result;
    },
    unblock: async (id) => {
      const result = await api.unblock(id);
      const list = result.ok ? cache?.read() : undefined;
      if (cache && list && isBlocked(list, id)) cache.write(list.filter((person) => person.id !== id));
      return result;
    },
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Blocked Oct 10, 2026" in the device's time zone. Empty for an unreadable timestamp. */
export function blockedOnLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `Blocked ${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}
