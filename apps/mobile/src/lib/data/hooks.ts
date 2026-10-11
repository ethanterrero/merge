// React bindings for the query store. Imports react only; holds no logic worth
// testing (that lives in store.ts).

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { toDataError } from './errors';
import {
  BLANK_SNAPSHOT,
  createQueryStore,
  createSingleFlight,
  DEFAULT_STALE_MS,
  defaultIsEmpty,
  toQueryState,
  type Fetcher,
} from './store';
import type { DataError, Query, Result } from './types';

/** The app's one query cache. Module-level, so no root provider is needed. */
export const queryStore = createQueryStore();

export type QueryOptions<T> = {
  /** How long a loaded value counts as fresh. Default 30 s. */
  staleMs?: number;
  /** Refetch on this interval while mounted. */
  pollMs?: number;
  /** Default: null, undefined or []. */
  isEmpty?: (value: T) => boolean;
};

const NOOP_UNSUBSCRIBE = () => {};

/** Developer log: kind and code only, never row data, ids, names or emails. */
export function logDataError(error: DataError): void {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[data] ${error.kind}${error.code ? ` (${error.code})` : ''}`);
  }
}

export function useQuery<T>(
  key: string | null,
  fetcher: () => Promise<Result<T>>,
  options: QueryOptions<T> = {},
): Query<T> {
  const { staleMs = DEFAULT_STALE_MS, pollMs, isEmpty = defaultIsEmpty } = options;
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });
  const run = useCallback<Fetcher>(() => fetcherRef.current(), []);

  const subscribe = useCallback(
    (listener: () => void) => (key ? queryStore.subscribe(key, listener) : NOOP_UNSUBSCRIBE),
    [key],
  );
  const getSnapshot = useCallback(() => (key ? queryStore.getSnapshot(key) : BLANK_SNAPSHOT), [key]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (key) queryStore.ensure(key, run, staleMs);
  }, [key, run, staleMs]);

  useEffect(() => {
    if (!key || !pollMs) return;
    const timer = setInterval(() => void queryStore.fetch(key, run), pollMs);
    return () => clearInterval(timer);
  }, [key, run, pollMs]);

  useEffect(() => {
    if (snapshot.error) logDataError(snapshot.error);
  }, [snapshot.error]);

  const refetch = useCallback(() => {
    if (key) void queryStore.fetch(key, run, { force: true });
  }, [key, run]);

  if (!key) return { status: 'idle', refetch, lastError: null };
  const { state, lastError } = toQueryState<T>(snapshot, isEmpty);
  return { ...state, refetch, lastError };
}

type AnyAction = (...args: never[]) => Promise<Result<unknown>>;

export type MutationHandle<M> = M & { pending: boolean; lastError: DataError | null };

/**
 * Bind actions that resolve to Results. While an action is pending, calling it
 * again returns the same promise, so a double tap sends once.
 */
export function useMutation<M extends Record<string, AnyAction>>(
  actions: M,
  options: { onSuccess?: () => void } = {},
): MutationHandle<M> {
  const actionsRef = useRef(actions);
  const onSuccessRef = useRef(options.onSuccess);
  useEffect(() => {
    actionsRef.current = actions;
    onSuccessRef.current = options.onSuccess;
  });
  const [flight] = useState(createSingleFlight);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastError, setLastError] = useState<DataError | null>(null);
  const names = Object.keys(actions).sort().join('|');

  const bound = useMemo(() => {
    const out: Record<string, AnyAction> = {};
    for (const name of names.split('|').filter(Boolean)) {
      out[name] = (...args) =>
        flight.run(name, async () => {
          setPendingCount((count) => count + 1);
          try {
            let result: Result<unknown>;
            try {
              result = await actionsRef.current[name](...args);
            } catch (error) {
              result = { ok: false, error: toDataError(error) };
            }
            if (result.ok) {
              setLastError(null);
              onSuccessRef.current?.();
            } else {
              setLastError(result.error);
              logDataError(result.error);
            }
            return result;
          } finally {
            setPendingCount((count) => count - 1);
          }
        });
    }
    return out;
  }, [names, flight]);

  return { ...(bound as M), pending: pendingCount > 0, lastError };
}
