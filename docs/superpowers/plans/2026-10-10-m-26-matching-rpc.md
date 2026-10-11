# M-26 Matching RPC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `public.find_matches(ride_date, role_filter)`, the `security definer` discovery RPC, with every hard filter, the ranking, banded detours and privacy-safe output, plus its SQL tests.

**Architecture:** One migration, `supabase/migrations/0015_matching.sql`, adds four functions (the GiST indexes first planned here were dropped after the security review; spec section 7):
- `match_prefilter`: an immutable area bound.
- `match_days_label`: an immutable label helper.
- `match_candidates(me, ride_date)`: the invoker helper with the hard filters and raw pair fields, including exact detour minutes. It's internal only, and M-27 reuses it.
- `find_matches`: the client RPC. It runs the caller checks, the role filter, presentation, reasons, ranking and the cap.

One test file, `supabase/tests/matching_test.sql`, covers the spec's section 10.

**Tech Stack:** Postgres 17 + PostGIS 3.5 (CI image `postgis/postgis:17-3.5`), plpgsql and SQL functions, the repo's auth shim (`scripts/db-test/auth-shim.sql`), GitHub Actions `database` job (no local Docker daemon on this machine).

**Spec:** `docs/superpowers/specs/2026-10-10-matching-rpc-design.md` (approved 2026-10-10; Q8 changed to banded detours)

## Global Constraints

- Migration number 0015 (`0015_matching.sql`). Don't depend on anything in M-16's 0014.
- Every function sets `set search_path = ''` and schema-qualifies `extensions.st_*`, `extensions.geography` and `extensions.geometry`.
- `find_matches`: `security definer`, `stable`; execute revoked from `public` and `anon`, granted to `authenticated`.
- `match_candidates`, `match_prefilter`, `match_days_label`: execute revoked from `public`, `anon` and `authenticated`.
- Call `is_blocked`, `is_active` and `is_vetted` only inside definer code. Never reimplement M-33's estimate.
- No returned column may carry exact detour minutes. `detour_band` is `under_3` (0–2 min) or `3_to_5` (3–5 min). The reason labels are "Under 3 min detour" and "3–5 min detour".
- Output columns, in order: `other_id, role, name, vetted, ride_prefs, origin_area_lat, origin_area_lng, origin_area_label, destination_area_lat, destination_area_lng, destination_area_label, area_radius_m, shared_weekdays, departure_time, window_start, window_end, departure_gap_minutes, detour_band, seats_offered, seats_open, brings_scooter, scooter_fits, connected, reasons, rank`.
- Ranking: the detour band (never exact minutes; security review follow-up), then |gap|, then connected first, then shared preferences (descending), then shared weekdays (descending), then reaches 3+ occupants first, then `other_id`, then `role`. Cap at 50 rows.
- Errors: no uid → 42501; null or past `ride_date` → 22023; bad `role_filter` → 22023. These return an empty set: a suspended caller, a caller with no profile, a weekend date, and a caller with no commute that weekday.
- Commit `apps/mobile/src/lib/database.types.ts` only from CI's `database-types` artifact.
- No PR, no merge, no hosted DB, no backlog edits. Never force-push.

## Review Focus

1. A **cancelled** ride on the date must not use up the driver's seat or the passenger's date. Fixture ride Bea → Pia `cancelled`, asserted through Bea's `seats_open = 3` and Pia still in Bea's list (Task 2).
2. A confirmed ride on **another** date must not lower `seats_open`. Hov's `seats_open` is 3 a week later (Task 2).
3. A driver commute with **origin = destination** (no direction) must not error in the prefilter. `match_prefilter(park, park, …)` is not null (Task 2).
4. A departure window **near midnight** must not wrap. `window_start` and `window_end` are clamped to 00:00–23:59 by integer minutes. Not exercised: commutes are weekday mornings, and a wrap-around would need a fixture outside the pilot's use.
5. A "Both" member who matches in **both roles** must appear once per role and never match themselves. Cy's view of Bo (Task 2).

---

### Task 1: Record the owner's answers in the spec

**Files:**
- Modify: `docs/superpowers/specs/2026-10-10-matching-rpc-design.md`

**Interfaces:**
- Consumes: the owner's review (Q1–Q7 approved; Q8 changed to banded detours).
- Produces: the approved spec that Tasks 2–4 implement.

- [ ] **Step 1:** Set Status to approved and record the Q8 change in Status, section 3 (`detour_band` replaces `detour_minutes`, including how a driver's lower `max_detour_minutes` interacts), section 4 (helper table), section 5 (exact minutes rank internally only), section 6 (band labels), section 8 (decision 12's revisit note) and the Q8 row. Fix the test-plan fixture (Ada Webster → Montgomery, Bea Park St → Fremont) and add test 13: no exact minutes in the output.
- [ ] **Step 2:** Commit.

```bash
git -C /Users/ethan/merge/.claude/worktrees/m-26 add docs/superpowers/specs/2026-10-10-matching-rpc-design.md docs/superpowers/plans/2026-10-10-m-26-matching-rpc.md
git -C /Users/ethan/merge/.claude/worktrees/m-26 commit -m "docs(m-26): record owner approval and banded detours; add build plan"
```

### Task 2: Failing SQL tests (red)

**Files:**
- Create: `supabase/tests/matching_test.sql`

**Interfaces:**
- Consumes: `public.find_matches(date, text)`, `public.match_candidates(uuid, date)`, `public.match_prefilter(extensions.geography ×4)` and `public.match_days_label(integer[])`, with the names and shapes in Global Constraints.
- Produces: 11 numbered test groups.
  - Test-only helpers: `pg_temp.matches(member, filter, date) → jsonb`, `pg_temp.keys(jsonb) → text[]` (`'id:role'`), `pg_temp.row_for(jsonb, id, role) → jsonb`, `pg_temp.match_error(who, date, filter) → sqlstate`.

- [ ] **Step 1: Write the test file.** The fixture is in its header comment. The ride date is the next Wednesday after today (LA). Every driver goes Park St → Fremont at 7:40 unless noted, so Ada (Webster → Montgomery, 7:45) has a 2-minute detour with it. Expected minutes were checked offline with a Vincenty geodesic: Laney → Fremont is 4.02 min, Lake → Fremont 7.79 min, and Fremont → Park is reversed (null). Groups:
  1. Privileges and shape.
  2. No exact minutes in the output (Q8): the exact column list, no `*minute*` column except `departure_gap_minutes`, the band values, and the band labels.
  3. Caller checks.
  4. Ada's driver list equals `12,13,14,15,10,11,16,17,18,1b,19,1a`, with every excluded id absent and `rank` running 1..n.
  5. Bea's passenger list equals `17,24,30,01`; block, cargo and "Both" checks.
  6. Row contents and exact reasons, including the Hov seats on another date.
  7. Privacy: stored areas and labels, no exact coordinate, no vehicle or account data.
  8. Stable results.
  9. Days labels.
  10. The prefilter keeps every pair the estimate accepts, rejects Walnut Creek, and answers for a zero-length route.
  11. Deletion.
- [ ] **Step 2: Run it to see it fail.** Push the branch and read the `database` job.

```bash
git -C /Users/ethan/merge/.claude/worktrees/m-26 add supabase/tests/matching_test.sql
git -C /Users/ethan/merge/.claude/worktrees/m-26 commit -m "test(m-26): matching SQL tests (red)"
git -C /Users/ethan/merge/.claude/worktrees/m-26 push
/opt/homebrew/bin/gh run list -R ethanterrero/merge --branch feat/m-26-matching-rpc --workflow Checks --limit 1
```

Expected: `FAIL matching_test.sql` with `function public.find_matches(date, text) does not exist` (or the `regprocedure` cast error for it). Every other suite passes.

### Task 3: The migration (green)

**Files:**
- Create: `supabase/migrations/0015_matching.sql`

**Interfaces:**
- Consumes: from 0012, `public.estimate_detour_minutes(geography ×4) → integer`, `detour_limit_minutes()`, `detour_speed_mph()` and `detour_road_factor()`. From 0008, `public.area_radius_m()`. From 0011, `is_active`, `is_vetted` and `public_name`. From 0005, `is_blocked`.
- Produces:
  - `public.match_candidates(me uuid, ride_date date) returns table(my_commute_id uuid, other_commute_id uuid, other_id uuid, role text, detour_minutes integer, departure_gap_minutes integer, shared_weekdays integer[], seats_offered integer, seats_open integer, pax_brings_scooter boolean, scooter_fits boolean, shared_prefs text[], connected boolean, reaches_hov boolean)`. M-27 and M-41 extend it by copying this definition.
  - `public.find_matches(ride_date date, role_filter text default 'all')` with the output columns in Global Constraints.

- [ ] **Step 1: Write the migration.**
  - `match_prefilter`: midpoint disc of radius `(L + D)/2 × 1.01 + area_radius_m()`, where `D = (limit + 0.5) × mph × 1609.344 / 60 / road_factor`.
  - `match_days_label`: a gaps-and-islands label.
  - `match_candidates`: SQL, invoker. CTEs `mine → pairs → eligible → available → scored`, applying rules 1–13 in the spec's section 2. Parameters are qualified as `match_candidates.<name>`, because `rides.ride_date` would otherwise win.
  - `find_matches`: plpgsql, definer, with `#variable_conflict use_column`. Every column reference and parameter is qualified. The window is clamped by integer minutes and built with `make_time`.
  - The grants from Global Constraints.
- [ ] **Step 2: Run the tests to see them pass.** Commit, push, and read the `database` job.

```bash
git -C /Users/ethan/merge/.claude/worktrees/m-26 add supabase/migrations/0015_matching.sql
git -C /Users/ethan/merge/.claude/worktrees/m-26 commit -m "feat(m-26): find_matches matching RPC (migration 0015)"
git -C /Users/ethan/merge/.claude/worktrees/m-26 push
```

Expected: `PASS matching_test.sql` and every earlier suite passing. The job then fails **only** at "Committed database.types.ts matches the migrations", which Task 4 fixes. If a test fails, use superpowers:systematic-debugging: read the raised message, fix the migration (or a wrong fixture expectation, with its reason recorded in the commit), and push again.

### Task 4: Generated types

**Files:**
- Modify: `apps/mobile/src/lib/database.types.ts` (CI artifact only)

**Interfaces:**
- Consumes: the `database-types` artifact from Task 3's run.
- Produces: typed `find_matches` `Args` and `Returns` for M-42.

- [ ] **Step 1: Download and commit the artifact.**

```bash
/opt/homebrew/bin/gh run download <run-id> -R ethanterrero/merge -n database-types -D <scratch>/types
cp <scratch>/types/database.types.ts /Users/ethan/merge/.claude/worktrees/m-26/apps/mobile/src/lib/database.types.ts
git -C /Users/ethan/merge/.claude/worktrees/m-26 add apps/mobile/src/lib/database.types.ts
git -C /Users/ethan/merge/.claude/worktrees/m-26 commit -m "chore(db): regenerate database types"
git -C /Users/ethan/merge/.claude/worktrees/m-26 push
```

- [ ] **Step 2:** Confirm the next run's `database` job is fully green, along with `typecheck`, `lint`, `deno` and `migration-order`.
