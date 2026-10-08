# Supabase Connection and Email Sign-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the Merge mobile app to the hosted Supabase project and let people sign in with a 6-digit email code and create their profile, while the app still runs as a click-through prototype when Supabase isn't configured.

**Architecture:** A new migration adds owner-only RLS to `profiles`, verified by plain-SQL tests that run in a throwaway PostGIS container with a minimal Supabase auth shim. In the app, an `AuthProvider` wraps everything and exposes one `status` (`loading | signedOut | needsProfile | ready | prototype`). Pure decision logic lives in `lib/authRules.ts` with unit tests. Three new screens (Sign in, Enter code, Your name) plug into the existing minimal stack navigator.

**Tech Stack:** Expo SDK 54, React Native 0.81, TypeScript 5.9 (strict), `@supabase/supabase-js` 2.x, Supabase CLI (npm dev dependency), PostgreSQL 17 + PostGIS 3.5 (Docker, tests only), Node 22 `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-08-supabase-auth-design.md`

## Global Constraints

- Hosted project ref: `aeycmdjoplppvizvwhgs`.
- Never put a service-role key in the app or the repo. The app uses only `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` from `apps/mobile/.env` (gitignored).
- Nothing is installed globally. The Supabase CLI is a root dev dependency, run via `npx supabase` or the `db:*` scripts.
- `supabase login`, `supabase link` (database password), editing `apps/mobile/.env`, and Supabase dashboard settings are done by the project owner. Agents never type credentials.
- `db:push` against the hosted database runs only after the owner approves the exact pending-migration list.
- Migrations are applied only through `supabase db push`, never through the Supabase MCP. `supabase/migrations/` is the source of truth.
- With no Supabase URL or anon key, the app must behave exactly like today's prototype (no sign-in).
- All colors, spacing, radii and type come from `apps/mobile/src/theme.ts`. Never hard-code hexes in screens.
- Copy strings are exact:
  - "We'll email you a 6-digit code. No password needed."
  - "What should riders call you?"
  - "First name and last initial, like Priya S."
  - "Enter a valid email address."
  - "Too many codes requested. Try again in a few minutes."
  - "Couldn't send the code. Check your connection and try again."
  - "That code didn't work. Check it or request a new one."
  - "Couldn't save your name. Check your connection and try again."
  - "Enter at least 2 characters."
  - "Use 40 characters or fewer."
- Display names are 2–40 characters after trimming (enforced by the client and by a DB check).
- Code expiry: 600 seconds. Resend unlocks after 60 seconds. Codes are 6 digits.
- Do not commit `package-lock.json` (the repo has none) or `.claude/launch.json`. Stage files explicitly by path.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| Path | Status | Responsibility |
| --- | --- | --- |
| `scripts/db-test.sh` | Create | Spin up a throwaway PostGIS container, apply shim + migrations, run `supabase/tests/*_test.sql` |
| `scripts/db-test/auth-shim.sql` | Create | Test-only stand-in for Supabase's `auth` schema, roles, grants, and test helpers |
| `supabase/tests/profiles_test.sql` | Create | Profile RLS and display-name assertions |
| `supabase/migrations/0002_profiles_rls.sql` | Create | Owner-only RLS policies and display-name check on `profiles` |
| `supabase/config.toml`, `supabase/.gitignore` | Create (`supabase init`) | CLI project config (local auth settings) |
| `package.json` | Modify | `supabase` dev dependency and `db:*`, `test`, `web` scripts |
| `.github/workflows/checks.yml` | Modify | Run unit tests and DB tests in CI |
| `apps/mobile/src/lib/database.types.ts` | Create (generated) | Typed schema for `createClient<Database>` |
| `apps/mobile/src/lib/supabase.ts` | Modify | Typed client and foreground-only token refresh |
| `apps/mobile/src/lib/authRules.ts` | Create | Pure rules: validation, error copy, status derivation, routing decisions |
| `apps/mobile/src/lib/authRules.test.ts` | Create | Unit tests for `authRules.ts` |
| `apps/mobile/package.json` | Modify | `tsx`, `@types/node`, web deps; `test`, `web` scripts |
| `apps/mobile/src/state/auth.tsx` | Create | `AuthProvider` and `useAuth()` |
| `apps/mobile/src/components/TextField.tsx` | Create | Labeled text input with hint/error |
| `apps/mobile/src/components/Screen.tsx` | Modify | Keep the pinned footer above the iOS keyboard |
| `apps/mobile/src/components/AccountSheet.tsx` | Create | Signed-in email and Sign out |
| `apps/mobile/src/screens/SignInScreen.tsx` | Create | Email entry |
| `apps/mobile/src/screens/VerifyCodeScreen.tsx` | Create | Code entry, resend, change email |
| `apps/mobile/src/screens/ProfileNameScreen.tsx` | Create | Display name, saves the profile |
| `apps/mobile/src/screens/LoadingScreen.tsx` | Create | Branded launch loading state |
| `apps/mobile/src/navigation.tsx` | Modify | New routes |
| `apps/mobile/App.tsx` | Modify | Providers, launch gate, signed-out redirect, new route cases |
| `apps/mobile/src/screens/WelcomeScreen.tsx` | Modify | Continue goes to the right next step |
| `apps/mobile/src/screens/DiscoverScreen.tsx` | Modify | Account button and sheet |
| `README.md`, `docs/ui.md`, `docs/mvp.md` | Modify | Setup steps, flows, pilot blockers |

---

### Task 1: Database test harness and profile RLS

**Files:**
- Create: `scripts/db-test.sh`
- Create: `scripts/db-test/auth-shim.sql`
- Create: `supabase/tests/profiles_test.sql`
- Create: `supabase/migrations/0002_profiles_rls.sql`
- Modify: `package.json` (add `db:test` script)
- Modify: `.github/workflows/checks.yml`

**Interfaces:**
- Consumes: `supabase/migrations/0001_initial.sql` (existing `public.profiles` with RLS enabled, no policies).
- Produces: `npm run db:test`, which exits 0 only when every `supabase/tests/*_test.sql` passes. Test helpers `tests.as_user(uuid)`, `tests.as_anon()`, `tests.as_admin()` for later test files (First Ride reuses them).

**Prerequisite:** Docker Desktop is running (`docker info` succeeds). If it isn't, ask the owner to start it.

- [ ] **Step 1: Write the auth shim**

Create `scripts/db-test/auth-shim.sql`:

```sql
-- Test-only stand-in for the parts of Supabase that our migrations and tests
-- rely on. Never apply this to a real database.

create schema extensions;
create schema auth;

-- Supabase puts extensions (PostGIS) on the default search path.
alter database postgres set search_path = "$user", public, extensions;

create table auth.users (
  id uuid primary key,
  email text
);

create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create role anon nologin;
create role authenticated nologin;

grant usage on schema public, auth, extensions to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

-- Supabase grants table access to API roles by default; RLS is what restricts it.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

-- Helpers for switching identity inside a test transaction.
create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.as_user(uid uuid) returns void
language plpgsql
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
end
$$;

create function tests.as_anon() returns void
language plpgsql
as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$$;

create function tests.as_admin() returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$$;

grant execute on all functions in schema tests to anon, authenticated;
```

- [ ] **Step 2: Write the runner**

Create `scripts/db-test.sh`:

```bash
#!/usr/bin/env bash
# Applies supabase/migrations to a throwaway PostGIS container with a minimal
# Supabase auth shim, then runs every supabase/tests/*_test.sql. Needs Docker.
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE=postgis/postgis:17-3.5
NAME="merge-db-test-$$"

docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

# TCP only answers once the image's init scripts finish and the real server starts.
until docker exec "$NAME" pg_isready -h 127.0.0.1 -U postgres -q; do sleep 1; done

run_sql() {
  docker exec -i -e PGPASSWORD=postgres "$NAME" \
    psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X
}

run_sql < scripts/db-test/auth-shim.sql
for f in supabase/migrations/*.sql; do
  echo "migrate $(basename "$f")"
  run_sql < "$f"
done

status=0
for f in supabase/tests/*_test.sql; do
  if run_sql < "$f"; then
    echo "PASS $(basename "$f")"
  else
    echo "FAIL $(basename "$f")"
    status=1
  fi
done
exit "$status"
```

Run: `chmod +x scripts/db-test.sh`

Add to the root `package.json` `scripts`:

```json
"db:test": "scripts/db-test.sh"
```

- [ ] **Step 3: Write the failing profile test**

Create `supabase/tests/profiles_test.sql`:

```sql
-- Profiles: each signed-in person can read, create and edit only their own row.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ada@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'bea@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'cal@example.test');

insert into public.profiles (id, display_name, role)
values ('00000000-0000-0000-0000-00000000000b', 'Bea B.', 'driver');

-- 1. A user can create, read, and update their own profile.
select tests.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.profiles (id, display_name, role)
values ('00000000-0000-0000-0000-00000000000a', 'Ada A.', 'passenger');

do $$
begin
  if (select count(*) from public.profiles) <> 1 then
    raise exception 'Ada should see exactly one profile (her own)';
  end if;
  update public.profiles set display_name = 'Ada L.' where id = auth.uid();
  if (select display_name from public.profiles where id = auth.uid()) <> 'Ada L.' then
    raise exception 'Ada should be able to update her own profile';
  end if;
end
$$;

-- 2. A user cannot read, update, or delete another user's profile.
do $$
declare
  n integer;
begin
  if exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-00000000000b') then
    raise exception 'Ada can read Bea''s profile';
  end if;
  update public.profiles set display_name = 'Hacked' where id = '00000000-0000-0000-0000-00000000000b';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'Ada updated Bea''s profile';
  end if;
  delete from public.profiles where id = auth.uid();
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'Profiles must not be deletable from the client';
  end if;
end
$$;

-- 3. A user cannot create a profile for someone else.
do $$
begin
  begin
    insert into public.profiles (id, display_name)
    values ('00000000-0000-0000-0000-00000000000c', 'Cal C.');
  exception when insufficient_privilege then
    return;
  end;
  raise exception 'Ada created a profile for Cal';
end
$$;

-- 4. Anonymous visitors cannot read any profile.
select tests.as_anon();
do $$
begin
  if (select count(*) from public.profiles) <> 0 then
    raise exception 'anon can read profiles';
  end if;
end
$$;

-- 5. Display names must be 2–40 characters after trimming.
select tests.as_admin();
do $$
begin
  begin
    insert into public.profiles (id, display_name)
    values ('00000000-0000-0000-0000-00000000000c', '  C  ');
  exception when check_violation then
    begin
      insert into public.profiles (id, display_name)
      values ('00000000-0000-0000-0000-00000000000c', repeat('x', 41));
    exception when check_violation then
      return;
    end;
    raise exception 'A 41-character display name was accepted';
  end;
  raise exception 'A 1-character display name was accepted';
end
$$;

rollback;
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm run db:test`
Expected: `migrate 0001_initial.sql`, then psql reports `ERROR:  new row violates row-level security policy for table "profiles"`, then `FAIL profiles_test.sql`, exit code 1.

- [ ] **Step 5: Write the migration**

Create `supabase/migrations/0002_profiles_rls.sql`:

```sql
-- Profiles: each signed-in person can read, create and edit only their own row.
-- Deletion happens through auth.users (on delete cascade), never from the client.

alter table public.profiles
  add constraint profiles_display_name_length
  check (char_length(btrim(display_name)) between 2 and 40);

create policy "Read own profile"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

create policy "Create own profile"
  on public.profiles for insert
  to authenticated
  with check (id = (select auth.uid()));

create policy "Update own profile"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run db:test`
Expected: `migrate 0001_initial.sql`, `migrate 0002_profiles_rls.sql`, `PASS profiles_test.sql`, exit code 0.

- [ ] **Step 7: Run DB tests in CI**

Replace `.github/workflows/checks.yml` with:

```yaml
name: Checks
on:
  push:
  pull_request:
jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm install
      - run: npm run typecheck
  database:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: scripts/db-test.sh
```

- [ ] **Step 8: Commit**

```bash
git add scripts/db-test.sh scripts/db-test/auth-shim.sql supabase/tests/profiles_test.sql supabase/migrations/0002_profiles_rls.sql package.json .github/workflows/checks.yml
git commit -m "feat(db): add owner-only RLS for profiles with a Docker test harness

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Supabase CLI, hosted push, and generated types (owner checkpoint)

**Files:**
- Modify: `package.json` (dev dependency + scripts)
- Create: `supabase/config.toml`, `supabase/.gitignore` (via `supabase init`)
- Create: `apps/mobile/src/lib/database.types.ts` (generated)

**Interfaces:**
- Consumes: migrations `0001_initial.sql`, `0002_profiles_rls.sql` from Task 1.
- Produces: `apps/mobile/src/lib/database.types.ts` exporting `type Database` with `Database['public']['Tables']['profiles']['Row']` = `{ id: string; display_name: string; role: string; discovery_opt_in: boolean; created_at: string }`.

- [ ] **Step 1: Add the CLI and scripts**

Run: `npm install --save-dev supabase@^2.120.0` (from the repo root)

Add to the root `package.json` `scripts` (keep the existing ones and `db:test`):

```json
"db:link": "supabase link --project-ref aeycmdjoplppvizvwhgs",
"db:push": "supabase db push",
"db:types": "supabase gen types typescript --linked --schema public > apps/mobile/src/lib/database.types.ts"
```

Run: `npx supabase --version`
Expected: `2.120.0` or a later 2.x.

- [ ] **Step 2: Initialize CLI config**

Run: `printf 'n\nn\n' | npx supabase init`
Expected: `Finished supabase init.` and new files `supabase/config.toml` and `supabase/.gitignore`. Existing `supabase/migrations/` is untouched.

In `supabase/config.toml`, set:
- `project_id = "merge"` (`init` names it after the directory, which is the worktree name)
- In the `[auth.email]` section: `enable_confirmations = true` and `otp_expiry = 600`

These only affect a local Supabase stack. The hosted project is configured in the dashboard (Step 6).

- [ ] **Step 3: Owner logs in and links (STOP: ask the owner)**

Ask the owner to run these in their own terminal from the repo root, then confirm when done:

```bash
npx supabase login
```

```bash
npm run db:link
```

`db:link` prompts for the project's database password. Do not run these yourself.

- [ ] **Step 4: Show pending migrations and get approval (STOP: ask the owner)**

Run: `npx supabase migration list`
Expected: a table with `0001` and `0002` under Local. Remote is empty unless migrations were applied before. If the CLI says it is skipping a file because of its name, stop and report it to the owner instead of renaming files.

Run: `npx supabase db push --dry-run`
Expected: `Would push these migrations:` followed by `• 0001_initial.sql` and `• 0002_profiles_rls.sql` (or only those not yet on Remote).

Show the owner the exact list and ask: "Push these migrations to the hosted project `aeycmdjoplppvizvwhgs`?" Wait for an explicit yes.

- [ ] **Step 5: Push and generate types**

Run: `npm run db:push -- --yes`
Expected: `Applying migration 0001_initial.sql...`, `Applying migration 0002_profiles_rls.sql...`, `Finished supabase db push.`

Run: `npm run db:types`
Expected: `apps/mobile/src/lib/database.types.ts` exists and contains `export type Database` and a `profiles` table with `display_name: string`.

- [ ] **Step 6: Owner configures the dashboard (STOP: ask the owner)**

Ask the owner to set these in the Supabase dashboard for `aeycmdjoplppvizvwhgs`, then confirm:
1. Authentication → Providers → Email: enabled, "Confirm email" on.
2. Authentication → Providers → Email → Email OTP Expiration: `600` seconds. Email OTP Length: `6`.
3. Authentication → Email Templates → Magic Link: the message body includes `{{ .Token }}` (for example, `<p>Your Merge code is {{ .Token }}</p>`), so the email carries a 6-digit code.
4. Copy Project Settings → API → Project URL and the `anon` public key into `apps/mobile/.env` as `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

- [ ] **Step 7: Check the hosted schema**

If the read-only Supabase MCP tools are available in this session, call `list_tables` (schema `public`) and `get_advisors` (type `security`).
Expected: tables `profiles`, `vehicles`, `commutes`, `invitations`, all with RLS enabled, and no "RLS Disabled in Public" findings. ("RLS Enabled No Policy" on `vehicles`, `commutes`, `invitations` is expected, because they are deliberately default-deny.)

If the MCP tools are not available, ask the owner to open Dashboard → Advisors → Security Advisor and report what it shows.

- [ ] **Step 8: Commit**

```bash
git add package.json supabase/config.toml supabase/.gitignore apps/mobile/src/lib/database.types.ts
git commit -m "chore(db): add Supabase CLI config, link scripts, and generated types

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Auth rules with unit tests

**Files:**
- Create: `apps/mobile/src/lib/authRules.ts`
- Test: `apps/mobile/src/lib/authRules.test.ts`
- Modify: `apps/mobile/package.json` (dev deps, `test` script)
- Modify: `package.json` (root `test` script)
- Modify: `.github/workflows/checks.yml` (run `npm test`)

**Interfaces:**
- Consumes: nothing (pure TypeScript, no React Native imports, so it runs under Node).
- Produces, all exported from `apps/mobile/src/lib/authRules.ts`:
  - `CODE_LENGTH = 6`, `RESEND_AFTER_SECONDS = 60`
  - `VERIFY_CODE_ERROR: string`, `SAVE_PROFILE_ERROR: string`, `INVALID_EMAIL_ERROR: string`
  - `normalizeEmail(raw: string): string`
  - `isValidEmail(raw: string): boolean`
  - `normalizeDisplayName(raw: string): string`
  - `displayNameError(raw: string): string | null`
  - `digitsOnly(raw: string): string`
  - `isCompleteCode(raw: string): boolean`
  - `sendCodeErrorMessage(error: { status?: number }): string`
  - `type AuthStatus = 'loading' | 'signedOut' | 'needsProfile' | 'ready' | 'prototype'`
  - `deriveStatus(input: { configured: boolean; sessionLoaded: boolean; hasSession: boolean; profileLoaded: boolean; hasProfile: boolean }): AuthStatus`
  - `launchRoute(status: Exclude<AuthStatus, 'loading'>): 'welcome' | 'discover'`
  - `welcomeNext(status: AuthStatus): 'signIn' | 'profileName' | 'commute'`
  - `mustLeaveRoute(status: AuthStatus, routeName: string): boolean`

- [ ] **Step 1: Add the test runner**

From the repo root:

```bash
npm install --workspace apps/mobile --save-dev tsx@^4.23.15 @types/node@^22
```

In `apps/mobile/package.json` `scripts`, add:

```json
"test": "tsx --test 'src/**/*.test.ts'"
```

In the root `package.json` `scripts`, add:

```json
"test": "npm --workspace apps/mobile run test"
```

In `.github/workflows/checks.yml`, in the `typecheck` job, add after `- run: npm run typecheck`:

```yaml
      - run: npm test
```

- [ ] **Step 2: Write the failing tests**

Create `apps/mobile/src/lib/authRules.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveStatus,
  digitsOnly,
  displayNameError,
  isCompleteCode,
  isValidEmail,
  launchRoute,
  mustLeaveRoute,
  normalizeDisplayName,
  normalizeEmail,
  sendCodeErrorMessage,
  welcomeNext,
} from './authRules';

test('normalizeEmail trims and lowercases', () => {
  assert.equal(normalizeEmail('  Priya@Example.COM '), 'priya@example.com');
});

test('isValidEmail accepts ordinary addresses and rejects malformed ones', () => {
  assert.equal(isValidEmail(' priya@example.com '), true);
  assert.equal(isValidEmail('priya.s+merge@work.example.co'), true);
  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail('priya'), false);
  assert.equal(isValidEmail('priya@example'), false);
  assert.equal(isValidEmail('priya s@example.com'), false);
});

test('normalizeDisplayName trims and collapses inner spaces', () => {
  assert.equal(normalizeDisplayName('  Priya    S. '), 'Priya S.');
});

test('displayNameError enforces 2 to 40 characters after normalizing', () => {
  assert.equal(displayNameError(''), 'Enter at least 2 characters.');
  assert.equal(displayNameError('  P  '), 'Enter at least 2 characters.');
  assert.equal(displayNameError('Po'), null);
  assert.equal(displayNameError('Priya S.'), null);
  assert.equal(displayNameError('x'.repeat(40)), null);
  assert.equal(displayNameError('x'.repeat(41)), 'Use 40 characters or fewer.');
});

test('digitsOnly strips non-digits and caps at 6', () => {
  assert.equal(digitsOnly('12 34-56'), '123456');
  assert.equal(digitsOnly('1234567'), '123456');
  assert.equal(digitsOnly('abc'), '');
});

test('isCompleteCode requires exactly 6 digits', () => {
  assert.equal(isCompleteCode('123456'), true);
  assert.equal(isCompleteCode('12345'), false);
  assert.equal(isCompleteCode('12345a'), false);
});

test('sendCodeErrorMessage distinguishes rate limits from other failures', () => {
  assert.equal(sendCodeErrorMessage({ status: 429 }), 'Too many codes requested. Try again in a few minutes.');
  assert.equal(sendCodeErrorMessage({ status: 500 }), "Couldn't send the code. Check your connection and try again.");
  assert.equal(sendCodeErrorMessage({}), "Couldn't send the code. Check your connection and try again.");
});

test('deriveStatus', () => {
  const base = { configured: true, sessionLoaded: true, hasSession: true, profileLoaded: true, hasProfile: true };
  assert.equal(deriveStatus({ ...base, configured: false, sessionLoaded: false }), 'prototype');
  assert.equal(deriveStatus({ ...base, sessionLoaded: false }), 'loading');
  assert.equal(deriveStatus({ ...base, hasSession: false, profileLoaded: false, hasProfile: false }), 'signedOut');
  assert.equal(deriveStatus({ ...base, profileLoaded: false, hasProfile: false }), 'loading');
  assert.equal(deriveStatus({ ...base, hasProfile: false }), 'needsProfile');
  assert.equal(deriveStatus(base), 'ready');
});

test('launchRoute sends only ready users past Welcome', () => {
  assert.equal(launchRoute('ready'), 'discover');
  assert.equal(launchRoute('needsProfile'), 'welcome');
  assert.equal(launchRoute('signedOut'), 'welcome');
  assert.equal(launchRoute('prototype'), 'welcome');
});

test('welcomeNext picks the next onboarding step', () => {
  assert.equal(welcomeNext('signedOut'), 'signIn');
  assert.equal(welcomeNext('needsProfile'), 'profileName');
  assert.equal(welcomeNext('ready'), 'commute');
  assert.equal(welcomeNext('prototype'), 'commute');
});

test('mustLeaveRoute only moves signed-out people off signed-in screens', () => {
  assert.equal(mustLeaveRoute('signedOut', 'discover'), true);
  assert.equal(mustLeaveRoute('signedOut', 'commute'), true);
  assert.equal(mustLeaveRoute('signedOut', 'welcome'), false);
  assert.equal(mustLeaveRoute('signedOut', 'signIn'), false);
  assert.equal(mustLeaveRoute('signedOut', 'verifyCode'), false);
  assert.equal(mustLeaveRoute('ready', 'discover'), false);
  assert.equal(mustLeaveRoute('prototype', 'discover'), false);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL, because `Cannot find module './authRules'` (or `ERR_MODULE_NOT_FOUND`).

- [ ] **Step 4: Implement the rules**

Create `apps/mobile/src/lib/authRules.ts`:

```ts
// Pure sign-in rules shared by the auth provider and screens. No React Native
// imports here, so `npm test` can run this file under Node.

export const CODE_LENGTH = 6;
export const RESEND_AFTER_SECONDS = 60;

export const INVALID_EMAIL_ERROR = 'Enter a valid email address.';
export const VERIFY_CODE_ERROR = "That code didn't work. Check it or request a new one.";
export const SAVE_PROFILE_ERROR = "Couldn't save your name. Check your connection and try again.";

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(raw));
}

export function normalizeDisplayName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** Mirrors the `profiles_display_name_length` check in 0002_profiles_rls.sql. */
export function displayNameError(raw: string): string | null {
  const name = normalizeDisplayName(raw);
  if (name.length < 2) return 'Enter at least 2 characters.';
  if (name.length > 40) return 'Use 40 characters or fewer.';
  return null;
}

export function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, CODE_LENGTH);
}

export function isCompleteCode(raw: string): boolean {
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(raw);
}

export function sendCodeErrorMessage(error: { status?: number }): string {
  if (error.status === 429) return 'Too many codes requested. Try again in a few minutes.';
  return "Couldn't send the code. Check your connection and try again.";
}

export type AuthStatus = 'loading' | 'signedOut' | 'needsProfile' | 'ready' | 'prototype';

export function deriveStatus(input: {
  configured: boolean;
  sessionLoaded: boolean;
  hasSession: boolean;
  profileLoaded: boolean;
  hasProfile: boolean;
}): AuthStatus {
  if (!input.configured) return 'prototype';
  if (!input.sessionLoaded) return 'loading';
  if (!input.hasSession) return 'signedOut';
  if (!input.profileLoaded) return 'loading';
  return input.hasProfile ? 'ready' : 'needsProfile';
}

/** First screen once the stored session and profile are known. */
export function launchRoute(status: Exclude<AuthStatus, 'loading'>): 'welcome' | 'discover' {
  return status === 'ready' ? 'discover' : 'welcome';
}

/** Where Welcome's Continue button goes. */
export function welcomeNext(status: AuthStatus): 'signIn' | 'profileName' | 'commute' {
  if (status === 'signedOut') return 'signIn';
  if (status === 'needsProfile') return 'profileName';
  return 'commute';
}

const SIGNED_OUT_ROUTES = ['welcome', 'signIn', 'verifyCode'];

/** True when someone signed out (or their session ended) on a signed-in screen. */
export function mustLeaveRoute(status: AuthStatus, routeName: string): boolean {
  return status === 'signedOut' && !SIGNED_OUT_ROUTES.includes(routeName);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: `# pass 11`, `# fail 0`.

Run: `npm run typecheck`
Expected: exits 0 with no output.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/authRules.ts apps/mobile/src/lib/authRules.test.ts apps/mobile/package.json package.json .github/workflows/checks.yml
git commit -m "feat(mobile): add pure sign-in rules with unit tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Typed client and AuthProvider

**Files:**
- Modify: `apps/mobile/src/lib/supabase.ts`
- Create: `apps/mobile/src/state/auth.tsx`

**Interfaces:**
- Consumes: `Database` from `apps/mobile/src/lib/database.types.ts` (Task 2). Everything from `apps/mobile/src/lib/authRules.ts` (Task 3). `Role` from `apps/mobile/src/state/commute.tsx`.
- Produces, from `apps/mobile/src/state/auth.tsx`:
  - `AuthProvider({ children }: { children: React.ReactNode })`
  - `useAuth(): Auth`, where
    ```ts
    type Auth = {
      status: AuthStatus;
      email: string | null;
      profile: Profile | null;
      sendCode: (email: string) => Promise<string | null>; // error message or null
      verifyCode: (email: string, code: string) => Promise<string | null>;
      saveProfile: (input: { displayName: string; role: Role }) => Promise<string | null>;
      signOut: () => Promise<void>;
    };
    ```
  - `type Profile = Database['public']['Tables']['profiles']['Row']`

- [ ] **Step 1: Type the client and refresh only in the foreground**

Replace `apps/mobile/src/lib/supabase.ts` with:

```ts
import 'react-native-url-polyfill/auto';
// Installs a SQLite-backed `localStorage` global on iOS/Android (no-op on web,
// where the browser provides one). Supabase persists the auth session there.
import 'expo-sqlite/localStorage/install';
import { AppState, Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// No client is created until environment variables are configured. Without
// one, the app runs as the click-through prototype.
export const supabase = url && anonKey
  ? createClient<Database>(url, anonKey, {
      auth: {
        storage: localStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;

// Refresh tokens only while the app is in the foreground, per Supabase's
// React Native guidance. Browsers handle this themselves.
if (supabase && Platform.OS !== 'web') {
  const client = supabase;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') client.auth.startAutoRefresh();
    else client.auth.stopAutoRefresh();
  });
}
```

- [ ] **Step 2: Write the provider**

Create `apps/mobile/src/state/auth.tsx`:

```tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import {
  AuthStatus,
  deriveStatus,
  normalizeDisplayName,
  normalizeEmail,
  SAVE_PROFILE_ERROR,
  sendCodeErrorMessage,
  VERIFY_CODE_ERROR,
} from '../lib/authRules';
import type { Role } from './commute';

export type Profile = Database['public']['Tables']['profiles']['Row'];

type Auth = {
  status: AuthStatus;
  email: string | null;
  profile: Profile | null;
  /** Each action resolves to an error message to show, or null on success. */
  sendCode: (email: string) => Promise<string | null>;
  verifyCode: (email: string, code: string) => Promise<string | null>;
  saveProfile: (input: { displayName: string; role: Role }) => Promise<string | null>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    // Fires INITIAL_SESSION right away with any session restored from storage.
    const { data } = client.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setSessionLoaded(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  useEffect(() => {
    setProfile(null);
    setProfileLoaded(false);
    const client = supabase;
    if (!client || !userId) return;
    let cancelled = false;
    client
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        // A failed lookup reads as "no profile yet". Saving upserts, so the
        // worst case is asking for a name the person already gave.
        setProfile(data ?? null);
        setProfileLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const value = useMemo<Auth>(() => {
    const client = supabase;
    return {
      status: deriveStatus({
        configured: client !== null,
        sessionLoaded,
        hasSession: session !== null,
        profileLoaded,
        hasProfile: profile !== null,
      }),
      email: session?.user.email ?? null,
      profile,
      sendCode: async (email) => {
        if (!client) return null;
        const { error } = await client.auth.signInWithOtp({
          email: normalizeEmail(email),
          options: { shouldCreateUser: true },
        });
        return error ? sendCodeErrorMessage(error) : null;
      },
      verifyCode: async (email, code) => {
        if (!client) return null;
        const { error } = await client.auth.verifyOtp({ email: normalizeEmail(email), token: code, type: 'email' });
        return error ? VERIFY_CODE_ERROR : null;
      },
      saveProfile: async ({ displayName, role }) => {
        if (!client || !session) return SAVE_PROFILE_ERROR;
        const { data, error } = await client
          .from('profiles')
          .upsert({ id: session.user.id, display_name: normalizeDisplayName(displayName), role })
          .select()
          .single();
        if (error || !data) return SAVE_PROFILE_ERROR;
        setProfile(data);
        return null;
      },
      signOut: async () => {
        if (client) await client.auth.signOut();
      },
    };
  }, [session, sessionLoaded, profile, profileLoaded]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exits 0 with no output. (The provider isn't mounted yet. Task 6 wires it in.)

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/lib/supabase.ts apps/mobile/src/state/auth.tsx
git commit -m "feat(mobile): add AuthProvider with email-code sign-in and profile loading

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Sign-in, code, and name screens

**Files:**
- Create: `apps/mobile/src/components/TextField.tsx`
- Modify: `apps/mobile/src/components/Screen.tsx`
- Create: `apps/mobile/src/screens/SignInScreen.tsx`
- Create: `apps/mobile/src/screens/VerifyCodeScreen.tsx`
- Create: `apps/mobile/src/screens/ProfileNameScreen.tsx`
- Modify: `apps/mobile/src/navigation.tsx` (Route union)
- Modify: `apps/mobile/App.tsx` (`renderRoute` cases only)

**Interfaces:**
- Consumes: `useAuth()` (Task 4). `RESEND_AFTER_SECONDS`, `INVALID_EMAIL_ERROR`, `isValidEmail`, `normalizeEmail`, `digitsOnly`, `isCompleteCode`, `displayNameError` (Task 3). `useCommute().commute.role`.
- Produces:
  - Routes: `{ name: 'signIn' }`, `{ name: 'verifyCode'; email: string }`, `{ name: 'profileName' }`
  - `SignInScreen()`, `VerifyCodeScreen({ email }: { email: string })`, `ProfileNameScreen()`
  - `TextField(props: TextInputProps & { label: string; hint?: string | null; error?: string | null })`

- [ ] **Step 1: Add the routes**

In `apps/mobile/src/navigation.tsx`, extend the `Route` union so it reads:

```ts
export type Route =
  | { name: 'welcome' }
  | { name: 'signIn' }
  | { name: 'verifyCode'; email: string }
  | { name: 'profileName' }
  | { name: 'commute' }
  | { name: 'preferences' }
  | { name: 'discover' }
  | { name: 'match'; matchId: string }
  | { name: 'request'; matchId: string }
  | { name: 'booked'; matchId: string }
  | { name: 'driverRequests'; tab?: 'new' | 'upcoming' }
  | { name: 'driverRequest'; requestId: string }
  | { name: 'driverConfirm'; requestId: string };
```

- [ ] **Step 2: Keep footers above the keyboard**

In `apps/mobile/src/components/Screen.tsx`:
- add `KeyboardAvoidingView` to the `react-native` import,
- in `Screen`, replace the outer `<View style={{ flex: 1, backgroundColor: background }}>` and its closing `</View>` with:

```tsx
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
```

```tsx
    </KeyboardAvoidingView>
```

- [ ] **Step 3: Add the text field**

Create `apps/mobile/src/components/TextField.tsx`:

```tsx
import React from 'react';
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { colors, radius, space, type } from '../theme';

/** Labeled single-line input. An error replaces the hint and is announced. */
export function TextField({
  label,
  hint,
  error,
  style,
  ...input
}: TextInputProps & { label: string; hint?: string | null; error?: string | null }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={type.subheading}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textFaint}
        style={[styles.input, error ? styles.inputError : null, style]}
        {...input}
      />
      {error ? (
        <Text accessibilityLiveRegion="polite" style={[type.small, { color: colors.ember }]}>
          {error}
        </Text>
      ) : hint ? (
        <Text style={[type.small, { color: colors.textMuted }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    paddingHorizontal: space.lg,
    fontSize: 17,
    color: colors.textPrimary,
  },
  inputError: { borderColor: colors.ember },
});
```

- [ ] **Step 4: Add the Sign in screen**

Create `apps/mobile/src/screens/SignInScreen.tsx`:

```tsx
import React, { useState } from 'react';
import { Text } from 'react-native';
import { colors, type } from '../theme';
import { useNav } from '../navigation';
import { useAuth } from '../state/auth';
import { INVALID_EMAIL_ERROR, isValidEmail, normalizeEmail } from '../lib/authRules';
import { Screen, TopBar } from '../components/Screen';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';

export function SignInScreen() {
  const nav = useNav();
  const { sendCode } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (sending) return;
    if (!isValidEmail(email)) {
      setError(INVALID_EMAIL_ERROR);
      return;
    }
    setError(null);
    setSending(true);
    const err = await sendCode(email);
    setSending(false);
    if (err) setError(err);
    else nav.push({ name: 'verifyCode', email: normalizeEmail(email) });
  };

  return (
    <Screen
      header={<TopBar title="Sign in" />}
      footer={<Button label={sending ? 'Sending…' : 'Send code'} disabled={sending || email.trim() === ''} onPress={submit} />}
    >
      <Text style={type.title} accessibilityRole="header">
        What's your email?
      </Text>
      <Text style={[type.body, { color: colors.textSecondary }]}>We'll email you a 6-digit code. No password needed.</Text>
      <TextField
        label="Email"
        value={email}
        onChangeText={(text) => {
          setEmail(text);
          setError(null);
        }}
        error={error}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="send"
        onSubmitEditing={submit}
      />
    </Screen>
  );
}
```

- [ ] **Step 5: Add the Enter code screen**

Create `apps/mobile/src/screens/VerifyCodeScreen.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { colors, space, type } from '../theme';
import { useNav } from '../navigation';
import { useAuth } from '../state/auth';
import { digitsOnly, isCompleteCode, RESEND_AFTER_SECONDS } from '../lib/authRules';
import { Screen, TopBar } from '../components/Screen';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';

export function VerifyCodeScreen({ email }: { email: string }) {
  const nav = useNav();
  const { status, sendCode, verifyCode } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_AFTER_SECONDS);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  // A correct code signs the person in. Their auth status then decides where they go.
  useEffect(() => {
    if (status === 'needsProfile') nav.reset({ name: 'profileName' });
    else if (status === 'ready') nav.reset({ name: 'discover' });
  }, [status, nav]);

  const submit = async () => {
    if (!isCompleteCode(code) || verifying) return;
    setError(null);
    setNotice(null);
    setVerifying(true);
    const err = await verifyCode(email, code);
    setVerifying(false);
    if (err) setError(err);
  };

  const resend = async () => {
    setError(null);
    setNotice(null);
    const err = await sendCode(email);
    if (err) {
      setError(err);
      return;
    }
    setCode('');
    setNotice('New code sent.');
    setSecondsLeft(RESEND_AFTER_SECONDS);
  };

  return (
    <Screen
      header={<TopBar title="Enter code" />}
      footer={<Button label={verifying ? 'Checking…' : 'Verify'} disabled={!isCompleteCode(code) || verifying} onPress={submit} />}
    >
      <Text style={type.title} accessibilityRole="header">
        Check your email
      </Text>
      <Text style={[type.body, { color: colors.textSecondary }]}>We sent a 6-digit code to {email}.</Text>
      <TextField
        label="6-digit code"
        value={code}
        onChangeText={(text) => {
          setCode(digitsOnly(text));
          setError(null);
        }}
        error={error}
        hint={notice}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={6}
        returnKeyType="done"
        onSubmitEditing={submit}
      />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button
          label={secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : 'Resend code'}
          variant="tinted"
          size="sm"
          disabled={secondsLeft > 0}
          onPress={resend}
          style={{ flex: 1 }}
        />
        <Button label="Use a different email" variant="secondary" size="sm" onPress={nav.back} style={{ flex: 1 }} />
      </View>
    </Screen>
  );
}
```

- [ ] **Step 6: Add the Your name screen**

Create `apps/mobile/src/screens/ProfileNameScreen.tsx`:

```tsx
import React, { useState } from 'react';
import { Text } from 'react-native';
import { type } from '../theme';
import { useNav } from '../navigation';
import { useAuth } from '../state/auth';
import { useCommute } from '../state/commute';
import { displayNameError } from '../lib/authRules';
import { Screen, TopBar } from '../components/Screen';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';

export function ProfileNameScreen() {
  const nav = useNav();
  const { saveProfile } = useAuth();
  const { commute } = useCommute();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = async () => {
    if (saving) return;
    const invalid = displayNameError(name);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setSaving(true);
    const err = await saveProfile({ displayName: name, role: commute.role });
    setSaving(false);
    if (err) {
      setError(err);
      setFailed(true);
      return;
    }
    nav.reset({ name: 'commute' });
  };

  return (
    <Screen
      header={<TopBar title="Your name" />}
      footer={<Button label={saving ? 'Saving…' : failed ? 'Retry' : 'Continue'} disabled={saving} onPress={submit} />}
    >
      <Text style={type.title} accessibilityRole="header">
        What should riders call you?
      </Text>
      <TextField
        label="Name"
        value={name}
        onChangeText={(text) => {
          setName(text);
          setError(null);
        }}
        error={error}
        hint="First name and last initial, like Priya S."
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        maxLength={60}
        returnKeyType="done"
        onSubmitEditing={submit}
      />
    </Screen>
  );
}
```

- [ ] **Step 7: Render the new routes**

In `apps/mobile/App.tsx`, add the imports:

```tsx
import { SignInScreen } from './src/screens/SignInScreen';
import { VerifyCodeScreen } from './src/screens/VerifyCodeScreen';
import { ProfileNameScreen } from './src/screens/ProfileNameScreen';
```

and add these cases to `renderRoute`, after `case 'welcome':`:

```tsx
    case 'signIn':
      return <SignInScreen />;
    case 'verifyCode':
      return <VerifyCodeScreen email={route.email} />;
    case 'profileName':
      return <ProfileNameScreen />;
```

- [ ] **Step 8: Typecheck and test**

Run: `npm run typecheck`
Expected: exits 0 with no output.

Run: `npm test`
Expected: `# fail 0`.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/src/components/TextField.tsx apps/mobile/src/components/Screen.tsx apps/mobile/src/screens/SignInScreen.tsx apps/mobile/src/screens/VerifyCodeScreen.tsx apps/mobile/src/screens/ProfileNameScreen.tsx apps/mobile/src/navigation.tsx apps/mobile/App.tsx
git commit -m "feat(mobile): add sign-in, code entry, and name screens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Launch gate, signed-out redirect, and Welcome routing

**Files:**
- Create: `apps/mobile/src/screens/LoadingScreen.tsx`
- Modify: `apps/mobile/App.tsx`
- Modify: `apps/mobile/src/screens/WelcomeScreen.tsx`

**Interfaces:**
- Consumes: `AuthProvider`, `useAuth()` (Task 4). `launchRoute`, `welcomeNext`, `mustLeaveRoute` (Task 3). Routes from Task 5.
- Produces: an app where the first screen depends on auth status and sign-out returns to Welcome.

- [ ] **Step 1: Add the loading screen**

Create `apps/mobile/src/screens/LoadingScreen.tsx`:

```tsx
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { colors, space } from '../theme';
import { Icon } from '../components/Icon';

/** Shown at launch while the stored session and profile load. */
export function LoadingScreen() {
  return (
    <View style={styles.wrap} accessible accessibilityLabel="Loading Merge">
      <StatusBar style="light" />
      <View style={styles.logo}>
        <Icon name="git-merge" size={28} color={colors.maroon} />
      </View>
      <ActivityIndicator color={colors.onDark} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.maroon, alignItems: 'center', justifyContent: 'center', gap: space.xl },
  logo: { width: 56, height: 56, borderRadius: 16, backgroundColor: colors.peach, alignItems: 'center', justifyContent: 'center' },
});
```

- [ ] **Step 2: Wire providers, gate, and redirect in App.tsx**

In `apps/mobile/App.tsx`:
- change the React import to `import React, { useEffect, useState } from 'react';`
- add these imports:

```tsx
import { AuthProvider, useAuth } from './src/state/auth';
import { launchRoute, mustLeaveRoute } from './src/lib/authRules';
import { LoadingScreen } from './src/screens/LoadingScreen';
```

- replace `App` and `Router` (leave `renderRoute` as it is after Task 5) with:

```tsx
export default function App() {
  return (
    <AuthProvider>
      <CommuteProvider>
        <AuthGate />
      </CommuteProvider>
    </AuthProvider>
  );
}

/**
 * Waits for the stored session and profile, then picks the first screen once.
 * Later status changes don't remount navigation, so onboarding isn't interrupted.
 */
function AuthGate() {
  const { status } = useAuth();
  const [initial, setInitial] = useState<Route | null>(() => (status === 'loading' ? null : { name: launchRoute(status) }));

  useEffect(() => {
    if (initial === null && status !== 'loading') setInitial({ name: launchRoute(status) });
  }, [status, initial]);

  if (initial === null) return <LoadingScreen />;
  return (
    <NavigationProvider initial={initial}>
      <Router />
    </NavigationProvider>
  );
}

function Router() {
  const nav = useNav();
  const { status } = useAuth();

  // Android hardware back pops the in-app stack before leaving the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!nav.canGoBack) return false;
      nav.back();
      return true;
    });
    return () => sub.remove();
  }, [nav]);

  // Signing out, or a session ending elsewhere, returns to Welcome.
  useEffect(() => {
    if (mustLeaveRoute(status, nav.route.name)) nav.reset({ name: 'welcome' });
  }, [status, nav]);

  return renderRoute(nav.route);
}
```

- [ ] **Step 3: Route Welcome's Continue by status**

In `apps/mobile/src/screens/WelcomeScreen.tsx`:
- add `import { useAuth } from '../state/auth';` and `import { welcomeNext } from '../lib/authRules';`
- in `WelcomeScreen`, after `const { commute, update } = useCommute();`, add `const { status } = useAuth();`
- change the footer button to:

```tsx
      footer={<Button label="Continue" onPress={() => nav.push({ name: welcomeNext(status) })} />}
```

- [ ] **Step 4: Typecheck and test**

Run: `npm run typecheck`
Expected: exits 0 with no output.

Run: `npm test`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/screens/LoadingScreen.tsx apps/mobile/App.tsx apps/mobile/src/screens/WelcomeScreen.tsx
git commit -m "feat(mobile): gate launch on auth status and route Welcome by sign-in state

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Account sheet with Sign out

**Files:**
- Create: `apps/mobile/src/components/AccountSheet.tsx`
- Modify: `apps/mobile/src/screens/DiscoverScreen.tsx`

**Interfaces:**
- Consumes: `useAuth()` → `status`, `email`, `profile`, `signOut` (Task 4). The signed-out redirect in `Router` (Task 6) handles navigation after sign out.
- Produces: `AccountSheet({ visible, onClose }: { visible: boolean; onClose: () => void })`.

- [ ] **Step 1: Add the sheet**

Create `apps/mobile/src/components/AccountSheet.tsx`:

```tsx
import React from 'react';
import { Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, type } from '../theme';
import { useAuth } from '../state/auth';
import { Button } from './Button';

/** Who's signed in, and the way out. */
export function AccountSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { email, profile, signOut } = useAuth();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close account" />
      <View style={styles.sheet}>
        <SafeAreaView>
          <View style={{ padding: space.xl, gap: space.md }}>
            <Text style={type.heading} accessibilityRole="header">
              {profile?.display_name ?? 'Account'}
            </Text>
            <Text style={[type.small, { color: colors.textMuted }]}>Signed in as {email}</Text>
            <Button
              label="Sign out"
              variant="destructive"
              onPress={() => {
                onClose();
                void signOut();
              }}
            />
            <Button label="Close" variant="secondary" onPress={onClose} />
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: colors.maroonZone },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl },
});
```

- [ ] **Step 2: Add the account button to Discover**

In `apps/mobile/src/screens/DiscoverScreen.tsx`:
- add `import { useAuth } from '../state/auth';` and `import { AccountSheet } from '../components/AccountSheet';`
- in `DiscoverScreen`, after `const [filter, setFilter] = useState<Filter>('all');`, add:

```tsx
  const { status } = useAuth();
  const [accountOpen, setAccountOpen] = useState(false);
```

- in the search card, directly after the `IconButton` with `label="Edit commute"`, add:

```tsx
              {status !== 'prototype' ? (
                <IconButton icon="person-circle" label="Account" background={colors.background} onPress={() => setAccountOpen(true)} />
              ) : null}
```

- directly after `<TabBar active="discover" />` (the last child of `DiscoverScreen`'s root `View`), add:

```tsx
      <AccountSheet visible={accountOpen} onClose={() => setAccountOpen(false)} />
```

- [ ] **Step 3: Typecheck and test**

Run: `npm run typecheck`
Expected: exits 0 with no output.

Run: `npm test`
Expected: `# fail 0`.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components/AccountSheet.tsx apps/mobile/src/screens/DiscoverScreen.tsx
git commit -m "feat(mobile): add account sheet with sign out on Discover

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docs

**Files:**
- Modify: `README.md`
- Modify: `docs/ui.md`
- Modify: `docs/mvp.md`

**Interfaces:**
- Consumes: script names from Tasks 1–3 (`db:link`, `db:push`, `db:types`, `db:test`, `test`).
- Produces: setup instructions a new contributor can follow.

- [ ] **Step 1: Update README.md**

Replace the Status line under the intro with:

```markdown
> **Status:** MVP prototype. Email sign-in and profiles work against Supabase when it's configured. Without it, the app runs as a click-through prototype on sample data. Route maps, matching, and bookings are planned but not implemented. Merge is a working name.
```

Replace the whole `## Getting started` section (through the `npm run typecheck` sentence) with:

````markdown
## Getting started

Requires Node.js 20+ and npm.

```bash
npm install
cp apps/mobile/.env.example apps/mobile/.env
npm run start
```

With the Supabase values in `apps/mobile/.env` left empty, the app runs as a click-through prototype with sample data and no sign-in.

### Connecting Supabase

1. `npx supabase login`
2. `npm run db:link` (asks for the project's database password)
3. `npm run db:push` to apply `supabase/migrations/`
4. Copy the Project URL and `anon` public key (Project Settings → API) into `apps/mobile/.env` as `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`. **Never put a service-role key in the app.**
5. In the Supabase dashboard:
   - Authentication → Providers → Email: enabled, with "Confirm email" on. Email OTP Expiration: 600 seconds.
   - Authentication → Email Templates → Magic Link: include `{{ .Token }}` in the body so the email contains a 6-digit code.

After changing the schema, run `npm run db:types` to regenerate `apps/mobile/src/lib/database.types.ts`.

Supabase's built-in email sender only delivers to members of your Supabase team, and only a few emails an hour. Testers outside the team need a custom SMTP provider.

### Checks

```bash
npm run typecheck
npm test
npm run db:test
```

`db:test` runs the migrations and `supabase/tests/` in a throwaway PostGIS container, so it needs Docker.
````

In the `## Structure` code block, replace the `supabase/migrations/` line with these two lines, and add the `scripts/` line:

```text
supabase/migrations/   Database model and RLS (default deny)
supabase/tests/        SQL tests for RLS and database rules
scripts/               Database test runner
```

- [ ] **Step 2: Update docs/ui.md**

Replace the first paragraph (`The mobile app in apps/mobile is a clickable UI prototype…`) with:

```markdown
The mobile app in `apps/mobile` is a clickable UI prototype of the v0.1 flows. When Supabase is configured, sign-in and the profile are real. Everything after that (commute, matches, requests, bookings) uses sample data only (`src/data/mock.ts`), and nothing else is saved.
```

Under `## Flows`, before `**Passenger:**`, add:

```markdown
**Sign-in (when Supabase is configured):** Welcome + role → Sign in (email) → Enter code (6 digits, resend after 60 s) → Your name (new accounts only) → Where and when. Returning users open straight to Discover. The account button on Discover shows the signed-in email and Sign out. Without Supabase values in `.env`, sign-in is skipped and the prototype starts at Welcome as before.
```

In `## Not built yet`, change the last bullet to:

```markdown
- Time and area pickers, messaging, block and report flows, and verification
```

- [ ] **Step 3: Update docs/mvp.md**

Append at the end of the file:

```markdown

## Pilot blockers
- **Custom SMTP** (e.g. Resend or Postmark). Supabase's built-in sender only reaches project team members, so sign-in codes won't reach pilot testers without it.
- **In-app account deletion.** App Store guideline 5.1.1(v) requires it for any app that supports account creation.
```

- [ ] **Step 4: Commit**

```bash
git add README.md docs/ui.md docs/mvp.md
git commit -m "docs: document Supabase setup, sign-in flow, and pilot blockers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Web build and end-to-end verification

**Files:**
- Modify: `apps/mobile/package.json` (web deps, `web` script)
- Modify: `package.json` (root `web` script)
- Create (not committed): `.claude/launch.json`

**Interfaces:**
- Consumes: the complete app from Tasks 4–7, and `apps/mobile/.env` filled in by the owner (Task 2, Step 6).
- Produces: verified behavior for every spec scenario.

- [ ] **Step 1: Add web support**

```bash
cd apps/mobile && npx expo install react-dom react-native-web @expo/metro-runtime
```

In `apps/mobile/package.json` `scripts`, add `"web": "expo start --web"`. In the root `package.json` `scripts`, add `"web": "npm --workspace apps/mobile run web"`.

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 2: Add preview configs**

Create `.claude/launch.json` (do not commit):

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "mobile-web",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "web", "--", "--port", "8081", "--clear"],
      "port": 8081
    },
    {
      "name": "mobile-web-prototype",
      "runtimeExecutable": "env",
      "runtimeArgs": ["EXPO_PUBLIC_SUPABASE_URL=", "EXPO_PUBLIC_SUPABASE_ANON_KEY=", "npm", "run", "web", "--", "--port", "8082", "--clear"],
      "port": 8082
    }
  ]
}
```

- [ ] **Step 3: Verify prototype mode**

Start `mobile-web-prototype` with `preview_start`. Check, using `read_page` and screenshots:
1. Welcome shows, and Continue goes to "Where and when" (no Sign in).
2. Finish onboarding to Discover. There is no Account button in the search card.

Stop the server.

- [ ] **Step 4: Verify the connected flow (the owner enters the code)**

Start `mobile-web` with `preview_start`. The owner must use an email on their Supabase team. The owner types the 6-digit code into the browser pane themselves. Agents never enter it, because the code is sent to a hosted service.
1. **New user:** Welcome → Continue → Sign in. Enter `not-an-email` → "Enter a valid email address." shows and nothing is sent. The owner enters their email → Send code → Enter code shows "We sent a 6-digit code to …" and "Resend code in 60s" counting down.
2. **Wrong code:** enter `000000` → "That code didn't work. Check it or request a new one."
3. **Right code** (owner) → Your name. Enter `P` → "Enter at least 2 characters." Enter the owner's name → Continue → Where and when.
4. Confirm the row exists: Supabase MCP `execute_sql` (read-only) `select id, display_name, role from public.profiles;`, or ask the owner to check Table Editor → profiles.
5. **Reload** the page → the loading screen, then Discover (still signed in).
6. **Sign out:** Account button → sheet shows the name and "Signed in as …" → Sign out → Welcome.
7. **Returning user:** Continue → Sign in → code (owner) → Discover directly (no name step).

Check `read_console_messages` with `onlyErrors: true` after each scenario. Expected: no errors.

Stop the server.

- [ ] **Step 5: Final checks**

Run: `npm run typecheck && npm test && npm run db:test`
Expected: all exit 0. `PASS profiles_test.sql`.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/package.json package.json
git commit -m "chore(mobile): add Expo web support for browser previews

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
