# Member status and the public-name helper — design (M-56)

**Date:** 2026-10-08
**Status:** Built on the owner's decisions D-06 and D-07 (both Decided 2026-10-08)
**Scope:** `supabase/migrations/0011_member_status.sql`, `supabase/tests/member_status_test.sql`
**Builds on:** `0003_first_ride.sql` (`invitations`, `rides`, `commute_crews`,
`connections`, `resolve_connection`, the Crew RPCs), `0005_blocks_reports.sql`
(`connections_skip_blocked`, the pattern for server-only helpers), `0010_account_deletion.sql`
(M-17a: deletion cascades and `profiles_apply_deletion_policy`), rebased onto it.

The owner needs to remove someone from the pilot and to mark drivers as vetted, and
every screen that shows a name to someone else needs one rule for how that name looks.
Today the only removal tool is a Supabase Auth ban, which stops new sign-ins but
leaves the app's current session working and leaves the database unaware: the
person's commute would still match, their pending invitations and rides would still
stand. App UI, the Auth ban itself (the owner does it in the dashboard), moderation
tools and blocks (M-06) are out of scope.

## Decisions

1. **Vetting (D-06).** The owner vets each driver (license and insurance, seen in
   person or on video) and sets `profiles.vetted_at`. No documents are stored. Only
   the server writes the flag. The badge copy, for the tasks that show it (M-16,
   M-49), is "License & insurance checked by Merge". This task builds only the flag
   and the helper; whether vetting gates driving is applied (if the owner confirms
   it) by matching (M-26) and booking (M-32).
2. **Removal (D-07).** The owner checks reports daily and replies within 24 hours.
   Removal is: set `profiles.suspended_at`, then ban the user in Supabase Auth.
   Setting `suspended_at` hides the person everywhere, withdraws their pending
   invitations, cancels their future rides (the other rider sees only "Ride
   cancelled") and ends their Crews.
3. **A suspended person's own app shows nothing special.** No "Your pilot access is
   paused" state in the pilot; the owner contacts them directly, and the Auth ban
   ends their access once the session expires. (Brainstorming default, taken.)
4. **Suspension hides the person from everyone, including people they already rode
   with.** (Brainstorming default, taken; it's also what D-07 says.)
5. **Names are derived server-side only.** `display_name` stays free text (2–40
   characters); nothing is enforced at save time. Every path that shows a name to
   someone else returns `public_name(display_name)`, never `display_name`. The
   Profile screen (M-30) mirrors the rule in a client preview so people see what
   others will see. (Brainstorming default, taken.)
6. **Clearing `suspended_at` restores nothing.** Withdrawn invitations, cancelled
   rides, ended Crews and deleted connections stay as they are.

## Columns on `public.profiles`

| Column | Type | Meaning |
| --- | --- | --- |
| `suspended_at` | timestamptz null | Set: removed from the pilot. Any non-null value counts, including one in the future. |
| `vetted_at` | timestamptz null | Set: the owner checked this driver's license and insurance. |

Both are nullable with no default, so the hosted table needs no backfill.

### Only the server writes them

A `before insert or update` trigger, `profiles_guard_status`, raises 42501 when the
current role is `anon` or `authenticated` and the statement would set either column
on insert or change it on update (`is distinct from`). Writing the column's current
value, or not mentioning it, is allowed, so the app's upsert of `(id, display_name,
role)` keeps working for a vetted member. The service role, the dashboard and the SQL
editor are other roles and pass.

The trigger is deliberately **not** `security definer`: it reads `current_user`, which
must be the caller's role. A `security definer` RPC runs as its owner, so it also
passes; such RPCs are server code and must never copy a client-supplied value into
either column.

A trigger rather than column privileges because 0002 grants the table to
`authenticated` and later tasks (M-30, M-49) add client-editable profile columns:
column grants would make every one of those tasks remember a `grant update (col)`.

Members can still read both columns on their own row (the 0002 select policy). A
vetted driver seeing their own `vetted_at` is fine; a suspended member seeing
`suspended_at` tells them nothing the owner isn't telling them directly.

## Helpers

### `public.is_active(uid uuid) returns boolean`

`security definer`, `stable`, `search_path = ''`. True when a profile with that id
exists and `suspended_at is null`; false for null, an unknown id, or a suspended
member.

### `public.is_vetted(uid uuid) returns boolean`

Same shape. True when the profile has `vetted_at` set **and** is active. A suspended
driver is never vetted, so a caller that checks only `is_vetted` can't let them
through. Suspension doesn't clear `vetted_at`.

**Execute on both is revoked from `public`, `anon` and `authenticated`**, as with
`is_blocked` (0005): a client could otherwise learn who is suspended, or probe whether
an id exists. They're called by later `security definer` RPCs and triggers (which run
as the migration role) and by the service role. Consequence for later work: neither
can appear in an RLS policy or a view evaluated as a client role. Every place two
people meet filters inside its own `security definer` function with both
`public.is_active(other)` and `not public.is_blocked(me, other)`:

| Task | Where |
| --- | --- |
| M-16 | profile cards |
| M-26 | `find_matches` (plus `is_vetted` for drivers, if D-06's gate is confirmed) |
| M-27 | sending and answering invitations |
| M-32 | booking (plus `is_vetted` for the driver, if confirmed) |
| M-39 | messages |
| M-55a | contact sharing |

### `public.public_name(display_name text) returns text`

`immutable`, `parallel safe`, `search_path = ''`, not `security definer`. Execute is
granted to `authenticated` (it's a pure formatting rule) and revoked from `anon`.

1. Trim leading and trailing whitespace; split the rest on runs of whitespace.
2. Null, empty or all-whitespace input returns null.
3. One word: return it as typed (`'Priya'` → `'Priya'`).
4. Two or more words: the first word, a space, the first letter or digit of the
   **last** word upper-cased, and a period. `'Priya Sharma'` → `'Priya S.'`,
   `'Priya Devi Sharma'` → `'Priya S.'`, `'priya sharma'` → `'priya S.'`,
   `'Priya S.'` → `'Priya S.'`, `'Mary-Jane O''Neil'` → `'Mary-Jane O.'`,
   `'Priya (Sharma)'` → `'Priya S.'`.
5. If the last word has no letter or digit (`'Priya ...'`, an emoji), the result is
   the first word alone.

Letters are classified by the database's `LC_CTYPE` (UTF-8 in CI and on hosted
Supabase), so `'Zoë Ångström'` → `'Zoë Å.'`. Under a plain `C` ctype, non-ASCII
surnames would lose their initial: a safe failure, since it shows less.

Known limits, accepted for the pilot: a name typed surname-first (`'Sharma, Priya'`)
shows the surname (`'Sharma, P.'`); a hyphenated single word (`'Priya-Sharma'`) is
shown whole. M-30's preview is how a member catches either.

**Every path that shows a name to someone else uses it**: profile cards (M-16),
matching (M-26), invitations (M-27), booking and ride screens (M-32), messages (M-39),
notifications (M-45). Those return `public_name(p.display_name)` from their
`security definer` functions; no client ever reads another member's `display_name`.
The member's own screens may show their own `display_name`.

## Removal: what setting `suspended_at` does

`profiles_withdraw_suspended`, an `after update of suspended_at` trigger with
`when (old.suspended_at is null and new.suspended_at is not null)`, calls
`public.withdraw_member(new.id)`. Changing one timestamp to another, or clearing it,
does nothing. A profile inserted already suspended has nothing to withdraw.

`public.withdraw_member(uid uuid) returns void` (`security definer`, `search_path =
''`, execute revoked from clients) locks the profile row (`for no key update`) and
then, in this order:

1. **Invitations:** every `pending` invitation the member sent or received becomes
   `cancelled`. Accepted, declined, expired and cancelled ones are left alone.
2. **Connections:** every Ride Again connection the member is in is deleted.
3. **Crews:** every `proposed`, `active` or `paused` Crew the member is in becomes
   `ended` with `ended_at = now()`, as `resolve_connection` does on a "no". `ended`
   and `not_started` Crews stay. Connections go first so a concurrent
   `propose_crew` (which holds the connection `for share`) either finishes first and
   has its new Crew ended here, or runs after and finds no connection.
4. **Rides:** every `confirmed` ride the member is driver or passenger on, dated today
   or later in America/Los_Angeles (the pilot's zone, as ride dates are), becomes
   `cancelled`. Today's ride is cancelled even if its pickup time has passed.
   Completed rides, and confirmed rides dated before today (awaiting completion,
   D-01), stay. M-32 adds a cancel reason; it should record these as safety
   cancellations. The other rider sees the ride as cancelled, with no reason.

It's a separate function so later server code can run the same withdrawal.

### Keeping a suspended member disconnected

As with blocks, a later `ride_feedback` change re-runs `resolve_connection`, which
would upsert the pair's connection from an old yes/yes. 0011 doesn't redefine
`resolve_connection`. A `before insert or update` trigger on `connections`,
`connections_skip_suspended` (`security definer`), first takes `for share` row locks on
both members' profiles, then returns null (skipping the write silently) unless both
are `is_active`. It sorts after `connections_skip_blocked`, so it only runs for
unblocked pairs. `propose_crew` needs a connection, so it fails with its usual 42501
for either side.

Race: suspension updates the profile row, so it holds a row lock that conflicts with
`for share`. A concurrent connection write either takes its share lock first (and the
suspension's delete, a later statement, sees and deletes the new row) or waits for the
suspension to commit and then, in a fresh snapshot, sees `suspended_at` and skips.

Once `suspended_at` is cleared, the guard lifts: nothing is restored, but a later
yes/yes feedback edit, or the owner, can connect the pair again.

### Not covered yet (the tables don't support it today)

- **Creating new invitations or rides.** No client writes either table yet (default
  deny). M-27 and M-32 must refuse a suspended sender, recipient, driver or passenger
  with `is_active`, after locking both profiles `for share` as the connections guard
  does, so they serialize with a suspension.
- **Safety cancellation reason.** M-32 adds the column and should set it for rides
  cancelled by `withdraw_member` (update the function, copying its latest definition).
- **Hiding from history.** Past rides and ended Crews keep the member's id. Screens
  that render them (M-16, M-32) resolve names and cards through `is_active`, so a
  suspended member's card isn't shown; how history reads ("A past rider") is theirs to
  design.

## Account deletion (M-17a, 0010)

- 0011 adds two columns on `profiles` and no table or foreign key, so suspension and
  vetting go with the profile row when the account is deleted, and 0010's
  schema-wide foreign-key rule is unaffected. No record of a removal outlives the
  account (D-15 keeps no identifier of a deleted person).
- 0010's `profiles_apply_deletion_policy` already cancels future rides and ends open
  Crews on deletion, so deletion doesn't call `withdraw_member`. The two differ on
  purpose in one place: deletion cancels confirmed rides whose pickup time is still
  ahead; suspension cancels every confirmed ride dated today or later, even if today's
  pickup has passed.
- Sign-ups are off (D-11) and the owner adds each tester by hand, so the owner, not
  the database, prevents a removed member who deleted their account from coming back.
- A deletion path that writes `profiles` runs as the owner and passes the guard; it
  must not copy client values into `suspended_at` or `vetted_at`.
- `supabase/tests/account_deletion_member_status_test.sql` deletes a suspended member
  (with a withdrawn invitation, a cancelled ride, a deleted connection and an ended
  Crew shared with another member) and a vetted driver, then checks that no profile and
  no row in any table with a foreign key into `profiles` still names either of them,
  and that the other member keeps the cancelled ride and ended Crew as "Former member".

## Testing — `supabase/tests/member_status_test.sql`

- Privileges: clients can't execute `is_active`, `is_vetted`, `withdraw_member` or
  the trigger functions; `authenticated` can execute `public_name` and `anon` can't;
  the helpers are `security definer` and the guard isn't. Calling `is_active` or
  `is_vetted` as `authenticated` raises 42501.
- A client can't insert its profile with either flag set, can't set, clear or move
  either flag on its own row (filtered, unfiltered, through an upsert), and a
  suspended member can't clear their own suspension. Explicit nulls on insert, the
  app's upsert and writing a flag's current value still work.
- `is_active` / `is_vetted` for active, suspended, vetted, unvetted, null and unknown
  ids; a suspended member with `vetted_at` set isn't vetted, and keeps `vetted_at`.
- `public_name` for every case listed above, plus null, empty and whitespace.
- Suspension: pending invitations both ways become cancelled (accepted, declined and
  another pair's pending stay); confirmed rides today and later become cancelled
  (completed, past-dated confirmed and another pair's stay); all connections deleted
  (another pair's stays); proposed / active / paused Crews ended now with the member as
  `user_low` and `user_high` (ended, not_started and another pair's stay).
- After suspension, a feedback edit doesn't reconnect and doesn't raise, a direct
  connection write is skipped, and `propose_crew` fails both ways. Clearing the
  suspension restores nothing, and afterwards a connection can be written again.
- `profiles_test.sql`, `first_ride_test.sql` and `blocks_reports_test.sql` keep
  passing.

The shim's `auth.users` has no `banned_until`, so the Auth ban itself can't be tested
in CI; the database flag is what the tests prove.

## Open for the owner

None blocking. The one carried-over suggestion is D-06's: whether an unvetted person
may appear as a driver in discovery or confirm a ride as the driver. That's for M-26
and M-32 to confirm with the owner; `is_vetted` is ready for either answer.
