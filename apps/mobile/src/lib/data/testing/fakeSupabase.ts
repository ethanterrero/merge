// Test helper: a recording fake of the supabase-js surface the backends use.
// Every from() / rpc() chain records its calls and resolves to a canned
// response. It checks how a backend builds a request and maps the answer, not
// what Postgres would return (supabase/tests/ covers that).

import type { TypedClient } from '../types';

export type FakeResponse = {
  data?: unknown;
  error?: { message: string; code?: string; hint?: string; name?: string } | null;
  /** Defaults to 200, or 400 when there's an error. */
  status?: number;
  /** Reject instead of resolving (a thrown fetch error). */
  throws?: unknown;
};

export type RecordedCall = {
  kind: 'from' | 'rpc';
  target: string;
  args?: unknown;
  ops: { method: string; args: unknown[] }[];
};

export function fakeSupabase(respond: FakeResponse | ((call: RecordedCall) => FakeResponse) = {}): {
  client: TypedClient;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];

  const answer = (call: RecordedCall): Promise<unknown> => {
    const response = typeof respond === 'function' ? respond(call) : respond;
    if (response.throws !== undefined) return Promise.reject(response.throws);
    const error = response.error ?? null;
    return Promise.resolve({
      data: error ? null : (response.data ?? null),
      error,
      status: response.status ?? (error ? 400 : 200),
      statusText: '',
      count: null,
    });
  };

  const builder = (call: RecordedCall): unknown => {
    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') {
            return (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
              answer(call).then(onFulfilled, onRejected);
          }
          if (typeof prop !== 'string') return undefined;
          return (...args: unknown[]) => {
            call.ops.push({ method: prop, args });
            return proxy;
          };
        },
      },
    );
    return proxy;
  };

  const client = {
    from(table: string) {
      const call: RecordedCall = { kind: 'from', target: table, ops: [] };
      calls.push(call);
      return builder(call);
    },
    rpc(fn: string, args?: unknown) {
      const call: RecordedCall = args === undefined ? { kind: 'rpc', target: fn, ops: [] } : { kind: 'rpc', target: fn, args, ops: [] };
      calls.push(call);
      return builder(call);
    },
  };

  return { client: client as unknown as TypedClient, calls };
}
