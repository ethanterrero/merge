import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLANK_SNAPSHOT, createQueryStore, createSingleFlight, defaultIsEmpty, toQueryState, type EntrySnapshot } from './store';
import type { DataError, Result } from './types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const SERVER: DataError = { kind: 'server', message: 'Something went wrong on our side.' };
const fail = (error: DataError = SERVER): Result<never> => ({ ok: false, error });

function counter<T>(result: () => Result<T>) {
  const fn = async () => {
    fn.calls += 1;
    return result();
  };
  fn.calls = 0;
  return fn;
}

test('concurrent fetches of one key share one request', async () => {
  const store = createQueryStore();
  const fetcher = counter(() => ok('v'));
  await Promise.all([store.fetch('mock:k', fetcher), store.fetch('mock:k', fetcher)]);
  assert.equal(fetcher.calls, 1);
  assert.equal(store.getSnapshot('mock:k').value, 'v');
});

test('a late response from an older request is dropped', async () => {
  const store = createQueryStore();
  const older = deferred<Result<string>>();
  const newer = deferred<Result<string>>();
  const first = store.fetch('mock:k', () => older.promise);
  const second = store.fetch('mock:k', () => newer.promise, { force: true });
  newer.resolve(ok('new'));
  await second;
  older.resolve(ok('old'));
  await first;
  assert.equal(store.getSnapshot('mock:k').value, 'new');
  assert.equal(store.getSnapshot('mock:k').fetching, false);
});

test('ensure fetches once, skips a fresh entry and refetches a stale one', async () => {
  let now = 0;
  const store = createQueryStore({ now: () => now });
  const fetcher = counter(() => ok('v'));
  store.ensure('mock:k', fetcher, 30_000);
  await store.fetch('mock:k', fetcher); // joins the in-flight request
  assert.equal(fetcher.calls, 1);
  now = 10_000;
  store.ensure('mock:k', fetcher, 30_000);
  assert.equal(fetcher.calls, 1);
  now = 30_000;
  store.ensure('mock:k', fetcher, 30_000);
  assert.equal(fetcher.calls, 2);
});

test('ensure retries an entry whose last load failed', async () => {
  const store = createQueryStore();
  let result: Result<string> = fail();
  const fetcher = counter(() => result);
  await store.fetch('mock:k', fetcher);
  result = ok('v');
  store.ensure('mock:k', fetcher);
  await store.fetch('mock:k', fetcher);
  assert.equal(fetcher.calls, 2);
  assert.equal(store.getSnapshot('mock:k').value, 'v');
});

test('invalidate refetches only subscribed keys under the prefix', async () => {
  const store = createQueryStore();
  const me = counter(() => ok('me'));
  const other = counter(() => ok('other'));
  const inbox = counter(() => ok('inbox'));
  await store.fetch('mock:profile:me', me);
  await store.fetch('mock:profile:id:x', other);
  await store.fetch('mock:inbox', inbox);
  store.subscribe('mock:profile:me', () => {});
  store.subscribe('mock:inbox', () => {});

  store.invalidate('mock:profile');
  await new Promise((r) => setImmediate(r));
  assert.equal(me.calls, 2);
  assert.equal(other.calls, 1); // not subscribed: marked stale, fetched on next mount
  assert.equal(inbox.calls, 1);

  store.ensure('mock:profile:id:x', other);
  assert.equal(other.calls, 2);
});

test('invalidating the scope prefix refetches every subscribed key in it', async () => {
  const store = createQueryStore();
  const a = counter(() => ok('a'));
  const b = counter(() => ok('b'));
  await store.fetch('sb:u1:profile:me', a);
  await store.fetch('sb:u1:inbox', b);
  store.subscribe('sb:u1:profile:me', () => {});
  store.subscribe('sb:u1:inbox', () => {});
  store.invalidate('sb:u1');
  await new Promise((r) => setImmediate(r));
  assert.equal(a.calls, 2);
  assert.equal(b.calls, 2);
});

test('a fetch that started before an invalidation neither clears stale nor overwrites newer data', async () => {
  let now = 0;
  const store = createQueryStore({ now: () => now });
  // Cached and fresh, with no subscriber (the screen is unmounted).
  await store.fetch('mock:list', async () => ok(['a']));
  const before = deferred<Result<string[]>>();
  const inflight = store.fetch('mock:list', () => before.promise, { force: true });
  // A write lands (for example a block): the cache is updated, then everything is invalidated.
  store.setQueryData<string[]>('mock:list', () => ['a', 'blocked']);
  store.invalidate('mock');
  // The pre-write response arrives afterwards.
  before.resolve(ok(['a']));
  await inflight;
  assert.deepEqual(store.getSnapshot('mock:list').value, ['a', 'blocked']);
  assert.equal(store.getSnapshot('mock:list').fetching, false);
  // Still stale: mounting refetches at once instead of trusting the old answer for 30 s.
  now = 1;
  const fetcher = counter(() => ok(['a', 'blocked']));
  store.ensure('mock:list', fetcher, 30_000);
  assert.equal(fetcher.calls, 1);
});

test('a fetch that started after the last invalidation still counts as fresh', async () => {
  let now = 0;
  const store = createQueryStore({ now: () => now });
  store.invalidate('mock');
  await store.fetch('mock:list', async () => ok(['a']));
  now = 1;
  const fetcher = counter(() => ok(['b']));
  store.ensure('mock:list', fetcher, 30_000);
  assert.equal(fetcher.calls, 0);
});

test('a prefix matches whole segments only', async () => {
  const store = createQueryStore();
  const rides = counter(() => ok('r'));
  await store.fetch('mock:rides', rides);
  store.subscribe('mock:rides', () => {});
  store.invalidate('mock:ride');
  await new Promise((r) => setImmediate(r));
  assert.equal(rides.calls, 1);
});

test('a scope switch drops entries from other scopes and notifies', async () => {
  const store = createQueryStore();
  store.setScope('sb:a');
  await store.fetch('sb:a:profile:me', async () => ok('alice'));
  let notified = 0;
  store.subscribe('sb:a:profile:me', () => {
    notified += 1;
  });

  store.setScope('sb:b');
  assert.equal(store.getSnapshot('sb:a:profile:me'), BLANK_SNAPSHOT);
  assert.equal(notified, 1);

  await store.fetch('sb:b:profile:me', async () => ok('bob'));
  store.setScope(null); // signed out
  assert.equal(store.getSnapshot('sb:b:profile:me'), BLANK_SNAPSHOT);
});

test('an evicted entry ignores a response that arrives after the scope switch', async () => {
  const store = createQueryStore();
  store.setScope('sb:a');
  const late = deferred<Result<string>>();
  const pending = store.fetch('sb:a:k', () => late.promise);
  store.setScope('sb:b');
  late.resolve(ok('alice'));
  await pending;
  assert.equal(store.getSnapshot('sb:a:k'), BLANK_SNAPSHOT);
});

test('a failed refetch keeps cached data and sets lastError', async () => {
  const store = createQueryStore();
  await store.fetch('mock:k', async () => ok(['a']));
  await store.fetch('mock:k', async () => fail(), { force: true });
  const { state, lastError } = toQueryState<string[]>(store.getSnapshot('mock:k'));
  assert.deepEqual(state, { status: 'success', data: ['a'], refreshing: false });
  assert.deepEqual(lastError, SERVER);
});

test('a fetcher that throws becomes an error state, not a rejection', async () => {
  const store = createQueryStore();
  await store.fetch('mock:k', async () => {
    throw new TypeError('Failed to fetch');
  });
  const { state } = toQueryState(store.getSnapshot('mock:k'));
  assert.equal(state.status, 'error');
  assert.equal(state.status === 'error' && state.error.kind, 'offline');
});

test('listeners hear the start and the end of a fetch', async () => {
  const store = createQueryStore();
  const seen: boolean[] = [];
  store.subscribe('mock:k', () => seen.push(store.getSnapshot('mock:k').fetching));
  await store.fetch('mock:k', async () => ok(1));
  assert.deepEqual(seen, [true, false]);
});

test('getSnapshot is stable between changes', async () => {
  const store = createQueryStore();
  await store.fetch('mock:k', async () => ok(1));
  assert.equal(store.getSnapshot('mock:k'), store.getSnapshot('mock:k'));
  assert.equal(store.getSnapshot('mock:unknown'), BLANK_SNAPSHOT);
});

test('setQueryData passes the previous value and notifies', async () => {
  const store = createQueryStore();
  let notified = 0;
  store.subscribe('mock:thread', () => {
    notified += 1;
  });
  store.setQueryData<string[]>('mock:thread', (prev) => [...(prev ?? []), 'hi']);
  store.setQueryData<string[]>('mock:thread', (prev) => [...(prev ?? []), 'there']);
  assert.deepEqual(store.getSnapshot('mock:thread').value, ['hi', 'there']);
  assert.equal(notified, 2);
});

test('refetchStale refetches only subscribed entries past their staleMs', async () => {
  let now = 0;
  const store = createQueryStore({ now: () => now });
  const watched = counter(() => ok('w'));
  const unwatched = counter(() => ok('u'));
  store.subscribe('mock:watched', () => {});
  store.ensure('mock:watched', watched, 30_000);
  store.ensure('mock:unwatched', unwatched, 30_000);
  await new Promise((r) => setImmediate(r));
  now = 29_999;
  store.refetchStale();
  assert.equal(watched.calls, 1);
  now = 30_000;
  store.refetchStale();
  assert.equal(watched.calls, 2);
  assert.equal(unwatched.calls, 1);
});

test('defaultIsEmpty: null, undefined and [] are empty', () => {
  assert.equal(defaultIsEmpty(null), true);
  assert.equal(defaultIsEmpty(undefined), true);
  assert.equal(defaultIsEmpty([]), true);
  assert.equal(defaultIsEmpty([0]), false);
  assert.equal(defaultIsEmpty(0), false);
  assert.equal(defaultIsEmpty(''), false);
  assert.equal(defaultIsEmpty({}), false);
});

test('toQueryState covers loading, error, empty, success and refreshing', () => {
  const snap = (patch: Partial<EntrySnapshot>): EntrySnapshot => ({ ...BLANK_SNAPSHOT, ...patch });
  assert.deepEqual(toQueryState(BLANK_SNAPSHOT).state, { status: 'loading' });
  assert.deepEqual(toQueryState(snap({ fetching: true })).state, { status: 'loading' });
  assert.deepEqual(toQueryState(snap({ error: SERVER })).state, { status: 'error', error: SERVER });
  assert.deepEqual(toQueryState(snap({ error: SERVER, fetching: true })).state, { status: 'loading' });
  assert.deepEqual(toQueryState(snap({ hasValue: true, value: null })).state, { status: 'empty', refreshing: false });
  assert.deepEqual(toQueryState(snap({ hasValue: true, value: [], fetching: true })).state, {
    status: 'empty',
    refreshing: true,
  });
  assert.deepEqual(toQueryState(snap({ hasValue: true, value: 'v' })).state, {
    status: 'success',
    data: 'v',
    refreshing: false,
  });
  const noRides = toQueryState<{ rides: string[] }>(snap({ hasValue: true, value: { rides: [] } }), (v) => v.rides.length === 0);
  assert.equal(noRides.state.status, 'empty');
});

test('single flight: a second call while pending returns the same promise', async () => {
  const flight = createSingleFlight();
  const gate = deferred<string>();
  let calls = 0;
  const run = () =>
    flight.run('send', () => {
      calls += 1;
      return gate.promise;
    });
  const first = run();
  const second = run();
  assert.equal(first, second);
  assert.equal(flight.isPending('send'), true);
  gate.resolve('sent');
  assert.equal(await second, 'sent');
  assert.equal(calls, 1);
  assert.equal(flight.isPending(), false);
  await flight.run('send', async () => {
    calls += 1;
    return 'again';
  });
  assert.equal(calls, 2);
});

test('single flight clears a rejected action', async () => {
  const flight = createSingleFlight();
  await assert.rejects(flight.run('x', async () => Promise.reject(new Error('nope'))));
  assert.equal(flight.isPending('x'), false);
});
