// Row <-> UI mapping for blocks. Pure.

import type { BlockedPerson } from './blocks.api';
import type { InsertRow, Row } from './types';

/**
 * Explicit columns: a privacy review sees exactly what's read. blocker_id isn't
 * read back: RLS (0005) returns only the caller's own rows, and the query also
 * filters on it.
 */
export const BLOCK_COLUMNS = 'blocked_id, created_at';

export type BlockRow = Pick<Row<'blocks'>, 'blocked_id' | 'created_at'>;

/** Only the two columns clients may insert (0005 grants insert on these alone). */
export type BlockInsert = Pick<InsertRow<'blocks'>, 'blocker_id' | 'blocked_id'>;

export function toBlockedPerson(row: BlockRow): BlockedPerson {
  return { id: row.blocked_id, blockedAt: row.created_at };
}

export function toBlockInsert(userId: string, blockedId: string): BlockInsert {
  return { blocker_id: userId, blocked_id: blockedId };
}
