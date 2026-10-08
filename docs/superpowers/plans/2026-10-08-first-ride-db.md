# First Ride Database Model Implementation Plan (M-04)

**Goal:** Implement the First Ride data model as `supabase/migrations/0003_first_ride.sql`, with the eight assertions from the spec's Testing section in `supabase/tests/first_ride_test.sql`.

**Spec:** `docs/superpowers/specs/2026-10-08-first-ride-design.md` ("Data model" and "Testing"). Harness: `docs/superpowers/specs/2026-10-08-supabase-auth-design.md` ("Migrations", "Testing").

**Base:** `7fba72c` (sign-in branch; has 0001 with `extensions.geography`, 0002, the DB test harness and the First Ride spec).

## Constraints

- Migration number 0003 only. No app changes, no booking API, no ride completion (D-01, migration 0013), no notifications, no account deletion. On-delete behavior stays as the spec says (0007 fixes cascades).
- `npm run db:test` needs Docker, which this machine lacks. The CI `database` job is the test run.
- Every `security definer` function: `set search_path = ''`, every name schema-qualified, `revoke execute ... from public, anon`, and `grant execute ... to authenticated` only for client-called RPCs.
- Extension objects are always schema-qualified (`extensions.*`). 0003 uses none.
- The shim (like Supabase) grants `anon`/`authenticated` all table privileges and function execute by default. Where clients must have no access, revoke explicitly.
- Privacy: no client can tell "said no" from "not answered". Feedback rows are author-only; connections are the only shared outcome.

## Files

| Path | Status | Responsibility |
| --- | --- | --- |
| `supabase/tests/first_ride_test.sql` | Create | Assertions 1–8 (plus rule 4 and grant checks) |
| `supabase/migrations/0003_first_ride.sql` | Create | Tables, checks, RLS, grants, `resolve_connection` + trigger, Crew RPCs |

## Task 1: Failing test first

- [ ] Write `first_ride_test.sql` in `profiles_test.sql` style: one transaction, `DO` blocks that `raise exception`, identity via `tests.as_user/as_anon/as_admin`. Ten people in five pairs so each scenario has its own pair: Ada+Bea (yes+yes, Crew, then No), Cal+Dan (yes+no), Eve+Fay (yes+no answer), Gil+Hal (yes+individual), Ivy+Jo (yes+yes, proposed Crew).
- [ ] Negative checks use unfiltered statements and row counts, so a select policy can't mask an update policy, and privilege checks use `has_table_privilege`/`has_function_privilege` so RLS default-deny can't mask a missing revoke.
- [ ] Commit, push, confirm the CI `database` job fails because the schema is missing (`ride_date`/`rides` don't exist).

## Task 2: Migration

- [ ] `commute_crews` (pair `user_low < user_high`, `proposed_by` in the pair, weekdays non-empty subset of 1–5, status check, partial unique index on the pair for `proposed|active|paused`).
- [ ] `invitations`: add `ride_date date not null`, `crew_id uuid references commute_crews(id)`.
- [ ] `rides`, `ride_feedback`, `connections` with the spec's checks.
- [ ] RLS: participants select own rides; feedback select/insert/update by author only, insert/update only on a completed ride the author was on; members select connections and crews. Revoke insert/update/delete/truncate on `rides`, `connections`, `commute_crews` and delete/truncate on `ride_feedback` from `anon`, `authenticated`.
- [ ] `ride_feedback` before trigger: server-set `created_at`/`updated_at`, `ride_id`/`author_id` immutable.
- [ ] `resolve_connection(a, b)` (rules 1–4) and an `after insert or update` trigger on `ride_feedback`; neither is client-executable.
- [ ] `propose_crew`, `respond_to_crew`, `set_crew_status` with exactly the spec's transitions; execute for `authenticated` only.
- [ ] Push and iterate until CI `database` shows `PASS first_ride_test.sql` and `PASS profiles_test.sql`, and `typecheck` passes.
