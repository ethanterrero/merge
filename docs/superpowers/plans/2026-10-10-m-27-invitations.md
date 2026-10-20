# M-27 Invitations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the invitation half of the booking spec: `0017_invitations.sql` with send, accept, decline, withdraw and the per-viewer read, plus its two SQL test files.

**Architecture:** The `invitations` table stores what really happened. Clients never read it; `my_invitations()` projects each viewer's state at read time through `invitation_state(row, viewer, as_of)`, which holds a "no" from the acting party until the reply cutoff (D-22, Q8). Every RPC is `security definer`, decides from the caller's projection, and refuses with a stable `hint`. Eligibility reuses M-26's `match_candidates` through a new three-argument overload.

**Tech Stack:** Postgres 17 + PostGIS 3.5 (CI image `postgis/postgis:17-3.5`), plpgsql/SQL functions, the repo's SQL test harness (`scripts/db-test.sh`, `scripts/db-test/auth-shim.sql`). DB tests run only in CI's `database` job (no local container runtime).

**Spec:** `docs/superpowers/specs/2026-10-10-booking-design.md` (approved 2026-10-10, Q1–Q12 as recommended; see its "Build notes").

## Global Constraints

- Migration file `supabase/migrations/0017_invitations.sql`; refer to other migrations by slug in comments.
- Every `security definer` function: `set search_path = ''`, every name schema-qualified (`public.*`, `extensions.*`, `pg_catalog.*` where needed), `revoke execute … from public, anon`; grant `authenticated` only for the five client RPCs.
- `is_blocked`, `is_active`, `is_vetted` are called only inside definer code or triggers, never in RLS.
- Cutoffs: reply 1200 minutes (8 PM), cancel 1260 (9 PM), America/Los_Angeles, mirroring `REPLY_CUTOFF_MINUTES` / `CANCEL_CUTOFF_MINUTES` in `apps/mobile/src/lib/dates.ts`.
- Limits: 10 sent per LA day; 5 open sent; one open per recipient (any date for `first_ride`, per date for `ride_again`/`crew`); one open per pair per date in either party's view; ride date at most today + 14.
- `seats = 1` always. Kind is server-derived.
- Refusals: `raise exception '<constant>' using errcode = '<code>', hint = '<hint>'`; the `unavailable` refusal is byte-identical for every cause.
- Don't edit any existing test file or migration. Don't touch `docs/mvp-backlog.md`. The M-32 parts of the spec are out of scope.
- Commit email `ethanterrero@gmail.com`; messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never force-push.

## Review Focus

1. **Legacy inserts in older suites** (matching, profile cards, member status, deletion, First Ride, blocks insert raw rows with five columns): they must keep passing, so the fill trigger supplies every new not-null column. Pinned by the whole CI run, and by Task 1's "legacy insert" test.
2. **`now()` is fixed inside a test transaction:** expiry and holds are tested by passing `as_of` to `invitation_state` and by moving `expires_at`/`held_until` into the past as admin, never by waiting. Task 3's D-22 group.
3. **A rate-limited sender probing a blocked recipient** must see `daily_limit`, not `unavailable`. Task 2's ordering test.
4. **Withdrawing or un-accepting a secretly held row** must succeed and look the same as on a live row, to both sides. Task 3, groups 10–11.
5. **A suspended counterpart with an `accepted` request row (legacy shape)** must not appear in `my_invitations` or the open count. Task 4's suspension group.

---

### Task 1: Schema, cutoffs, projection helpers, RLS

**Files:**
- Create: `supabase/migrations/0017_invitations.sql` (first half)
- Test: `supabase/tests/invitations_test.sql` (groups 1–2 and the legacy insert)

**Interfaces:**
- Produces: `public.reply_cutoff_minutes() → integer` (1200), `public.cancel_cutoff_minutes() → integer` (1260), `public.ride_cutoff(ride_date date, minutes integer) → timestamptz`, `public.reply_cutoff(ride_date date) → timestamptz`; columns `direction, kind, pickup_area, pickup_area_label, pickup_time, seats, brings_scooter, expires_at, accepted_at, closed_at, held_until, waiting_closed_at, cancel_reason, updated_at`; `public.invitation_state(inv public.invitations, viewer uuid, as_of timestamptz) → text`; `public.invitation_counterpart_visible(inv, viewer) → boolean`; `public.invitation_open_for(inv, viewer, as_of) → boolean`; `public.close_invitations(ids uuid[], reason text) → void`.

- [ ] **Step 1: Write the failing tests.** In `invitations_test.sql`: privileges (anon/authenticated have no table privilege on `invitations`; helpers not executable by clients), `reply_cutoff('2026-10-13') = '2026-10-13 03:00+00'`, `reply_cutoff('2026-11-02') = '2026-11-02 04:00+00'`, `reply_cutoff('2027-03-15') = '2027-03-15 03:00+00'`, `ride_cutoff(d, 1260) = reply_cutoff(d) + 1 hour`; a legacy admin insert `(sender_id, recipient_id, commute_id, status, ride_date)` gets `expires_at = reply_cutoff(ride_date)`, `kind = 'first_ride'`, `direction = 'request'` and the commute's area and time.
- [ ] **Step 2: Push and confirm CI's `database` job fails** on `invitations_test.sql` (functions missing).
- [ ] **Step 3: Implement** the guard, cutoff helpers, `alter table` (status check replaced to add `withdrawn`, `booked`), fill / pickup-required / updated-at triggers, two `(party, ride_date)` indexes, the participant policy, `revoke all … from public, anon, authenticated`, and the four helpers, as the spec's sections 2 and 8 define them:

```sql
create function public.invitation_state(inv public.invitations, viewer uuid, as_of timestamptz)
returns text language plpgsql stable set search_path = '' as $$
declare
  live boolean := inv.status in ('pending','accepted') and as_of < inv.expires_at;
  held boolean := inv.held_until is not null and as_of < inv.held_until and inv.waiting_closed_at is null;
begin
  if viewer is null or as_of is null then return null; end if;
  if viewer = inv.sender_id then
    if inv.status = 'booked' then return 'booked'; end if;
    if inv.status = 'pending' and live then return 'waiting_for_them'; end if;
    if inv.status = 'declined' and held then return 'waiting_for_them'; end if;
    if inv.status = 'accepted' and live then return 'accepted_confirm_seat'; end if;
    if inv.status = 'withdrawn' or (inv.status = 'declined' and inv.waiting_closed_at is not null) then return 'closed_by_me'; end if;
    return 'unavailable';
  elsif viewer = inv.recipient_id then
    if inv.status = 'booked' then return 'booked'; end if;
    if inv.status = 'pending' and live then return 'waiting_for_me'; end if;
    if inv.status = 'accepted' and live then return 'accepted_waiting_for_driver'; end if;
    if inv.status = 'withdrawn' and held then return 'accepted_waiting_for_driver'; end if;
    if inv.status = 'declined' or (inv.status = 'withdrawn' and inv.waiting_closed_at is not null) then return 'closed_by_me'; end if;
    return 'unavailable';
  end if;
  return null;
end $$;
```

- [ ] **Step 4: Push; CI groups 1–2 pass, and every earlier suite still passes.**
- [ ] **Step 5: Commit** `feat(m-27): invitations schema, cutoffs and per-viewer projection`.

### Task 2: `send_invitation` and `match_candidates` overload

**Files:**
- Modify: `supabase/migrations/0017_invitations.sql`
- Test: `supabase/tests/invitations_test.sql` (groups 3–6, 12)

**Interfaces:**
- Consumes: Task 1's helpers; 0015's `match_candidates(uuid, date)` body.
- Produces: `public.match_candidates(me uuid, ride_date date, skip_opt_in_if_connected boolean)` (invoker, not client-executable); `public.match_candidates(uuid, date)` now returns `match_candidates(me, ride_date, false)`; `public.send_invitation(recipient uuid, other_role text, ride_date date, pickup_time time default null, brings_scooter boolean default null, crew_id uuid default null) → uuid`; `public.invitation_unavailable() → void` (raises the one neutral error).

- [ ] **Step 1: Write the failing tests:** both directions with every copied column; each own-state refusal (`not_signed_in`, `invalid_input` ×4, suspended caller `unavailable`, `past_cutoff` for today, `too_far_ahead` for today + 15, `no_commute_that_day` on a Saturday, `not_vetted`, `no_vehicle`, `already_booked`, `car_full`, `time_outside_window`, `scooter_doesnt_fit`); the neutral refusals (blocked either way, suspended, opted out, unvetted driver, too long a detour, full driver, unknown id) compared as `sqlstate|hint|message` text and leaving no row or card; `daily_limit` on the 11th, `pending_limit` on the 6th open (a declined one counts), `already_requested` per recipient and per pair-date (crossed, and after a held driver withdrawal); the ordering case; Ride Again to an opted-out connected driver; Crew active/paused/wrong weekday; Q5 (no `first_ride` and no `find_matches` row after a completed ride without a connection, in both directions).
- [ ] **Step 2: Push; confirm the new groups fail.**
- [ ] **Step 3: Implement** the overload (copy 0015's body; change rule 3 to `(op.discovery_opt_in or (skip_opt_in_if_connected and <connection>))`; add `and (<connection> or not exists (<completed ride of the pair>))`), the wrapper, and `send_invitation` with section 3's twenty checks in order.
- [ ] **Step 4: Push; CI green, including `matching_test.sql` untouched.**
- [ ] **Step 5: Commit** `feat(m-27): send_invitation with ordered checks and rate limits`.

### Task 3: Answering, withdrawing, `my_invitations`

**Files:**
- Modify: `supabase/migrations/0017_invitations.sql`
- Test: `supabase/tests/invitations_test.sql` (groups 7–11, 15)

**Interfaces:**
- Consumes: Task 1 and Task 2.
- Produces: `public.accept_invitation(invitation_id uuid)`, `public.decline_invitation(invitation_id uuid)`, `public.withdraw_invitation(invitation_id uuid)` (all `→ void`); `public.my_invitations()` returning `id, ride_date, kind, direction, my_role, other_id, state, reply_by, pickup_area_lat, pickup_area_lng, pickup_area_label, area_radius_m, pickup_time, seats, brings_scooter, crew_id, ride_id, created_at`; internal `public.invitation_for_action(invitation_id uuid, me uuid) → public.invitations` (lookup, locks, visibility).

- [ ] **Step 1: Write the failing tests:** accept on an invite (both projections), `driver_confirms` on a request, `unavailable` for a third party / repeat / after cutoff / driver unvetted, `already_booked`; every decline and withdraw transition; D-22 (declined vs unanswered: identical `invitation_state` at `expires_at − 1 s` and at `expires_at`, identical `my_invitations` rows before and after moving the cutoff into the past, `expired` status projects the same); a driver's held withdrawal looks like an ignored acceptance; the waiting party closing a held row; hygiene (no past dates, no exact points, no status words, `ride_id` null unless booked, exact column list).
- [ ] **Step 2: Push; confirm failures.**
- [ ] **Step 3: Implement** the three RPCs per spec section 4 and `my_invitations` per section 5.
- [ ] **Step 4: Push; CI green.**
- [ ] **Step 5: Commit** `feat(m-27): accept, decline, withdraw and my_invitations`.

### Task 4: Blocks, suspension, deletion

**Files:**
- Modify: `supabase/migrations/0017_invitations.sql`
- Create: `supabase/tests/account_deletion_invitations_test.sql`
- Test: `supabase/tests/invitations_test.sql` (groups 13–14)

**Interfaces:**
- Consumes: `close_invitations`; 0011's `withdraw_member`; 0010's `profiles_apply_deletion_policy`.
- Produces: trigger `blocks_close_invitations` on `public.blocks`; replaced `withdraw_member(uuid)` and `profiles_apply_deletion_policy()`.

- [ ] **Step 1: Write the failing tests:** a block (each direction) closes pending, accepted and held rows of the pair, hides them from both and refuses every action; unblocking restores nothing; suspension closes pending, accepted invites and held rows, hides the rest, and empties the suspended member's view; deletion test per spec section 10 (delete succeeds; no-ride invitations gone both ways; the ride's invitation kept with the passenger's pickup area cleared; the others' views and counts; actions on the kept row `unavailable`).
- [ ] **Step 2: Push; confirm failures.**
- [ ] **Step 3: Implement** the trigger, and the two `create or replace` functions copied from 0011 and 0010 with only the additions in the spec's build notes.
- [ ] **Step 4: Push; CI green across every suite.**
- [ ] **Step 5: Commit** `feat(m-27): close invitations on block, suspension and deletion`.

### Task 5: Generated types

- [ ] **Step 1:** Download the green run's `database-types` artifact: `/opt/homebrew/bin/gh run download <run-id> -R ethanterrero/merge -n database-types -D <scratch>`.
- [ ] **Step 2:** Copy it to `apps/mobile/src/lib/database.types.ts`, commit `chore(db): regenerate database types`, push, and confirm the `database` job (including its types diff) passes.
