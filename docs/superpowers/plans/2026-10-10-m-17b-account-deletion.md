# M-17b · Account deletion: Edge Function, CI Deno checks, in-app entry — plan

**Branch:** `feat/m-17b-account-deletion`
**Builds on:** `docs/superpowers/specs/2026-10-08-account-deletion-design.md` (M-17a, D-15 decided),
`supabase/migrations/0010_account_deletion.sql`, `0011_member_status.sql`.
**No migration.** The function reaches `auth.audit_log_entries` over the injected
`SUPABASE_DB_URL`, so 0016 stays unused.

## Goal

A signed-in member can delete their account from the app. The `delete-account` Edge
Function verifies the caller's JWT, deletes that `auth.users` row with the service role
(the database's deletion policy does the rest), and purges the person's
`auth.audit_log_entries`. CI type-checks and tests Deno code under `supabase/functions`.

## Tasks

### 1. Edge Function logic (pure, TDD) — `supabase/functions/delete-account/handler.ts`

No Deno globals, network or database access. `index.ts` injects them.

- `bearerToken(header)`: the token from `Authorization: Bearer <token>`, or null.
- `handleDeleteAccount(req, deps)`:
  - `OPTIONS` → 200 with CORS headers (the Expo web build calls cross-origin).
  - Not `POST` → 405.
  - No bearer token → 401. Auth rejects the token → 401. The token's user no longer exists
    (`user_not_found`, e.g. a retry after a lost response) → 200 `{ deleted: true }`.
  - Auth unreachable → 502. Admin delete fails → 500. Nothing is purged then.
  - After the delete, purge the audit log (10 s timeout). A failed purge still returns 200
    (`auditLogPurged: false`) and logs without identifiers; the spec has the owner's fallback.
- `fetchAuthUser(fetch, url, anonKey, token)`: `GET /auth/v1/user`. 200 → user,
  403 `user_not_found` → not found, other 401/403 → invalid, else throw.
- `deleteAuthUser(fetch, url, serviceRoleKey, id)`: `DELETE /auth/v1/admin/users/{id}`
  (what `auth.admin.deleteUser` calls); 404 counts as done, other errors throw.
- `PURGE_AUDIT_LOG_SQL` + `purgeAuditLogParams(user)`: delete entries whose actor or
  trait user is the person, by id, or by email (lowercased) when known.

Tests: `handler_test.ts` beside it, with fake deps and a fake `fetch`.

### 2. Edge Function entry — `supabase/functions/delete-account/index.ts`

`Deno.serve` wiring: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_DB_URL` from `Deno.env` (all injected by Supabase). Postgres via
`jsr:@db/postgres` (pinned), one connection per purge.

### 3. Config and CI

- Append `[functions.delete-account]` with `verify_jwt = true` to the end of
  `supabase/config.toml`.
- New `deno` job in `.github/workflows/checks.yml` (`denoland/setup-deno`, Deno 2.x):
  `deno check` on `supabase/functions/**/*.ts`, `deno test --permit-no-files supabase/functions`.
  Both use `--no-lock`; the repo has no Deno config or lockfile.

### 4. App (TDD for the pure parts)

- `src/lib/authRules.ts`: `functionErrorInfo(error)` (supabase-js `FunctionsError` → kind
  and HTTP status) and `deleteAccountErrorMessage(info)`; messages
  `DELETE_ACCOUNT_ERROR`, `DELETE_ACCOUNT_SESSION_ERROR`, `DELETED_SIGN_OUT_ERROR`.
  Tests in `authRules.test.ts`.
- `src/state/auth.tsx`: `deleteAccount()` → `supabase.functions.invoke('delete-account')`,
  then `auth.signOut({ scope: 'local' })`; the Router then returns to Welcome. Resolves to
  an error message or null, like the other actions. Sign-out's pending/error handling is
  unchanged.
- `src/components/DeleteAccountConfirm.tsx` (new, reusable by the Profile screen): what's
  deleted and what's kept (from the spec), "Delete account" and "Cancel", pending and error
  states. Renders nothing in prototype mode.
- `src/components/AccountSheet.tsx`: a "Delete account" item, shown only outside prototype
  mode, swaps the sheet's content for `DeleteAccountConfirm` (no nested modal).

### 5. Verify

`npm run typecheck`, `npm test`, `npm run lint`; Deno check/test locally and in CI; web
build in prototype mode (the item is hidden). Connected-mode deletion waits for O-09.

## Spec note

The deletion spec's "Out of scope" bullet on `auth.audit_log_entries` is updated to say how
the function purges it and the owner's fallback SQL if the purge fails.
