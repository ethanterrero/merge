// Shared types for the data layer (docs/superpowers/specs/2026-10-10-data-layer-design.md).
// Pure: type-only imports. Append-only: wiring tasks add shared domain types at the end.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables, TablesInsert, TablesUpdate } from '../database.types';
import type { DataError } from './errors';

export type { DataError, DataErrorKind } from './errors';

export type DataMode = 'mock' | 'supabase' | 'off';
export type TypedClient = SupabaseClient<Database>;

type PublicSchema = Database['public'];
export type TableName = keyof PublicSchema['Tables'];
export type Row<T extends TableName> = Tables<T>;
export type InsertRow<T extends TableName> = TablesInsert<T>;
export type UpdateRow<T extends TableName> = TablesUpdate<T>;
export type RpcName = keyof PublicSchema['Functions'];
export type RpcArgs<F extends RpcName> = PublicSchema['Functions'][F]['Args'];
export type RpcReturns<F extends RpcName> = PublicSchema['Functions'][F]['Returns'];

/** Every backend method resolves to one of these and never throws. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: DataError };

/** What a query hook reports. Screens switch on `status`. */
export type QueryState<T> =
  | { status: 'idle' } // data mode is 'off', or there's no key yet
  | { status: 'loading' } // first load, nothing cached
  | { status: 'error'; error: DataError } // last load failed and nothing is cached
  | { status: 'empty'; refreshing: boolean } // null or [] (not found, no items)
  | { status: 'success'; data: T; refreshing: boolean };

export type Query<T> = QueryState<NonNullable<T>> & {
  refetch: () => void;
  /** Set when a refetch fails while older data is still shown. */
  lastError: DataError | null;
};
