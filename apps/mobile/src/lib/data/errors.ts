// Pure error model for the data layer. Raw server messages never reach the UI:
// they can carry internals or reveal something about another member.

import { SERVER_ERROR } from '../authRules';
import type { Result } from './types';

export type DataErrorKind =
  | 'offline'
  | 'auth'
  | 'notAllowed'
  | 'conflict'
  | 'invalid'
  | 'rateLimited'
  | 'server'
  | 'unknown';

export type DataError = {
  kind: DataErrorKind;
  /** Safe, user-facing copy. Never the server's raw message. */
  message: string;
  /** Postgres / PostgREST code, or `http_<status>`, for developer logs only. */
  code?: string;
};

export const OFFLINE_ERROR = 'Check your connection and try again.';
export const SESSION_ENDED_ERROR = 'Your session ended. Sign in again.';
export const RATE_LIMITED_ERROR = "You've done that a lot. Try again later.";
export const GENERIC_ERROR = 'Something went wrong. Try again.';

const COPY: Record<DataErrorKind, string> = {
  offline: OFFLINE_ERROR,
  auth: SESSION_ENDED_ERROR,
  notAllowed: GENERIC_ERROR,
  conflict: GENERIC_ERROR,
  invalid: GENERIC_ERROR,
  rateLimited: RATE_LIMITED_ERROR,
  server: SERVER_ERROR,
  unknown: GENERIC_ERROR,
};

/** Feature-specific copy (or kind), keyed by kind, Postgres code or RPC hint. */
export type ErrorOverrides = Partial<Record<DataErrorKind | `code:${string}` | `hint:${string}`, Partial<DataError>>>;

type ErrorFields = { name?: string; message?: string; code?: string; hint?: string; status?: number };

const NETWORK_MESSAGE = /network request failed|failed to fetch|fetch failed|load failed|networkerror/i;
const AUTH_CODES = ['PGRST301', 'PGRST302', 'PGRST303'];
const CONFLICT_CODES = ['23505', '23503'];
const INVALID_CODES = ['23502', '23514', '22P02', '22023', 'P0001'];

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function fieldsOf(input: unknown): ErrorFields {
  if (typeof input === 'string') return { message: input };
  if (typeof input !== 'object' || input === null) return {};
  const o = input as Record<string, unknown>;
  return {
    name: nonEmpty(o.name),
    message: nonEmpty(o.message),
    code: nonEmpty(o.code),
    hint: nonEmpty(o.hint),
    status: typeof o.status === 'number' ? o.status : undefined,
  };
}

function kindOf({ code, status, message }: ErrorFields): DataErrorKind {
  // supabase-js reports a failed fetch as status 0 with "TypeError: …" as the message.
  if (status === 0 || NETWORK_MESSAGE.test(message ?? '')) return 'offline';
  if (status === 401 || (code !== undefined && AUTH_CODES.includes(code))) return 'auth';
  if (status === 429) return 'rateLimited';
  if (code === '42501' || status === 403) return 'notAllowed';
  if (code !== undefined && CONFLICT_CODES.includes(code)) return 'conflict';
  if (code !== undefined && INVALID_CODES.includes(code)) return 'invalid';
  if (status !== undefined && status >= 500) return 'server';
  return 'unknown';
}

export function toDataError(input: unknown, overrides: ErrorOverrides = {}): DataError {
  const fields = fieldsOf(input);
  const kind = kindOf(fields);
  const code = fields.code ?? (fields.status !== undefined ? `http_${fields.status}` : undefined);
  const base: DataError = code ? { kind, message: COPY[kind], code } : { kind, message: COPY[kind] };
  const override =
    (fields.hint !== undefined ? overrides[`hint:${fields.hint}`] : undefined) ??
    (fields.code !== undefined ? overrides[`code:${fields.code}`] : undefined) ??
    overrides[kind];
  if (!override) return base;
  const merged: DataError = { ...base, ...override };
  if (override.kind && override.message === undefined) merged.message = COPY[override.kind];
  return merged;
}

type ServerError = { name?: string; message: string; code?: string; hint?: string };
type ServerResponse<R> = { data: R; error: null; status?: number } | { data: null; error: ServerError; status?: number };

/**
 * Await a supabase-js request and turn it into a Result. Never throws: a thrown
 * error (for example from a custom fetch) is mapped like a returned one.
 */
export async function settle<R, T>(
  request: PromiseLike<ServerResponse<R>>,
  map: (data: R) => T,
  overrides?: ErrorOverrides,
): Promise<Result<T>> {
  try {
    const response = await request;
    if (response.error) {
      const { name, message, code, hint } = response.error;
      return { ok: false, error: toDataError({ name, message, code, hint, status: response.status }, overrides) };
    }
    return { ok: true, data: map(response.data) };
  } catch (error) {
    return { ok: false, error: toDataError(error, overrides) };
  }
}
