import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settle } from './errors';
import { fakeSupabase } from './testing/fakeSupabase';
import { assertResult, errKind, ok } from './testing/contract';

test('the fake records a from() chain and resolves to the canned response', async () => {
  const fake = fakeSupabase({ data: [{ id: 'a' }] });
  const result = await settle(fake.client.from('profiles').select('id').eq('id', 'a').limit(1), (rows) => rows);
  assert.deepEqual(result, { ok: true, data: [{ id: 'a' }] });
  assert.deepEqual(fake.calls, [
    {
      kind: 'from',
      target: 'profiles',
      ops: [
        { method: 'select', args: ['id'] },
        { method: 'eq', args: ['id', 'a'] },
        { method: 'limit', args: [1] },
      ],
    },
  ]);
});

test('the fake records rpc calls with their arguments', async () => {
  const fake = fakeSupabase({ data: null });
  await fake.client.rpc('is_active', { uid: 'u1' });
  assert.deepEqual(fake.calls, [{ kind: 'rpc', target: 'is_active', args: { uid: 'u1' }, ops: [] }]);
});

test('the fake returns errors with a status, and can throw', async () => {
  const failing = fakeSupabase({ error: { message: 'boom', code: 'XX000' }, status: 500 });
  const response = await failing.client.from('profiles').select('id');
  assert.equal(response.status, 500);
  assert.equal(response.data, null);

  const throwing = fakeSupabase({ throws: new TypeError('Failed to fetch') });
  await assert.rejects(Promise.resolve(throwing.client.from('profiles').select('id')), TypeError);
});

test('the fake can answer per call', async () => {
  const fake = fakeSupabase((call) => ({ data: call.target === 'a' ? 1 : 2 }));
  assert.equal((await fake.client.rpc('area_radius_m')).data, 2);
});

test('assertResult compares data deeply and errors by kind', () => {
  assertResult({ ok: true, data: { a: 1 } }, ok({ a: 1 }));
  assertResult({ ok: false, error: { kind: 'offline', message: 'm' } }, errKind('offline'));
  assert.throws(() => assertResult({ ok: true, data: 1 }, errKind('offline')));
  assert.throws(() => assertResult({ ok: false, error: { kind: 'server', message: 'm' } }, errKind('offline')));
  assert.throws(() => assertResult({ ok: true, data: 1 }, ok(2)));
});
