import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SERVER_ERROR } from '../authRules';
import {
  GENERIC_ERROR,
  OFFLINE_ERROR,
  RATE_LIMITED_ERROR,
  SESSION_ENDED_ERROR,
  settle,
  toDataError,
} from './errors';

test('network failures are offline', () => {
  assert.equal(toDataError(new TypeError('Network request failed')).kind, 'offline');
  assert.equal(toDataError(new TypeError('Failed to fetch')).kind, 'offline');
  assert.equal(toDataError({ message: 'TypeError: Load failed', code: '', status: 0 }).kind, 'offline');
  assert.deepEqual(toDataError({ message: 'FetchError: aborted', status: 0 }), {
    kind: 'offline',
    message: OFFLINE_ERROR,
    code: 'http_0',
  });
});

test('auth, permission, conflict, invalid, rate limit and server map by code or status', () => {
  const cases: [unknown, string][] = [
    [{ status: 401 }, 'auth'],
    [{ code: 'PGRST301', status: 401 }, 'auth'],
    [{ code: 'PGRST303' }, 'auth'],
    [{ code: '42501', status: 403 }, 'notAllowed'],
    [{ status: 403 }, 'notAllowed'],
    [{ code: '23505', status: 409 }, 'conflict'],
    [{ code: '23503', status: 409 }, 'conflict'],
    [{ code: '23502' }, 'invalid'],
    [{ code: '23514' }, 'invalid'],
    [{ code: '22P02' }, 'invalid'],
    [{ code: '22023' }, 'invalid'],
    [{ code: 'P0001', status: 400 }, 'invalid'],
    [{ status: 429 }, 'rateLimited'],
    [{ code: 'XX000', status: 500 }, 'server'],
    [{ status: 503 }, 'server'],
    [{ code: 'ZZ999', status: 400 }, 'unknown'],
    ['a bare string', 'unknown'],
    [null, 'unknown'],
  ];
  for (const [input, kind] of cases) assert.equal(toDataError(input).kind, kind, JSON.stringify(input));
});

test('each kind gets its default copy and keeps the code for logs', () => {
  assert.deepEqual(toDataError({ status: 401 }), { kind: 'auth', message: SESSION_ENDED_ERROR, code: 'http_401' });
  assert.deepEqual(toDataError({ status: 429 }), { kind: 'rateLimited', message: RATE_LIMITED_ERROR, code: 'http_429' });
  assert.deepEqual(toDataError({ code: 'XX000', status: 500 }), { kind: 'server', message: SERVER_ERROR, code: 'XX000' });
  assert.deepEqual(toDataError({ code: '23505' }), { kind: 'conflict', message: GENERIC_ERROR, code: '23505' });
  assert.deepEqual(toDataError(undefined), { kind: 'unknown', message: GENERIC_ERROR });
});

test('the raw server message never becomes the user-facing message', () => {
  const raw = 'new row violates row-level security policy for table "blocks"';
  const error = toDataError({ message: raw, code: '42501', status: 403 });
  assert.notEqual(error.message, raw);
  assert.ok(!error.message.includes('row-level'));
});

test('overrides apply by hint first, then code, then kind', () => {
  const overrides = {
    'hint:seat_taken': { kind: 'conflict' as const, message: 'That seat was just taken.' },
    'code:23505': { message: 'Already done.' },
    rateLimited: { message: 'Slow down.' },
  };
  assert.deepEqual(toDataError({ code: 'P0001', hint: 'seat_taken', status: 400 }, overrides), {
    kind: 'conflict',
    message: 'That seat was just taken.',
    code: 'P0001',
  });
  assert.equal(toDataError({ code: '23505' }, overrides).message, 'Already done.');
  assert.equal(toDataError({ status: 429 }, overrides).message, 'Slow down.');
  assert.equal(toDataError({ status: 500 }, overrides).message, SERVER_ERROR);
});

test('an override that changes only the kind takes that kind\'s default copy', () => {
  const error = toDataError({ code: 'P0001', hint: 'rate_limited' }, { 'hint:rate_limited': { kind: 'rateLimited' } });
  assert.deepEqual(error, { kind: 'rateLimited', message: RATE_LIMITED_ERROR, code: 'P0001' });
});

test('settle maps data on success and errors on failure', async () => {
  const success = await settle(Promise.resolve({ data: 2, error: null, status: 200 }), (n: number) => n * 10);
  assert.deepEqual(success, { ok: true, data: 20 });

  const failure = await settle(
    Promise.resolve({ data: null, error: { message: 'boom', code: 'XX000' }, status: 500 }),
    (n: number) => n,
  );
  assert.deepEqual(failure, { ok: false, error: { kind: 'server', message: SERVER_ERROR, code: 'XX000' } });
});

test('settle turns a supabase-js fetch failure (status 0) and a thrown error into offline', async () => {
  const fetchFailure = await settle(
    Promise.resolve({ data: null, error: { message: 'TypeError: Network request failed', code: '' }, status: 0 }),
    (n: number) => n,
  );
  assert.equal(fetchFailure.ok, false);
  assert.equal(!fetchFailure.ok && fetchFailure.error.kind, 'offline');

  const thrown = await settle(Promise.reject(new TypeError('Failed to fetch')), (n: number) => n);
  assert.equal(!thrown.ok && thrown.error.kind, 'offline');
});

test('settle passes overrides through', async () => {
  const result = await settle(
    Promise.resolve({ data: null, error: { message: 'x', code: 'P0001', hint: 'cutoff_passed' }, status: 400 }),
    (n: number) => n,
    { 'hint:cutoff_passed': { message: 'Too late to change this ride.' } },
  );
  assert.equal(!result.ok && result.error.message, 'Too late to change this ride.');
});
