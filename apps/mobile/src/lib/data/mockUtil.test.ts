import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findById, mockResult } from './mockUtil';

const ITEMS = [
  { id: 'priya', name: 'Priya S.' },
  { id: 'marcus', name: 'Marcus L.' },
];

test('findById returns the matching item', () => {
  assert.equal(findById(ITEMS, 'marcus')?.name, 'Marcus L.');
});

test('findById returns null for an unknown id, never the first item', () => {
  assert.equal(findById(ITEMS, 'nobody'), null);
  assert.equal(findById(ITEMS, ''), null);
  assert.equal(findById([], 'priya'), null);
});

test('mockResult resolves asynchronously with the produced data', async () => {
  let produced = false;
  const pending = mockResult('get', {}, () => {
    produced = true;
    return 42;
  });
  assert.equal(produced, false);
  assert.deepEqual(await pending, { ok: true, data: 42 });
});

test('mockResult returns the injected failure for the named method only', async () => {
  const options = {
    fail: (method: string) => (method === 'block' ? { kind: 'server' as const, message: 'x' } : null),
  };
  assert.deepEqual(await mockResult('block', options, () => 1), {
    ok: false,
    error: { kind: 'server', message: 'x' },
  });
  assert.deepEqual(await mockResult('list', options, () => 1), { ok: true, data: 1 });
});
