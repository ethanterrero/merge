// The one place the data layer meets the auth state and the real Supabase
// client. Everything it calls is pure and tested; this file only wires it.

import { useEffect, useMemo } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../../state/auth';
import { supabase } from '../supabase';
import { SESSION_ENDED_ERROR } from './errors';
import { queryStore, useMutation, useQuery, type MutationHandle, type QueryOptions } from './hooks';
import { dataMode, dataScope } from './mode';
import type { DataMode, Query, Result, TypedClient } from './types';

export type Backends<A> = {
  /** One long-lived instance: its in-memory state lasts the app session. */
  mock: A;
  /** Built for the signed-in member. */
  supabase: (client: TypedClient, userId: string) => A;
};

export function defineBackends<A>(backends: Backends<A>): Backends<A> {
  return backends;
}

// Refetch on-screen data older than its staleMs when the app returns to the foreground.
AppState.addEventListener('change', (state) => {
  if (state === 'active') queryStore.refetchStale();
});

export type DataContext = { mode: DataMode; scope: string | null; userId: string | null };

export function useDataContext(): DataContext {
  const { status, profile } = useAuth();
  const mode = dataMode(status);
  const userId = mode === 'supabase' ? (profile?.id ?? null) : null;
  const scope = dataScope(mode, userId);
  useEffect(() => {
    queryStore.setScope(scope);
  }, [scope]);
  return useMemo(() => ({ mode, scope, userId }), [mode, scope, userId]);
}

function useResolved<A>(backends: Backends<A>): { api: A | null; scope: string | null } {
  const { mode, scope, userId } = useDataContext();
  const api = useMemo(() => {
    if (mode === 'mock') return backends.mock;
    if (mode === 'supabase' && userId) {
      // 'prototype' is exactly "no client", so this can't happen in 'supabase' mode.
      if (!supabase) throw new Error('Data mode is supabase, but no Supabase client is configured.');
      return backends.supabase(supabase, userId);
    }
    return null;
  }, [backends, mode, userId]);
  return { api, scope: api ? scope : null };
}

const notAvailable = (): Result<never> => ({ ok: false, error: { kind: 'auth', message: SESSION_ENDED_ERROR } });

/** The current backend for one-off calls in event handlers. null while the data mode is 'off'. */
export function useBackendApi<A>(backends: Backends<A>): A | null {
  return useResolved(backends).api;
}

/** A query against the current backend. The key is prefixed with the member's scope. */
export function useDataQuery<A, T>(
  backends: Backends<A>,
  key: string | null,
  run: (api: A) => Promise<Result<T>>,
  options?: QueryOptions<T>,
): Query<T> {
  const { api, scope } = useResolved(backends);
  const scopedKey = api && scope && key ? `${scope}:${key}` : null;
  return useQuery<T>(scopedKey, () => (api ? run(api) : Promise.resolve(notAvailable())), options);
}

type ApiAction<A> = (api: A, ...args: never[]) => Promise<Result<unknown>>;
type BoundActions<A, M> = {
  [K in keyof M]: M[K] extends (api: A, ...args: infer P) => infer R ? (...args: P) => R : never;
};

/**
 * Mutations against the current backend. On success, invalidates the feature's
 * key prefix, or every key in the member's scope with 'all'.
 */
export function useDataMutation<A, M extends Record<string, ApiAction<A>>>(
  backends: Backends<A>,
  actions: M,
  options: { invalidate: string },
): MutationHandle<BoundActions<A, M>> {
  const { api, scope } = useResolved(backends);
  const bound = useMemo(() => {
    const out: Record<string, (...args: never[]) => Promise<Result<unknown>>> = {};
    for (const [name, action] of Object.entries(actions)) {
      out[name] = (...args) => (api ? action(api, ...args) : Promise.resolve(notAvailable()));
    }
    return out;
  }, [actions, api]);
  const handle = useMutation(bound, {
    onSuccess: () => {
      if (!scope) return;
      queryStore.invalidate(options.invalidate === 'all' ? scope : `${scope}:${options.invalidate}`);
    },
  });
  return handle as unknown as MutationHandle<BoundActions<A, M>>;
}
