import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockedOnLabel, isBlocked, toBlockedIds, type BlockedPerson, type BlocksApi } from './blocks.api';
import { BLOCK_COLUMNS, toBlockedPerson, type BlockRow } from './blocks.map';
import { createBlocksMock, type BlocksMockOptions } from './blocks.mock';
import { createBlocksSupabase } from './blocks.supabase';
import { errKind, ok, runContract } from './testing/contract';
import type { RecordedCall } from './testing/fakeSupabase';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const THIRD = '33333333-3333-4333-8333-333333333333';

const OLDER: BlockedPerson = { id: THIRD, blockedAt: '2026-10-08T15:00:00.000Z' };
const NEWER: BlockedPerson = { id: OTHER, blockedAt: '2026-10-09T15:00:00.000Z' };
const ROWS: BlockRow[] = [
  { blocked_id: OTHER, created_at: '2026-10-09T15:00:00.000Z' },
  { blocked_id: THIRD, created_at: '2026-10-08T15:00:00.000Z' },
];

const listQuery = (calls: RecordedCall[]) => {
  assert.deepEqual(calls, [
    {
      kind: 'from',
      target: 'blocks',
      ops: [
        { method: 'select', args: [BLOCK_COLUMNS] },
        { method: 'eq', args: ['blocker_id', ME] },
        { method: 'order', args: ['created_at', { ascending: false }] },
      ],
    },
  ]);
};

// Idempotent insert without RETURNING: the spec's `on conflict do nothing` path.
const blockInsert = (id: string) => (calls: RecordedCall[]) => {
  assert.deepEqual(calls, [
    {
      kind: 'from',
      target: 'blocks',
      ops: [
        {
          method: 'upsert',
          args: [{ blocker_id: ME, blocked_id: id }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true }],
        },
      ],
    },
  ]);
};

const unblockDelete = (id: string) => (calls: RecordedCall[]) => {
  assert.deepEqual(calls, [
    {
      kind: 'from',
      target: 'blocks',
      ops: [
        { method: 'delete', args: [] },
        { method: 'eq', args: ['blocker_id', ME] },
        { method: 'eq', args: ['blocked_id', id] },
      ],
    },
  ]);
};

const noCalls = (calls: RecordedCall[]) => assert.deepEqual(calls, []);

runContract<BlocksApi, BlocksMockOptions>(
  'blocks',
  {
    mock: (seed) => createBlocksMock({ meId: ME, ...seed }),
    supabase: (client) => createBlocksSupabase(client, ME),
  },
  [
    {
      name: 'nobody blocked is an empty list',
      server: { data: [] },
      call: (api) => api.listBlocked(),
      expect: ok([]),
      checkCalls: listQuery,
    },
    {
      name: 'my blocks map to the UI type, newest first',
      seed: { blocks: [OLDER, NEWER] },
      server: { data: ROWS },
      call: (api) => api.listBlocked(),
      expect: ok([NEWER, OLDER]),
      checkCalls: listQuery,
    },
    {
      name: 'block inserts my row without reading it back',
      server: { data: null, status: 201 },
      call: (api) => api.block(OTHER),
      expect: ok(null),
      checkCalls: blockInsert(OTHER),
    },
    {
      name: 'blocking someone already blocked succeeds',
      seed: { blocks: [NEWER] },
      server: { data: null, status: 201 },
      call: (api) => api.block(OTHER),
      expect: ok(null),
      checkCalls: blockInsert(OTHER),
    },
    {
      name: 'blocking yourself is invalid and sends nothing',
      server: { data: null },
      call: (api) => api.block(ME),
      expect: errKind('invalid'),
      checkCalls: noCalls,
    },
    {
      name: 'blocking an empty id is invalid and sends nothing',
      call: (api) => api.block(''),
      expect: errKind('invalid'),
      checkCalls: noCalls,
    },
    {
      name: 'unblock deletes only my row for that person',
      seed: { blocks: [NEWER, OLDER] },
      server: { data: null, status: 204 },
      call: (api) => api.unblock(OTHER),
      expect: ok(null),
      checkCalls: unblockDelete(OTHER),
    },
    {
      name: "unblocking someone who isn't blocked succeeds",
      server: { data: null, status: 204 },
      call: (api) => api.unblock(OTHER),
      expect: ok(null),
    },
    {
      name: 'a failed fetch (status 0) is offline',
      only: 'supabase',
      server: { error: { message: 'TypeError: Network request failed', code: '' }, status: 0 },
      call: (api) => api.block(OTHER),
      expect: errKind('offline'),
    },
    {
      name: 'a thrown fetch error is offline, not an exception',
      only: 'supabase',
      server: { throws: new TypeError('Failed to fetch') },
      call: (api) => api.listBlocked(),
      expect: errKind('offline'),
    },
    {
      name: 'an expired session is auth',
      only: 'supabase',
      server: { error: { message: 'JWT expired', code: 'PGRST303' }, status: 401 },
      call: (api) => api.unblock(OTHER),
      expect: errKind('auth'),
    },
    {
      name: 'an injected failure surfaces as that error',
      only: 'mock',
      seed: { fail: (method) => (method === 'block' ? { kind: 'server', message: 'x' } : null) },
      call: (api) => api.block(OTHER),
      expect: errKind('server'),
    },
  ],
);

test('a block in the mock shows up in the list, and unblock removes it', async () => {
  let clock = Date.parse('2026-10-10T17:00:00.000Z');
  const mock = createBlocksMock({ meId: ME, now: () => new Date(clock) });
  assert.deepEqual(await mock.block(OTHER), { ok: true, data: null });
  clock += 1000;
  assert.deepEqual(await mock.block(THIRD), { ok: true, data: null });
  assert.deepEqual(await mock.listBlocked(), {
    ok: true,
    data: [
      { id: THIRD, blockedAt: '2026-10-10T17:00:01.000Z' },
      { id: OTHER, blockedAt: '2026-10-10T17:00:00.000Z' },
    ],
  });
  assert.deepEqual(await mock.unblock(THIRD), { ok: true, data: null });
  assert.deepEqual(await mock.listBlocked(), { ok: true, data: [{ id: OTHER, blockedAt: '2026-10-10T17:00:00.000Z' }] });
});

test('blocking twice in the mock keeps one row with the first timestamp', async () => {
  let clock = Date.parse('2026-10-10T17:00:00.000Z');
  const mock = createBlocksMock({ meId: ME, now: () => new Date(clock) });
  await mock.block(OTHER);
  clock += 60_000;
  await mock.block(OTHER);
  assert.deepEqual(await mock.listBlocked(), { ok: true, data: [{ id: OTHER, blockedAt: '2026-10-10T17:00:00.000Z' }] });
});

test('mock instances never share state', async () => {
  const a = createBlocksMock({ meId: ME });
  const b = createBlocksMock({ meId: ME });
  await a.block(OTHER);
  assert.deepEqual(await b.listBlocked(), { ok: true, data: [] });
});

test('the mock list is a copy the caller cannot mutate', async () => {
  const mock = createBlocksMock({ meId: ME, blocks: [NEWER] });
  const first = await mock.listBlocked();
  assert.ok(first.ok);
  first.data.pop();
  assert.deepEqual(await mock.listBlocked(), { ok: true, data: [NEWER] });
});

test('the default mock is the prototype member with nobody blocked', async () => {
  const mock = createBlocksMock();
  assert.deepEqual(await mock.listBlocked(), { ok: true, data: [] });
  assert.equal((await mock.block('prototype-member')).ok, false);
});

test('toBlockedPerson copies only the UI fields', () => {
  assert.deepEqual(toBlockedPerson(ROWS[0]), NEWER);
  assert.deepEqual(Object.keys(toBlockedPerson(ROWS[0])).sort(), ['blockedAt', 'id']);
});

test('the Supabase backend never selects * and never reads who blocked whom', () => {
  assert.ok(!BLOCK_COLUMNS.includes('*'));
  assert.ok(!BLOCK_COLUMNS.includes('blocker_id'));
});

test('isBlocked works on a set or a list, and is false for a missing id', () => {
  assert.equal(isBlocked(new Set([OTHER]), OTHER), true);
  assert.equal(isBlocked(new Set([OTHER]), THIRD), false);
  assert.equal(isBlocked([NEWER, OLDER], THIRD), true);
  assert.equal(isBlocked([NEWER], ME), false);
  assert.equal(isBlocked([NEWER], null), false);
  assert.equal(isBlocked(new Set(['']), ''), false);
  assert.equal(isBlocked([], undefined), false);
});

test('toBlockedIds reports readiness and answers isBlocked from the query', () => {
  const loaded = toBlockedIds('success', [NEWER, OLDER]);
  assert.equal(loaded.status, 'ready');
  assert.deepEqual([...loaded.ids].sort(), [OTHER, THIRD].sort());
  assert.equal(loaded.isBlocked(OTHER), true);
  assert.equal(loaded.isBlocked(ME), false);

  const empty = toBlockedIds('empty', null);
  assert.equal(empty.status, 'ready');
  assert.equal(empty.ids.size, 0);

  assert.equal(toBlockedIds('idle', null).status, 'idle');
  assert.equal(toBlockedIds('loading', null).status, 'loading');
  const failed = toBlockedIds('error', [NEWER]);
  assert.equal(failed.status, 'error');
  assert.equal(failed.isBlocked(OTHER), false);
});

test('blockedOnLabel formats in local time and is empty for a bad timestamp', () => {
  const local = new Date(2026, 9, 10, 9, 30);
  assert.equal(blockedOnLabel(local.toISOString()), 'Blocked Oct 10, 2026');
  assert.equal(blockedOnLabel('not a date'), '');
});
