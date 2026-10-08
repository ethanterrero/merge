# Blocks and safety reports — design (M-06, data side)

**Date:** 2026-10-08
**Status:** Decisions made by the owner on 2026-10-08
**Scope:** `supabase/migrations/0005_blocks_reports.sql`, `supabase/tests/blocks_reports_test.sql`
**Builds on:** `0003_first_ride.sql` (`connections`, `commute_crews`, `resolve_connection`).
Does not depend on 0004.

The "Block or report" button on the match detail screen needs two tables and one
helper that later features call. App UI, email alerts to safety@, enforcement inside
matching / invitations / messages / profile cards / contact sharing (those call
`is_blocked`), and account-deletion cascades (0007) are out of scope.

## Decisions

1. **Blocks are a hard filter both ways, silently.** The blocked person is never told,
   can't read the block, and can't detect it through any table or function they can
   reach.
2. **A block ends Ride Again and any open Crew.** Inserting a block deletes the pair's
   `connections` row and sets the pair's `proposed` / `active` / `paused` Commute Crew
   to `ended` with `ended_at = now()`, exactly as `resolve_connection` does on a "no".
   The blocked person sees Ride Again quietly disappear, the same as a "no".
   `ended` and `not_started` Crews are left alone.
3. **Unblocking restores nothing.** Deleting a block only removes the row.
4. **Reporters can't read reports back,** including their own. Merge staff read them in
   the Supabase dashboard (service role). No moderation UI.
5. **Report categories:** `unsafe_driving`, `harassment`, `no_show`,
   `vehicle_identity_mismatch`, `other`.
6. **Safety reports never live with ride feedback.** Separate table, no link to
   `ride_feedback`.

Pairs are stored and compared exactly as in 0003: `user_low = least(a, b)`,
`user_high = greatest(a, b)`, open Crew statuses `proposed`, `active`, `paused`.

## `blocks`

| Column | Type | Notes |
| --- | --- | --- |
| `blocker_id` | uuid not null, references `profiles` | `= auth.uid()` on insert |
| `blocked_id` | uuid not null, references `profiles` | |
| `created_at` | timestamptz not null default `now()` | server-set (clients can't write the column) |

- Primary key `(blocker_id, blocked_id)`; `check (blocker_id <> blocked_id)`.
- **Duplicate block is rejected** (`unique_violation` from the primary key). A client
  that wants idempotency inserts with `on conflict do nothing` (supabase-js
  `upsert(..., { ignoreDuplicates: true })`); that path is tested. Rejection only ever
  reaches the blocker, who already knows about their own block. Blocking someone who
  already blocked you is a different key, so it succeeds normally and reveals nothing.
- RLS: the blocker can select, insert and delete their own rows (`blocker_id =
  auth.uid()`). No update policy (nothing to change). Privileges: anon has none;
  authenticated has `select`, `delete`, and `insert` on `(blocker_id, blocked_id)`
  only; `update`, `truncate`, `references`, `trigger` are revoked.
- Index on `blocked_id` ("who blocked me" lookups in matching, and the 0007 cascade).
  `is_blocked` itself is served by the primary key in both directions.

## `safety_reports`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk default `gen_random_uuid()` | server-generated |
| `reporter_id` | uuid not null, references `profiles` | `= auth.uid()` on insert |
| `reported_user_id` | uuid null, references `profiles` | `<> reporter_id` |
| `ride_id` | uuid null, references `rides` | must be a ride the reporter was on |
| `category` | text not null, check in the five categories | |
| `details` | text null, at most 4000 characters | |
| `created_at` | timestamptz not null default `now()` | server-set |

- RLS: one insert policy for `authenticated` (`reporter_id = auth.uid()`, and `ride_id`
  null or a ride where the reporter is driver or passenger). No select / update /
  delete policies, and those privileges are revoked too (plus `truncate`,
  `references`, `trigger`), so default-deny never carries the load alone. anon has no
  privileges. Insert is granted on the five client columns only.
- Because nobody but the service role can select, clients insert without `returning`
  (supabase-js `insert()` without `.select()`, i.e. `Prefer: return=minimal`). The app
  work should confirm this against the hosted PostgREST; if it ever needs a returned
  value, the fallback is a `security definer` RPC returning `void`, not a select policy.
- Staff read with the service role, which bypasses RLS.
- Indexes on `reporter_id` and `reported_user_id` (staff lookups, 0007 cascades).
- No rate limit on reports here; invitations' rate limiting is a separate task.

## `public.is_blocked(a uuid, b uuid) returns boolean`

`security definer`, `stable`, `search_path = ''`. True if either person has blocked the
other; false for nulls or `a = b`.

**Execute is revoked from `public`, `anon` and `authenticated`.** If clients could call
it, the blocked person could call `is_blocked(me, x)` and learn of the block. It is
called only by other `security definer` functions and triggers (which run as the
migration role, the owner) and by the service role, which keeps execute through
Supabase's default privileges. Consequence for later work: it can't appear in an RLS
policy or view that evaluates as the client role. Matching, invitations, Crews,
messages, profile cards and contact sharing filter blocked pairs inside their own
`security definer` RPCs (matching is server-side anyway).

## Keeping a blocked pair disconnected

A later `ride_feedback` change fires `resolve_connection`, which could re-create the
connection from the pair's earlier yes/yes. 0005 does **not** redefine
`resolve_connection` (a copy would silently revert future changes to it). Instead a
`before insert or update` trigger on `public.connections`
(`connections_skip_blocked`, `security definer` so it can call `is_blocked`) returns
`null` when `is_blocked(user_low, user_high)`: the write is silently skipped, so
`resolve_connection`'s upsert neither raises nor connects the pair. In an upsert the
`before insert` trigger fires first, so the row never reaches the conflict check.
Every future writer of `connections` gets the same guard. `propose_crew` requires a
Crew-eligible connection, so it fails for a blocked pair with the same error as for
any pair without one (42501), which reveals nothing.

Race: the block trigger (`blocks_end_pair`) and the connections guard both take a
transaction-scoped advisory lock on the pair (`pg_advisory_xact_lock` on a hash of
`user_low:user_high`) before reading, so a block and a concurrent feedback change
serialize; whichever commits second sees the other (each statement after the lock
takes a fresh snapshot under the default read committed isolation). A hash collision
only serializes two unrelated pairs.

## Foreign keys

No on-delete action on any reference to `profiles` or `rides`, matching 0003. Both a
blocker's and a blocked person's account deletion must remove blocks, and reports may
need to outlive an account for safety review; 0007 decides both.

## Testing — `supabase/tests/blocks_reports_test.sql`

- Blocker CRUD on own blocks; the blocked person sees zero rows, can't delete or update
  the row, can't call `is_blocked`, and can block back normally.
- No self-block; duplicate rejected with `unique_violation`, and `on conflict do
  nothing` succeeds without a second row; `blocker_id` must be the caller; clients
  can't set `created_at`.
- `is_blocked` both directions, nulls, self; execute privileges (anon and
  authenticated can't, and calling it as authenticated raises 42501).
- A report per category; `reporter_id` must be the caller; `ride_id` must be the
  reporter's ride; no self-report; details length; the reporter can't select / update /
  delete (privilege checks plus attempted statements); anon can't insert either table.
- A block deletes the connection and ends proposed / active / paused Crews (blocker as
  `user_low` and as `user_high`), leaving `ended` / `not_started` Crews and other pairs
  alone.
- A later yes/yes feedback change (an edit and a new ride) doesn't reconnect a blocked
  pair and doesn't raise; a direct write to `connections` is skipped; `propose_crew`
  fails both ways; unblocking restores nothing.
- `profiles_test.sql` and `first_ride_test.sql` keep passing.

## Open for the owner

- Unblocking restores nothing *immediately*, but the pair's old feedback is still
  there: after an unblock, any later edit of either person's feedback on a shared ride
  re-runs `resolve_connection` and can bring Ride Again back from the old yes/yes.
- Pending invitations and confirmed future rides between a blocked pair are untouched
  here; the invitations / booking work is expected to cancel or filter them.
- A foreign-key error on `blocked_id` / `reported_user_id` tells the caller whether a
  profile id exists. Ids are random uuids the client only learns from matches, so this
  is accepted.
