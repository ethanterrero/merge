# Limited profile cards (M-16) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `public.profile_cards(ids uuid[])`, a `security definer` function that returns a fixed five-field card for members the caller already has a relationship with, and nothing for blocked, suspended, deleted, unrelated or unknown ids.

**Architecture:** One plpgsql function in `supabase/migrations/0014_profile_cards.sql`, with no new table, policy or trigger. It filters with `is_active` and `is_blocked` (both client-inaccessible) inside the function. One SQL test file proves the spec's test plan. CI's `database` job runs the tests (no Docker locally) and produces `database.types.ts`.

**Tech Stack:** Postgres 17 + PostGIS (CI image `postgis/postgis:17-3.5`), Supabase conventions, plain SQL tests with `raise exception`.

**Spec:** `docs/superpowers/specs/2026-10-10-profile-cards-design.md` (approved by the owner on 2026-10-10 with all six recommendations).

## Global Constraints

- Migration file: `supabase/migrations/0014_profile_cards.sql` (M-26 takes 0015; 0014 must merge first).
- Output columns, exactly: `id uuid, public_name text, role text, ride_prefs text[], vetted boolean`.
- `security definer`, `stable`, `set search_path = ''`, every name schema-qualified or table-qualified.
- `revoke execute ... from public, anon`; `grant execute ... to authenticated`.
- Name is `public.public_name(display_name)`, never `display_name`. `vetted` is a boolean, never `vetted_at`.
- More than 100 distinct non-null ids raise `22023`, checked before anything about the caller.
- Suspended caller or no `auth.uid()`: zero rows, no error. Anon: 42501 (no execute).
- Related = any invitation (either direction, any status), ride (either seat, any status), connection, or Crew (any status). Caller's own id never returns.
- No app code, no `src/lib/data/`, no backlog edits, no hosted DB, no PR.

## Review Focus

- Card visibility flipping with invitation status (declined vs expired) or feedback ("no" removing the connection) would reveal a "no". Pinned in Task 1 by the status loops and the Fay feedback step.
- A blocked person probing with a block-specific error or row count. Pinned in Task 1 step 12 (all exclusions return zero rows, no error).
- plpgsql `returns table` columns shadowing an unqualified column (`id`, `role`) and raising "ambiguous column". Pinned by every call in Task 1; the migration qualifies every column.
- The limit error depending on the caller (suspended vs active). Pinned in Task 1's last block.
- Duplicate or null ids producing duplicate rows or counting toward the limit. Pinned in Task 1 steps 7 and 13.

---

### Task 1: Failing SQL test

**Files:**
- Create: `supabase/tests/profile_cards_test.sql`

**Interfaces:**
- Consumes: `tests.as_user(uuid)`, `tests.as_anon()`, `tests.as_admin()` (`scripts/db-test/auth-shim.sql`); `public.public_name(text)` (0011).
- Produces: the contract for Task 2, `public.profile_cards(uuid[]) returns table (id uuid, public_name text, role text, ride_prefs text[], vetted boolean)`.

- [ ] **Step 1: Write the test** following the spec's test plan 1–13. Fixture: Ada (caller) plus one person per relationship kind, each sharing exactly one row with Ada (rides point at a control pair's invitations so the ride is the only link). Steps: privileges and exact `pg_get_function_result`; anon gets 42501; Ada sees exactly the 13 related cards, 'Priya Sharma' → 'Priya S.', fields match the profile (checked as admin against `public_name(display_name)`); each related person sees 'Ada L.'; loops over every invitation, ride and Crew status keep the card; Fay's yes/yes then no keeps the card; unrelated, unknown, null, empty, control pair, mixed input; blocks both ways, suspension and deletion all return zero rows with no error; suspended caller and no-uid caller get zero rows; unblock and unsuspend restore visibility; 100 ids work, 100 + duplicate + null works, 101 raise 22023, also for a suspended caller.
- [ ] **Step 2: Commit and push; confirm CI `database` fails** on `profile_cards_test.sql` because `public.profile_cards(uuid[])` doesn't exist.

```bash
git -C <wt> add supabase/tests/profile_cards_test.sql docs/superpowers/plans/2026-10-10-m-16-profile-cards.md
git -C <wt> commit -m "test(db): profile cards contract (M-16)"
git -C <wt> push
```

### Task 2: Migration

**Files:**
- Create: `supabase/migrations/0014_profile_cards.sql`

**Interfaces:**
- Consumes: `public.is_active(uuid)`, `public.is_blocked(uuid, uuid)` (owner-only), `public.public_name(text)`; tables `profiles`, `invitations`, `rides`, `connections`, `commute_crews`.
- Produces: `public.profile_cards(uuid[])` as above.

- [ ] **Step 1: Write the function** exactly as the spec's "Body outline" (plpgsql; de-duplicate non-null ids with `array_agg(distinct …)`; raise 22023 above 100; return nothing for a null or inactive caller; `return query` with `p.id = any (wanted)`, `p.id <> me`, `is_active(p.id)`, `not is_blocked(me, p.id)` and the four `exists` checks). Add the header comment naming M-27's gating duty and the drop-and-recreate rule for M-49/M-41, then the revoke and grant.
- [ ] **Step 2: Commit and push; confirm CI `database` runs `profile_cards_test.sql` green** and every other test still passes. The types check fails until Task 3.

```bash
git -C <wt> add supabase/migrations/0014_profile_cards.sql
git -C <wt> commit -m "feat(db): profile_cards for related members (M-16, 0014)"
git -C <wt> push
```

### Task 3: Generated types, spec answers

**Files:**
- Modify: `apps/mobile/src/lib/database.types.ts` (CI artifact only, never by hand)
- Modify: `docs/superpowers/specs/2026-10-10-profile-cards-design.md` (status line and approved answers)

- [ ] **Step 1: Download the artifact** from Task 2's run and copy it over.

```bash
/opt/homebrew/bin/gh run download <run-id> -R ethanterrero/merge -n database-types -D <scratch>/database-types
cp <scratch>/database-types/database.types.ts <wt>/apps/mobile/src/lib/database.types.ts
```

- [ ] **Step 2: Check the diff** adds only `profile_cards` under `Functions` (`Args: { ids: string[] }`, `Returns: { id, public_name, role, ride_prefs, vetted }[]`).
- [ ] **Step 3: Record the owner's approval** in the spec: status line, and under each owner question "Approved 2026-10-10 as recommended".
- [ ] **Step 4: Commit, push, confirm every CI job is green.**

```bash
git -C <wt> add apps/mobile/src/lib/database.types.ts docs/superpowers/specs/2026-10-10-profile-cards-design.md
git -C <wt> commit -m "chore(db): regenerate database types for profile_cards"
git -C <wt> push
```

No client types are written now: the spec's `ProfileCard` type is a sketch for the wiring tasks, and M-19 is building `src/lib/data/` in parallel.
