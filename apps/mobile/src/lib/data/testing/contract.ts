// Test helper: declare a feature's cases once and run them against the mock
// backend and the Supabase backend (over fakeSupabase), asserting the same Result.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataErrorKind, Result, TypedClient } from '../types';
import { fakeSupabase, type FakeResponse, type RecordedCall } from './fakeSupabase';

export type Expected = { ok: true; data: unknown } | { ok: false; kind: DataErrorKind };

export const ok = (data: unknown): Expected => ({ ok: true, data });
export const errKind = (kind: DataErrorKind): Expected => ({ ok: false, kind });

/** Data is compared deeply; errors by kind only (copy may differ per feature). */
export function assertResult(actual: Result<unknown>, expected: Expected): void {
  if (expected.ok) {
    assert.deepEqual(actual, { ok: true, data: expected.data });
    return;
  }
  assert.equal(actual.ok, false, `expected a ${expected.kind} error, got ${JSON.stringify(actual)}`);
  if (!actual.ok) assert.equal(actual.error.kind, expected.kind);
}

export type ContractCase<Api, Seed> = {
  name: string;
  /** Run against one backend only (for example a network failure). */
  only?: 'mock' | 'supabase';
  /** What the mock starts with. */
  seed?: Seed;
  /** What the fake server answers. */
  server?: FakeResponse | ((call: RecordedCall) => FakeResponse);
  call: (api: Api) => Promise<Result<unknown>>;
  expect: Expected;
  /** Assertions on the recorded Supabase request. */
  checkCalls?: (calls: RecordedCall[]) => void;
};

export type ContractMakers<Api, Seed> = {
  mock: (seed: Seed | undefined) => Api;
  supabase: (client: TypedClient) => Api;
};

export function runContract<Api, Seed>(
  feature: string,
  makers: ContractMakers<Api, Seed>,
  cases: ContractCase<Api, Seed>[],
): void {
  for (const c of cases) {
    if (c.only !== 'supabase') {
      test(`${feature} contract [mock]: ${c.name}`, async () => {
        assertResult(await c.call(makers.mock(c.seed)), c.expect);
      });
    }
    if (c.only !== 'mock') {
      test(`${feature} contract [supabase]: ${c.name}`, async () => {
        const fake = fakeSupabase(c.server ?? {});
        assertResult(await c.call(makers.supabase(fake.client)), c.expect);
        c.checkCalls?.(fake.calls);
      });
    }
  }
}
