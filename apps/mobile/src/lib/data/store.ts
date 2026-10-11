// Pure query store: cache, dedupe, stale-response guard, invalidation by key
// prefix and per-user scope. No React here; hooks.ts binds it to components.

import { toDataError } from './errors';
import type { DataError, QueryState, Result } from './types';

export type Fetcher<T = unknown> = () => Promise<Result<T>>;

/** Immutable view of one cache entry. A new object on every change. */
export type EntrySnapshot = {
  hasValue: boolean;
  value: unknown;
  /** The last failure; cleared by the next success. */
  error: DataError | null;
  fetching: boolean;
  /** When the value was last loaded or set (0 = never). */
  fetchedAt: number;
};

export const BLANK_SNAPSHOT: EntrySnapshot = Object.freeze({
  hasValue: false,
  value: undefined,
  error: null,
  fetching: false,
  fetchedAt: 0,
});

export const DEFAULT_STALE_MS = 30_000;

export function defaultIsEmpty(value: unknown): boolean {
  return value === null || value === undefined || (Array.isArray(value) && value.length === 0);
}

export function toQueryState<T>(
  snap: EntrySnapshot,
  isEmpty: (value: T) => boolean = defaultIsEmpty,
): { state: QueryState<NonNullable<T>>; lastError: DataError | null } {
  if (snap.hasValue) {
    const value = snap.value as T;
    if (isEmpty(value)) return { state: { status: 'empty', refreshing: snap.fetching }, lastError: snap.error };
    return {
      state: { status: 'success', data: value as NonNullable<T>, refreshing: snap.fetching },
      lastError: snap.error,
    };
  }
  if (snap.error && !snap.fetching) return { state: { status: 'error', error: snap.error }, lastError: null };
  return { state: { status: 'loading' }, lastError: null };
}

type Entry = {
  snapshot: EntrySnapshot;
  stale: boolean;
  staleMs: number;
  seq: number;
  /** Bumped by invalidate(). A fetch that started under an older generation answers a question that's out of date. */
  generation: number;
  inflight: Promise<void> | null;
  fetcher: Fetcher | null;
  listeners: Set<() => void>;
};

function matchesPrefix(key: string, prefix: string): boolean {
  return key === prefix || key.startsWith(`${prefix}:`);
}

export function createQueryStore(options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry>();
  let scope: string | null | undefined;

  function entryFor(key: string): Entry {
    let entry = entries.get(key);
    if (!entry) {
      entry = {
        snapshot: BLANK_SNAPSHOT,
        stale: false,
        staleMs: DEFAULT_STALE_MS,
        seq: 0,
        generation: 0,
        inflight: null,
        fetcher: null,
        listeners: new Set(),
      };
      entries.set(key, entry);
    }
    return entry;
  }

  function notify(entry: Entry): void {
    for (const listener of [...entry.listeners]) listener();
  }

  function update(entry: Entry, patch: Partial<EntrySnapshot>): void {
    entry.snapshot = { ...entry.snapshot, ...patch };
    notify(entry);
  }

  function isStale(entry: Entry): boolean {
    return entry.stale || !entry.snapshot.hasValue || now() - entry.snapshot.fetchedAt >= entry.staleMs;
  }

  /** Load a key. Joins a request already in flight unless `force` is set. */
  function fetch(key: string, fetcher: Fetcher, opts: { force?: boolean } = {}): Promise<void> {
    const entry = entryFor(key);
    entry.fetcher = fetcher;
    if (entry.inflight && !opts.force) return entry.inflight;
    const seq = ++entry.seq;
    const generation = entry.generation;
    update(entry, { fetching: true });
    const run = (async () => {
      let result: Result<unknown>;
      try {
        result = await fetcher();
      } catch (error) {
        result = { ok: false, error: toDataError(error) };
      }
      // A newer request owns the entry, or the entry was evicted by a scope switch.
      if (entries.get(key) !== entry || seq !== entry.seq) return;
      entry.inflight = null;
      if (result.ok && generation !== entry.generation) {
        // Started before an invalidation (for example a block committed meanwhile): the
        // answer may predate that write. Keep the entry stale so the next mount refetches,
        // and don't overwrite a value written since (setQueryData); use it only if there's nothing.
        update(entry, entry.snapshot.hasValue ? { fetching: false } : { hasValue: true, value: result.data, error: null, fetching: false, fetchedAt: now() });
      } else if (result.ok) {
        entry.stale = false;
        update(entry, { hasValue: true, value: result.data, error: null, fetching: false, fetchedAt: now() });
      } else {
        update(entry, { error: result.error, fetching: false });
      }
    })();
    entry.inflight = run;
    return run;
  }

  /** Called when a component mounts a key: fetch unless the cached value is fresh. */
  function ensure(key: string, fetcher: Fetcher, staleMs: number = DEFAULT_STALE_MS): void {
    const entry = entryFor(key);
    entry.fetcher = fetcher;
    entry.staleMs = staleMs;
    if (!entry.inflight && isStale(entry)) void fetch(key, fetcher);
  }

  /** Mark every entry under `prefix` stale and refetch the ones on screen. */
  function invalidate(prefix: string): void {
    for (const [key, entry] of entries) {
      if (!matchesPrefix(key, prefix)) continue;
      entry.stale = true;
      entry.generation += 1;
      if (entry.listeners.size > 0 && entry.fetcher) void fetch(key, entry.fetcher, { force: true });
    }
  }

  /** Refetch on-screen entries older than their staleMs (the app returned to the foreground). */
  function refetchStale(): void {
    for (const [key, entry] of entries) {
      if (entry.listeners.size > 0 && entry.fetcher && !entry.inflight && isStale(entry)) void fetch(key, entry.fetcher);
    }
  }

  /** Drop every entry outside the new scope, so one member never sees another's data. */
  function setScope(next: string | null): void {
    if (next === scope) return;
    scope = next;
    for (const [key, entry] of [...entries]) {
      if (next !== null && key.startsWith(`${next}:`)) continue;
      entries.delete(key);
      notify(entry);
    }
  }

  function setQueryData<T>(key: string, updater: (prev: T | undefined) => T): void {
    const entry = entryFor(key);
    const prev = entry.snapshot.hasValue ? (entry.snapshot.value as T) : undefined;
    update(entry, { hasValue: true, value: updater(prev), error: null, fetchedAt: now() });
  }

  function subscribe(key: string, listener: () => void): () => void {
    const entry = entryFor(key);
    entry.listeners.add(listener);
    return () => {
      entry.listeners.delete(listener);
    };
  }

  function getSnapshot(key: string): EntrySnapshot {
    return entries.get(key)?.snapshot ?? BLANK_SNAPSHOT;
  }

  return {
    getSnapshot,
    subscribe,
    fetch,
    ensure,
    invalidate,
    refetchStale,
    setScope,
    setQueryData,
    clear: () => entries.clear(),
  };
}

export type QueryStore = ReturnType<typeof createQueryStore>;

/** While an action is pending, calling it again returns the same promise (no double sends). */
export function createSingleFlight() {
  const pending = new Map<string, Promise<unknown>>();
  return {
    run<T>(name: string, fn: () => Promise<T>): Promise<T> {
      const existing = pending.get(name);
      if (existing) return existing as Promise<T>;
      const promise = fn().finally(() => pending.delete(name));
      pending.set(name, promise);
      return promise;
    },
    isPending(name?: string): boolean {
      return name === undefined ? pending.size > 0 : pending.has(name);
    },
  };
}
