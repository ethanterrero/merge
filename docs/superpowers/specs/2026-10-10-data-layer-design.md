# Typed data layer with mock and Supabase backends — design (M-19)

**Date:** 2026-10-10
**Status:** Draft, awaiting the owner's approval. Open choices are listed under
[Owner questions](#owner-questions), each with a recommendation.
**Scope:** `apps/mobile/src/lib/data/**` (new). No screen, `App.tsx`, `src/state/*`,
`src/lib/supabase.ts` or `src/data/mock.ts` change. No new dependency.
**Builds on:** the two modes in `2026-10-08-supabase-auth-design.md` (`prototype` when
`.env` is empty, connected otherwise); `AuthStatus` and `deriveStatus` in
`src/lib/authRules.ts`; the CI-generated `src/lib/database.types.ts` (M-03).
**Consumers:** M-24 (`safety.ts`), M-34 (`commute.ts`), M-35 (`invitations.ts`),
M-36 (`inbox.ts`), M-42 (`matches.ts`), M-43 and M-47 (`rides.ts`), M-44
(`firstRide.ts`), M-48 (`crews.ts`), M-50 (`messages.ts`), M-55b (`contacts.ts`).

Every screen reads `MATCHES`, `REQUESTS`, `findMatch` and `findRequest` straight from
`src/data/mock.ts`, and the two finders silently return the first item for an unknown
id, which would hide missing data once real ids flow through. About ten wiring tasks
are about to move screens onto Supabase. This spec fixes one small pattern for all of
them before each invents its own: per-feature modules with typed async functions and
hooks, a mock backend and a Supabase backend behind one interface, mode selection by
`useAuth().status`, one error model, one loading and caching approach, and a test
pattern that keeps both backends in step. It ships one sample module (`profile`).

## Decisions

1. **One interface, two backends, per feature.** Each feature defines a TypeScript
   interface (`ProfileApi`, `SafetyApi`, …). A mock backend and a Supabase backend
   both implement it (`satisfies ProfileApi`), so a missing or mistyped method fails
   `npm run typecheck`.
2. **Mode comes only from `useAuth().status`,** through one pure function:

   | `status` | Data mode | Behavior |
   | --- | --- | --- |
   | `prototype` | `mock` | Mock backend, in-memory, today's sample data |
   | `ready` | `supabase` | Supabase backend with the signed-in user's id |
   | `loading`, `signedOut`, `needsProfile` | `off` | Hooks stay `idle`, nothing is fetched |

   **Mock data never renders when Supabase is configured.** There's no fallback from
   `supabase` to `mock` on error: a real tester must never see fictional people
   presented as matches. An error is shown as an error. (See owner question 2 for
   `needsProfile`.)
3. **Plain React hooks and a small in-house query store, no TanStack Query.** See
   [Loading and caching](#loading-and-caching) and owner question 1.
4. **Async functions never throw.** Every backend method resolves to a
   `Result<T> = { ok: true; data: T } | { ok: false; error: DataError }`. This
   matches `state/auth.tsx`, whose actions resolve to an error message or null.
5. **"Not found" is data, not an error.** A by-id read resolves to `{ ok: true, data:
   null }` when the row doesn't exist **or RLS hides it.** The two are
   indistinguishable on purpose: the UI can't tell "blocked", "suspended", "declined"
   or "deleted" apart from "not there", which keeps the privacy invariants (no
   revealing who said "no", blocked pairs and suspended members never appear).
   The mock backend returns `null` for unknown ids and never falls back to the
   first item.
6. **Rows never reach screens.** Supabase backends map database rows (typed from the
   generated `Database`) to UI types in pure mapper modules. A schema change breaks
   the mapper at typecheck, and every column that reaches the UI is chosen
   deliberately.
7. **Purity rule** (written here so every later wiring task follows it): everything
   tested lives in pure modules that don't import `react-native`, `expo*`, `@expo/*`,
   `src/lib/supabase.ts` or `src/state/*`, directly or transitively. The Supabase
   client is **injected** into Supabase backends as a parameter, the way
   `src/lib/authRules.ts` keeps its rules pure. Exactly one file in the data layer,
   `backend.ts`, imports `src/lib/supabase.ts`. A test enforces this
   ([Purity enforcement](#purity-enforcement)).
8. **No new client, no service role.** Backends use only the anon-key client that
   `src/lib/supabase.ts` already creates, and reach data only through RLS-protected
   tables and `security definer` RPCs granted to `authenticated`. No file under
   `src/lib/data/` calls `createClient`.

## Module layout

```
apps/mobile/src/lib/data/
  index.ts              barrel of the public API; append-only (zone: Data-layer index)
  types.ts              shared types; append-only (zone: Data-layer index)
  mode.ts               pure: dataMode(status), dataScope(mode, userId)
  errors.ts             pure: DataError, toDataError(), user-facing copy
  store.ts              pure: the query store (cache, dedupe, invalidation, scope)
  mockUtil.ts           pure: findById (null for unknown ids), mock factory helpers
  hooks.ts              binding: useQuery / useMutation over the store (imports react only)
  backend.ts            binding: the ONLY file that imports ../supabase and ../../state/auth
  testing/
    fakeSupabase.ts     pure test helper: recording fake of the supabase-js client
    contract.ts         pure test helper: run one case list against both backends
  purity.test.ts        enforces the purity rule over this directory
  mode.test.ts, errors.test.ts, store.test.ts, mockUtil.test.ts

  profile.ts            binding: the sample feature's public entry (hooks + api hook)
  profile.api.ts        pure: domain types, ProfileApi interface, query keys
  profile.map.ts        pure: row -> UI mapping
  profile.mock.ts       pure: createProfileMock(seed?)
  profile.supabase.ts   pure: createProfileSupabase(client, userId)
  profile.test.ts       contract tests (both backends), mapper and not-found tests
```

**Two kinds of file.** *Pure* files are everything except the binding files; they
load under Node and are what `npm test` covers. *Binding* files (`hooks.ts`,
`backend.ts` and each feature entry `<feature>.ts`) wire pure code to React, the auth
state and the real client. They hold no logic worth testing: if a binding file grows
a branch, that branch moves into a pure file.

**Per-feature files.** A wiring task adds, for feature `x`:

| File | Kind | Holds |
| --- | --- | --- |
| `x.ts` | binding | the public entry: `useX…()` query hooks, `useXActions()` mutations, `useXApi()`, and type re-exports. This is the file the backlog names. |
| `x.api.ts` | pure | UI-facing domain types, the `XApi` interface, `xKeys` query-key builders |
| `x.map.ts` | pure | row ↔ UI mappers (M-34's "pure mapper module beside it") |
| `x.mock.ts` | pure | `createXMock(seed?)`: in-memory, may import read-only from `src/data/mock.ts` or the feature's own mock file (e.g. `src/data/mockTrips.ts`) |
| `x.supabase.ts` | pure | `createXSupabase(client, userId)`; imports `@supabase/supabase-js` and `database.types` with `import type` only |
| `x.test.ts` | test | contract cases for both backends, mapper tests |

Sibling files (`x.*.ts`) belong to the same conflict-zone row as their entry `x.ts`
(for example `rides.*.ts` follows M-43 → M-47), see owner question 5.

**Shared, append-only files** (the backlog's "Data-layer index" zone; keep both sides
on a rebase conflict):

- `index.ts`: one `export * from './x';` line per feature entry, appended at the end.
  Export names must be unique across features (prefix them with the feature, e.g.
  `useBlockedIds`, `useInboxRequests`). A duplicate is a TS2308 error at typecheck,
  so a collision can't merge silently. Tests never import `index.ts`, because it
  pulls in the binding files.
- `types.ts`: the core types below, plus domain types that more than one feature
  shares (for example a public person card used by matches, inbox and rides),
  appended by the first task that needs them.

## Typed API shape

### Core types (`types.ts`)

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables, TablesInsert, TablesUpdate } from '../database.types';

export type DataMode = 'mock' | 'supabase' | 'off';
export type TypedClient = SupabaseClient<Database>;

type PublicSchema = Database['public'];
export type TableName = keyof PublicSchema['Tables'];
export type Row<T extends TableName> = Tables<T>;
export type InsertRow<T extends TableName> = TablesInsert<T>;
export type UpdateRow<T extends TableName> = TablesUpdate<T>;
export type RpcName = keyof PublicSchema['Functions'];
export type RpcArgs<F extends RpcName> = PublicSchema['Functions'][F]['Args'];
export type RpcReturns<F extends RpcName> = PublicSchema['Functions'][F]['Returns'];

export type Result<T> = { ok: true; data: T } | { ok: false; error: DataError };

/** What a query hook reports. Screens switch on `status`. */
export type QueryState<T> =
  | { status: 'idle' }                                   // mode is 'off', or no key
  | { status: 'loading' }                                // first load, nothing cached
  | { status: 'error'; error: DataError }                // last load failed, nothing to show
  | { status: 'empty'; refreshing: boolean }             // null or [] (not found / no items)
  | { status: 'success'; data: T; refreshing: boolean }; // T excludes null here

export type Query<T> = QueryState<NonNullable<T>> & {
  refetch: () => void;
  /** Set when a refetch fails while older data is still shown. */
  lastError: DataError | null;
};
```

A refetch that fails while data is cached keeps `success` (or `empty`) with the old
value and sets `lastError`, so a pull-to-refresh failure doesn't blank the screen. Whether a value is
`empty` is decided by `isEmpty` (default: `null`, `undefined` or an empty array); a
feature can pass its own.

Row and RPC types are always derived from the generated `Database` with these
aliases, never written by hand. Geography columns are typed `unknown` by the
generator; mappers never pass them to UI types.

### A feature, end to end (the sample)

`profile.api.ts` (pure):

```ts
export type ProfileSummary = {
  id: string;
  displayName: string;
  role: 'driver' | 'passenger' | 'both';
  ridePrefs: string[];
  discoveryOptIn: boolean;
};

export interface ProfileApi {
  /** The signed-in member's own profile. null if it doesn't exist yet. */
  getMyProfile(): Promise<Result<ProfileSummary | null>>;
  /** null for an unknown id, and for any row RLS hides (everyone else's, in 0002). */
  getProfile(id: string): Promise<Result<ProfileSummary | null>>;
}

export const profileKeys = {
  all: 'profile',
  me: 'profile:me',
  byId: (id: string) => `profile:id:${id}`,
};
```

`profile.supabase.ts` (pure; client injected):

```ts
import type { ProfileApi } from './profile.api';
import type { TypedClient } from './types';
import { toProfileSummary } from './profile.map';
import { toDataError } from './errors';

const COLUMNS = 'id, display_name, role, ride_prefs, discovery_opt_in';

export function createProfileSupabase(client: TypedClient, userId: string) {
  const byId = async (id: string) => {
    const { data, error, status } = await client.from('profiles').select(COLUMNS).eq('id', id).maybeSingle();
    if (error) return { ok: false, error: toDataError({ ...error, status }) } as const;
    return { ok: true, data: data ? toProfileSummary(data) : null } as const;
  };
  return { getMyProfile: () => byId(userId), getProfile: byId } satisfies ProfileApi;
}
```

Rules shown here: explicit column lists (never `select('*')`), so supabase-js types
the result from the literal and a privacy review sees exactly what's read;
`maybeSingle()` for by-id reads, so "no row" is `null`, not error `PGRST116`; errors go
through `toDataError`.

`profile.mock.ts` (pure): `createProfileMock(seed = DEFAULT_PROFILES)` keeps a `Map`
of profiles and a `meId`, and uses `findById` from `mockUtil.ts`, which returns `null`
for an unknown id. A fresh instance per call, so tests never share state.

`profile.ts` (binding, the public entry):

```ts
import { defineBackends, useBackendApi, useDataQuery } from './backend';
import { createProfileMock } from './profile.mock';
import { createProfileSupabase } from './profile.supabase';
import { profileKeys } from './profile.api';

const backends = defineBackends({ mock: createProfileMock(), supabase: createProfileSupabase });

export function useMyProfile() {
  return useDataQuery(backends, profileKeys.me, (api) => api.getMyProfile());
}
export function useProfile(id: string | null) {
  return useDataQuery(backends, id ? profileKeys.byId(id) : null, (api) => api.getProfile(id!));
}
/** For event handlers that need a one-off call. null while the data mode is 'off'. */
export const useProfileApi = () => useBackendApi(backends);
export type { ProfileSummary } from './profile.api';
```

The sample is read-only on purpose: name and role edits stay with `saveProfile` in
`state/auth.tsx` (M-30), and preference and discovery writes belong to M-34's
`commute.ts`. The mutation pattern is shown in the next section and exercised in the
store tests. See owner question 3 on the choice of sample.

### Mutations

```ts
export function useBlockActions() {                       // illustrative, M-24 owns it
  return useDataMutation(backends, {
    block: (api, id: string) => api.block(id),
    unblock: (api, id: string) => api.unblock(id),
  }, { invalidate: 'all' });                              // or a prefix such as safetyKeys.all
}
// const { block, pending } = useBlockActions();  const r = await block(id);  if (!r.ok) show(r.error.message)
```

- Each action resolves to a `Result`, and the hook exposes `pending` and `lastError`.
  While an action is pending, calling it again resolves to the same promise, so a
  double tap on "Send request" sends once.
- On success the mutation invalidates its own feature's key prefix. A mutation that
  changes what other features show (block, report, cancel) invalidates everything
  (`'all'`): at pilot scale a few extra reads are cheaper than a missed refresh.
- No optimistic updates in v1. The mock answers instantly anyway; connected mode
  shows `pending` on the button.

## Mode selection

`mode.ts` (pure):

```ts
export function dataMode(status: AuthStatus): DataMode;           // the table in Decision 2
export function dataScope(mode: DataMode, userId: string | null): string | null;
// 'mock' -> 'mock'; 'supabase' + id -> `sb:${id}`; otherwise null
```

`backend.ts` (binding) is the only place that combines `useAuth()` and the client:

- `useDataContext()` reads `useAuth().status` and `profile?.id`, computes the mode and
  scope, and asserts the client is non-null in `supabase` mode (it always is, because
  `prototype` is exactly "no client").
- `defineBackends({ mock, supabase })` takes one long-lived mock instance (its
  in-memory state lasts the app session, and resets on reload, like today's
  prototype) and a factory `(client, userId) => Api`.
- `useBackendApi(backends)` returns the mock instance, the Supabase backend for the
  current user (memoized on `userId`) or `null` in `off` mode.
- `useDataQuery` and `useDataMutation` wrap the generic hooks in `hooks.ts` and
  prefix every key with the scope, so cache entries from different users or modes
  can never be read across.

## Error model

`errors.ts` (pure):

```ts
export type DataErrorKind =
  | 'offline' | 'auth' | 'notAllowed' | 'conflict' | 'invalid' | 'rateLimited' | 'server' | 'unknown';

export type DataError = {
  kind: DataErrorKind;
  /** Safe, user-facing copy. Never the server's raw message. */
  message: string;
  /** Postgres / PostgREST code or HTTP status, for developer logs only. */
  code?: string;
};

export function toDataError(
  input: unknown,
  overrides?: Partial<Record<DataErrorKind | `code:${string}` | `hint:${string}`, Partial<DataError>>>,
): DataError;
```

| Input | Kind | Default copy |
| --- | --- | --- |
| `TypeError` from fetch, or a message like "Network request failed" / "Failed to fetch" / "Load failed" | `offline` | "Check your connection and try again." |
| HTTP 401, `PGRST301`, `PGRST303` (JWT invalid or expired) | `auth` | "Your session ended. Sign in again." |
| `42501` (RLS / privilege), HTTP 403 | `notAllowed` | generic copy (below) |
| `23505` unique, `23503` foreign key | `conflict` | generic copy |
| `23502`, `23514`, `22P02`, `22023`, `P0001` without a known hint | `invalid` | generic copy |
| HTTP 429, or an RPC's rate-limit hint (via `overrides`) | `rateLimited` | "You've done that a lot. Try again later." |
| HTTP ≥ 500 | `server` | `SERVER_ERROR` from `authRules.ts` |
| anything else | `unknown` | "Something went wrong. Try again." |

- **Raw server messages never reach the UI.** They can carry internals or reveal
  something about another member. Features turn known cases into their own copy
  with `overrides`, keyed by kind, by Postgres code or by hint.
- **DB tasks raise stable codes.** RPCs that reject for a business reason (rate
  limit, cutoff passed, seat taken) should `raise exception ... using hint =
  '<stable_snake_case>'`, so the client maps `hint:seat_taken` without parsing English.
  This is a recommendation for the DB specs that haven't been written yet; it changes
  no merged migration.
- **`notAllowed` never reads as "they blocked you".** Features that act on another
  person show the same neutral copy for `notAllowed` as for not-found (for example
  "This ride isn't available anymore").
- **Logging.** `hooks.ts` logs `kind` and `code` with `console.warn` in development
  only, never row data, ids, names or emails. Crash reporting (M-31, D-17) can attach
  to that one call site later.

## Loading and caching

**Choice: plain hooks over a small in-house store (`store.ts`, about 150 lines),
no TanStack Query.** Reasons:

- TanStack Query needs a `QueryClientProvider` at the app root. `App()` in
  `App.tsx` is a serialized zone (M-10 → M-20 → M-31 → M-38) that M-19 isn't in,
  and M-19 may change only `src/lib/data/**`. The in-house store is a module-level
  singleton and needs no provider.
- The needs are small: about ten features, mostly "load a list or one item, show
  loading / error / empty, refetch after a mutation", plus polling for one or two.
  No pagination, no offline persistence, no infinite lists in the pilot.
- No new dependency to review, lock or keep in step with Expo SDK upgrades.
- The hook API mirrors TanStack's shape (`useQuery(key, fn)`, `refetch`,
  invalidation by key prefix), so moving later is mechanical if the needs grow
  (owner question 1 names the triggers).

**Store behavior** (all pure, all tested under Node):

- **Keys** are strings with `:` segments (`profile:id:abc`), prefixed with the scope
  (`sb:<uid>:profile:id:abc`, `mock:profile:id:abc`). Key builders live in
  `x.api.ts` and include every argument the fetch depends on (ride date, role
  filter, …).
- **Dedupe.** Several components subscribing to one key share one in-flight request.
- **Stale responses are dropped.** Each fetch gets a sequence number per key, and
  only the latest one may write (the same guard `state/auth.tsx` uses for the
  profile lookup).
- **Freshness.** A cached result is fresh for `staleMs` (default 30 s). Mounting a
  fresh key shows the cache and doesn't fetch. Mounting a stale key shows the cache
  with `refreshing: true` and refetches.
- **Invalidation.** `invalidate(prefix)` or `invalidate('all')` marks entries stale
  and refetches the ones with subscribers.
- **Scope switch clears the cache.** When the scope changes (sign-out, a different
  user, prototype ↔ connected in development), every entry outside the new scope is
  dropped, so a shared phone never shows the previous member's data.
- **Polling.** `useDataQuery(..., { pollMs })` refetches while mounted (for example
  the inbox, or messages if the M-39 spec chooses polling over Realtime).
- **Foreground refetch.** `backend.ts` registers one `AppState` listener that
  refetches stale, subscribed entries when the app returns to the foreground (owner
  question 6).
- **Push-in.** `setQueryData(key, updater)` lets a feature write into the cache, for
  example from a Realtime subscription that M-50 sets up in `messages.ts`.
- **No automatic retries.** A failed load shows `error` with a Retry button that calls
  `refetch()`. (The auth provider's own backoff for the profile lookup is unchanged.)

**Prototype mode feel.** The mock backend resolves on the next microtask with no
artificial delay, so a screen's first mount shows `loading` for one frame and later
mounts hit the cache. Screens render loading as a quiet placeholder, not a full-screen
spinner, so the frame isn't visible. `mockUtil.ts` has `MOCK_LATENCY_MS = 0`; a
developer can raise it locally to see loading states on the web build. Mock factories
also accept `{ fail?: (method: string) => DataError | null }`, used by tests to
exercise error paths. There's no in-app error toggle (owner question 7).

## Keeping mock and Supabase in sync

1. **Same interface, checked by the compiler.** Both backends `satisfies XApi`.
2. **Generated types end to end.** Supabase backends select explicit column lists from
   a client typed with the CI-generated `Database`, and mappers take `Row<'x'>` (or a
   `Pick` of it). A migration that renames or drops a column regenerates
   `database.types.ts` and breaks the mapper at typecheck.
3. **Shared contract tests.** Each `x.test.ts` declares its cases once and runs them
   against both backends with `testing/contract.ts`:

   ```ts
   runContract<ProfileApi>('profile', {
     mock: (fixture) => createProfileMock(fixture.seed),
     supabase: (fixture) => createProfileSupabase(fakeSupabase(fixture.server), ME),
   }, [
     { name: 'unknown id is null', seed: [], server: { data: null }, call: (api) => api.getProfile('nope'), expect: ok(null) },
     { name: 'own profile maps to the UI type', seed: [ME_ROW_UI], server: { data: ME_ROW }, call: (api) => api.getMyProfile(), expect: ok(ME_SUMMARY) },
     { name: 'network failure is offline', only: 'supabase', server: { throws: new TypeError('Network request failed') }, call: (api) => api.getMyProfile(), expect: err('offline') },
   ]);
   ```

   Each case gives the mock its seed and the fake client its canned server response,
   then asserts the same `Result` from both. Cases that only make sense for one
   backend (a network failure) say so.
4. **`testing/fakeSupabase.ts`** is a recording fake of the supabase-js surface the
   backends use (`from(...).select/insert/update/upsert/delete`, the filters `eq`,
   `neq`, `in`, `gte`, `lte`, `order`, `limit`, `maybeSingle`, `single`, and `rpc`).
   Every chain records its calls and resolves to the canned `{ data, error, status }`
   (or rejects with `throws`). Tests can also assert the recorded chain, for example
   that `getProfile` filters on `id` and never selects `*`. It is cast to
   `TypedClient` only inside the testing folder.
5. **What this doesn't prove,** stated plainly: the fake checks how a backend builds
   its request and maps the answer, not what Postgres returns. RLS and RPC behavior is
   proven by `supabase/tests/*_test.sql` in CI's `database` job, and the end-to-end
   path by the owner's connected-mode check in each wiring task (O-14, with M-57's
   fixtures).

## Purity enforcement

`purity.test.ts` reads every `.ts` file under `src/lib/data/` (including `testing/`)
except the binding files (`hooks.ts`, `backend.ts`, `index.ts` and any `x.ts` that has
sibling `x.api.ts`), and fails if one has a non-type import of:

- `react-native`, `react-native-*`, `expo`, `expo-*`, `@expo/*`
- `../supabase` (that is, `src/lib/supabase.ts`) or anything under `src/state/`
- `react` (the store and mappers don't need it)
- a binding file (`./backend`, `./hooks`, `./index`, or a feature entry)

`import type` lines are allowed, since `tsx` erases them. It also checks that
`backend.ts` is the only file that imports `../supabase`. The rule lives in a test
rather than ESLint because `eslint.config.js` is outside this task's files; moving it
into `no-restricted-imports` later is a possible cleanup.

## How a wiring task adds `lib/data/<feature>.ts`

1. Read this spec and the sample (`profile.*`).
2. Write `x.api.ts`: UI-facing types (only fields the screen needs; nothing a privacy
   invariant forbids before confirmation), the `XApi` interface (every method returns
   `Promise<Result<…>>`; by-id reads return `T | null`), and `xKeys`.
3. Write `x.map.ts` with row ↔ UI mappers, typed from `Row<'x'>` / `RpcReturns<'x'>`.
4. Write `x.mock.ts`, wrapping `src/data/mock.ts` or the feature's own mock file
   **read-only** and using `findById` (never `findMatch` / `findRequest`, which fall
   back to the first item). Mock writes stay in the instance's memory.
5. Write `x.supabase.ts` with the client injected; explicit columns; `maybeSingle()`
   for by-id; RPCs through `client.rpc(name, args)` typed by `RpcArgs`.
6. Write `x.test.ts`: contract cases (at least not-found, a happy path, one error
   mapping, and each mutation), plus mapper tests.
7. Write `x.ts` with `defineBackends`, the hooks and the actions; append
   `export * from './x';` to `index.ts`, and any shared domain type to `types.ts`.
8. In screens, switch on `query.status`: `idle` and `loading` render a placeholder,
   `error` shows `error.message` with Retry (`refetch`), `empty` shows the feature's
   neutral empty copy, `success` renders. "Prototype" simulator controls render only
   when `useAuth().status === 'prototype'`.
9. React state providers (`state/commute.tsx`, `state/firstRide.tsx`) keep drafts and
   UI-only state. Data the server owns in connected mode (requests, rides, blocks,
   messages) lives in the backend: its mock instance in prototype mode, Supabase
   otherwise.

## Test plan

All tests use `node:test` and `node:assert/strict` via `tsx` (the existing `npm test`
glob `src/**/*.test.ts` already picks them up) and import only pure modules.

| File | Covers |
| --- | --- |
| `mode.test.ts` | `dataMode` for all five `AuthStatus` values (only `prototype` → `mock`, only `ready` → `supabase`); `dataScope` for each mode, with and without a user id |
| `errors.test.ts` | every row of the mapping table; `overrides` by kind, code and hint; the copy never contains the raw server message |
| `store.test.ts` | dedupe of concurrent fetches; a late stale response is dropped; fresh vs stale on subscribe; `invalidate(prefix)` and `'all'` refetch only subscribed keys; scope switch drops other scopes; failed refetch keeps cached data and sets `lastError`; `isEmpty` default for `null`, `undefined`, `[]`; `setQueryData`; mutation de-duplication while pending (with an injected clock and no timers left running) |
| `mockUtil.test.ts` | `findById` returns the item, or `null` for an unknown id (never the first item); `fail` injection |
| `profile.test.ts` | the contract suite against mock and fake Supabase: unknown id → `null`, RLS-hidden row → `null`, own profile maps, offline / server errors map; the recorded query uses explicit columns and an `id` filter; `toProfileSummary` mapping |
| `purity.test.ts` | the purity rule above |

Plus `npm run typecheck`, `npm run lint`, and a web walkthrough (`npm run web`) in
prototype mode showing nothing changed (no screen imports the layer yet).

## Out of scope

- Editing any screen, `App.tsx`, `src/state/*`, `src/lib/supabase.ts`,
  `src/lib/authRules.ts` or `src/data/mock.ts`. Each wiring task moves its own screens.
- Any feature module other than the `profile` sample.
- TanStack Query or any other new dependency.
- Optimistic updates, pagination, offline persistence, background sync, automatic
  retries.
- Realtime plumbing (M-50 decides per the M-39 spec; the store's `setQueryData` is
  the hook it plugs into).
- Error reporting (M-31).
- Migrations, RPCs, generated types and hosted-project changes.

## Owner questions

1. **TanStack Query or the in-house store?** *Recommend the in-house store* for the
   pilot (no root provider is possible in this task, small needs, no dependency).
   Revisit if a later task needs pagination, offline persistence or cross-screen
   optimistic updates; the hook shape makes the switch mechanical.
2. **Data mode during `needsProfile`.** *Recommend `off`:* only `ready` uses Supabase.
   The only screen in that state is the name step, which uses `saveProfile` from
   `state/auth.tsx`, and `useAuth()` exposes the user id only through `profile`, so
   no change to the serialized auth zone is needed.
3. **Sample module.** *Recommend `profile` (read-only: own profile, plus by-id that
   returns `null` for anyone else).* It touches only an existing table with simple
   RLS and doesn't pre-empt a file another task owns (`matches.ts`, `inbox.ts`, …).
   It overlaps slightly with the profile `state/auth.tsx` already loads; later tasks
   may use it or not.
4. **One PR or spec first?** The card says spec, plan and code ship in one PR unless
   you ask to see the spec first. This branch already carries the spec for your
   review. *Recommend:* approve here, then the plan and code land on the same branch
   as one PR "M-19: Typed data layer".
5. **Sibling files share their entry's zone.** The backlog's zone table names only
   `rides.ts`, `matches.ts` and `inbox.ts`. *Recommend* you note in the backlog that
   `x.*.ts` siblings follow the same order as `x.ts` (this task doesn't edit the
   backlog).
6. **Refetch stale data when the app returns to the foreground?** *Recommend yes*,
   only for mounted queries older than 30 s; it costs one `AppState` listener and
   keeps reply-by times and the inbox current after a commute.
7. **An in-app "simulate error" toggle for prototype walkthroughs?** *Recommend no*:
   error paths are covered by tests through the mock's `fail` option, and a hidden
   toggle is one more thing to strip before release (M-25).
8. **Stable RPC error hints.** *Recommend* the DB specs still to be written (M-27,
   M-32, M-39, M-55a) raise business-rule rejections with a stable `hint` so the app
   can map them. This is advice for those tasks; mark it on their rows if you agree.

No owner decision (D-NN) gates this task.
