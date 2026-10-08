# Account deletion — data policy (M-17a)

**Date:** 2026-10-08
**Status:** D-15 decided by the owner on 2026-10-08. This spec records it.
**Scope:** `supabase/migrations/0010_account_deletion.sql`, `supabase/tests/account_deletion_test.sql`
**Builds on:** `*_initial.sql`, `*_first_ride.sql`, `*_vehicles_commutes_rls.sql`, `*_blocks_reports.sql`, `*_commute_privacy.sql`

This is the data half of in-app account deletion, a pilot blocker under App Store
guideline 5.1.1(v). M-17b adds the Edge Function that deletes the `auth.users` row and
the app entry point. M-40 adds the web deletion-request page.

## Decisions (D-15)

1. Delete everything the person owns.
2. Keep shared rides for the other rider. The deleted person is shown as "Former member".
3. End open Commute Crews.
4. Keep safety reports for 12 months with the deleted person's reference cleared.
5. No hashed email (or any other identifier) of a deleted person is kept. The owner adds
   every tester by hand, so re-registration is already controlled (closes M-11 Q9).
6. Blocks involving a deleted person are deleted, whichever side they were on (closes Q9).
7. End of pilot (Q10): deleting every `auth.users` row now works and applies this policy.
   What survives is de-identified safety reports, which age out under rule 4.

## Deletion policy

Every migration that adds a table or a foreign key follows this section. You shouldn't
need to read 0010's code to follow it.

### How a deletion runs

M-17b deletes the person's `auth.users` row with the service role. Everything else follows
inside that one statement:

1. `profiles.id` references `auth.users` with `on delete cascade`, so the profile is deleted.
2. A `before delete` trigger on `profiles` (`profiles_apply_deletion_policy`, `security
   definer`) does the work a foreign key can't express (below).
3. The foreign keys that reference `profiles` then cascade or set null.

The same happens if staff delete a `profiles` row directly. Nothing is soft-deleted.

### Kinds of data

| Kind | Examples | On delete | What the other person sees |
| --- | --- | --- | --- |
| **Owned:** one person's data, or a link that only makes sense while both people exist | profile, vehicles, commutes, ride feedback, blocks (either side), connections, invitations with no ride, and later contact details, contact offers, push tokens, messages they wrote | `on delete cascade` on the reference to `profiles` | It's gone. Ride Again and a block disappear the same way they do after a "no" or an unblock. |
| **Shared:** a record of something two people did together | rides, invitations that led to a ride, Commute Crews | The person's column is nullable, `on delete set null` | The row stays. A null counterpart is shown as **"Former member"**. |
| **Safety:** kept for safety follow-up | safety reports | The person's columns are nullable, `on delete set null`, and the row is stamped `account_deleted_at` | Nobody but staff reads reports. |
| **Child of a shared record:** rows hanging off a shared record | ride feedback (by `ride_id`), and later messages on a ride | `on delete cascade` from the parent record; `on delete set null` if the child is a safety record | Goes with the parent. |

The rules that need more than a foreign key, done by `profiles_apply_deletion_policy`:

- **Confirmed rides that haven't happened are cancelled.** A `confirmed` ride whose
  pickup (ride date + pickup time, Pacific time) is still in the future becomes
  `cancelled`. Past `confirmed` rides are left alone: they may have happened, and ride
  completion (D-01, M-37) decides that.
- **Open Crews end.** `proposed`, `active` and `paused` Crews become `ended` with
  `ended_at = now()`, as a "no" or a block does. `ended` and `not_started` Crews keep
  their state.
- **Invitations with no ride are deleted**, whatever their status and whichever side
  sent them. An invitation that led to a ride is part of the ride's record and stays.
- **A shared record with nobody left is deleted.** When the second person of a ride or a
  Crew is deleted, there's no one to keep it for: the ride (with its feedback and
  invitation) or the Crew is deleted. Safety reports that pointed at that ride keep the
  report and clear `ride_id`.

### What the other person sees

- A ride, invitation or Crew whose counterpart column is null belongs to a **Former
  member**. The client renders the null as "Former member", with no name, photo,
  vehicle or contact details. There's no placeholder profile.
- A future ride with a Former member shows as cancelled.
- Ride Again and any open Crew end. Their own feedback stays theirs.
- Nothing tells them why. Deletion, a block and a "no" look alike where they overlap.

### Rules for later tasks

1. **Every foreign key to `profiles` or `auth.users` is `on delete cascade` or `on delete
   set null`.** Pick by the table above. `no action`, `restrict` and `set default` are
   not allowed. The same goes for foreign keys to the tables an account deletion
   deletes from: `vehicles`, `commutes`, `rides`, `commute_crews`, `invitations`. The one
   exception is `rides.invitation_id` (`no action`), which stops an invitation from being
   deleted while its ride exists. `account_deletion_test.sql` checks this for every
   table in the schema, so a new key without an action fails CI.
2. **A `set null` column must be nullable.** If the value is required when the row is
   created, enforce it with the `require_on_insert` trigger, for example
   `create trigger x_require_on_insert before insert on public.x for each row execute
   function public.require_on_insert('sender_id', 'recipient_id');`. The test checks
   nullability too.
3. **Shared records need the "nobody left" and "can't happen now" rules.** If your table
   is shared and needs more than a foreign key (deleting an orphaned row, cancelling a
   future one), `create or replace` `profiles_apply_deletion_policy`, starting from its
   latest definition in the highest-numbered migration that defines it, and keep every
   step already there.
4. **Index every column a deletion cascade or set-null scans** (each foreign key column
   to `profiles`, `rides`, `commutes`, `commute_crews` and `invitations`), unless an
   existing index already leads with it.
5. **Add `supabase/tests/account_deletion_<slug>_test.sql`** with its own fixture: give a
   user rows in your new tables (and a counterpart, if the data is shared), delete the
   user from `auth.users`, check that the delete succeeds, and check that the other
   person's rows match this policy.
6. **Update the data inventory** (`docs/privacy/data-inventory.md`) "On account deletion"
   column for your new data.

## Table by table

| Table | Column | On delete | Notes |
| --- | --- | --- | --- |
| `profiles` | `id` → `auth.users` | cascade | unchanged (0001) |
| `vehicles` | `owner_id` | cascade | unchanged (0001) |
| `commutes` | `owner_id` | cascade | unchanged (0001); the vehicle key sets `vehicle_id` null (0004) |
| `invitations` | `sender_id`, `recipient_id` | set null, now nullable | invitations with no ride are deleted by the trigger first |
| `invitations` | `commute_id` | set null, now nullable | also lets a person delete a commute that has invitations, which used to fail |
| `invitations` | `crew_id` | set null | a Crew is deleted only when both members are gone |
| `rides` | `driver_id`, `passenger_id` | set null, now nullable | "Former member"; a future confirmed ride is cancelled; deleted when both are gone |
| `rides` | `invitation_id` | no action | unchanged; deliberate (rule 1) |
| `ride_feedback` | `author_id` | cascade | owned |
| `ride_feedback` | `ride_id` | cascade | child of the ride |
| `connections` | `user_low`, `user_high` | cascade | owned link |
| `commute_crews` | `user_low`, `user_high`, `proposed_by` | set null, now nullable | open Crews end first; deleted when both are gone |
| `blocks` | `blocker_id`, `blocked_id` | cascade | D-15 rule 6 |
| `safety_reports` | `reporter_id`, `reported_user_id` | set null, `reporter_id` now nullable | stamped `account_deleted_at`; kept per retention below |
| `safety_reports` | `ride_id` | set null | the ride may be deleted when both riders are gone |

`rides`, `invitations`, `commute_crews` and `safety_reports` still require their people
on insert (`require_on_insert`), so making the columns nullable doesn't let new rows in
without them.

The "can't report yourself" check on `safety_reports` changes from
`reported_user_id is distinct from reporter_id` to `reported_user_id <> reporter_id`. The
old form rejected a report whose reporter and reported person had both been deleted
(null is not distinct from null), which would have made the second deletion fail. It
still rejects a self-report.

### Connections stay consistent with feedback

`ride_feedback_resolve_connection` (0003) fired only on insert and update. It now also
fires on delete, so any feedback delete (cascaded from an account or a ride, or by staff)
recomputes the pair's connection from the feedback that remains. For the deleted person
that means no connection, which the cascade on `connections` also removes.

### Indexes

Added for the deletion cascades (hosted advisor findings): `invitations.sender_id`,
`recipient_id`, `commute_id`, `crew_id`; `commute_crews.proposed_by`;
`safety_reports.ride_id`. They use `create index if not exists`, so M-27 doesn't need to
add its own on the same columns.

## Safety report retention

- `safety_reports.account_deleted_at` (server-set; clients can't write it) records when a
  reporter or reported person's account was deleted. A trigger sets it whenever either
  reference changes to null.
- `public.purge_expired_safety_reports()` deletes reports 12 months after the later of
  `created_at` and `account_deleted_at`, and returns how many it deleted. That keeps every
  report at least 12 months from filing and at least 12 months from the deletion, which
  satisfies D-15 under either reading of "kept 12 months". Clients can't call it. Staff
  or a scheduled job run it with the service role (scheduling it is an owner task, see
  below).
- `details` is free text and may name the deleted person. It's kept as written; staff
  shouldn't copy identifiers out of it.

## Out of scope

- **`auth.audit_log_entries`** (sign-in trail with email and IP) has no foreign key to
  `auth.users`, so the cascade doesn't touch it. M-17b's Edge Function purges the
  person's rows after deleting the user. Not done here: migrations don't own the `auth`
  schema.
- The Edge Function, app UI (M-17b), the web request page (M-40), third-party data
  (Sentry, the SMTP provider, Expo), admin tools.
- Scheduling `purge_expired_safety_reports()` (pg_cron or the Edge Function). The owner
  decides how it runs.
- `docs/privacy/data-inventory.md` §9 still reads "proposed". Its owner order is M-11 →
  M-31 → M-55a, so the update to "decided, implemented in 0010" lands with the next of
  those.
- `apps/mobile/src/lib/database.types.ts`: there's no CI types artifact yet (M-03), so it's
  regenerated by the owner after the push, as for 0008 and 0009.

## Follow-ups for later tasks

- **M-27 (invitations):** `sender_id`, `recipient_id` and `commute_id` are nullable. An
  invitation with a null party is history with a Former member, never actionable.
- **M-32 (booking):** new ride columns that name a person (`cancelled_by`,
  `disputed_by`) are `on delete set null`. The trigger already cancels future confirmed
  rides; if M-32 records who cancelled, it extends `profiles_apply_deletion_policy`.
- **M-39 (messages):** a person's messages are owned (cascade on the author). The
  thread's `ride_id` cascades with the ride. Q8 (keeping messages attached to safety
  reports) is still open there.
- **M-55a (contact sharing), M-38 (push tokens):** owned, cascade.
- **M-56 (member status):** any column or table that names a member or the staff member
  who acted follows rule 1. No suspension record survives deletion (D-15 rule 5).
- **M-16 / M-26 (profile cards, matching):** render a null counterpart as "Former member".

## Testing — `supabase/tests/account_deletion_test.sql`

Fixture: Ada (deleted) has a profile, a vehicle and both commute rows, invitations both
ways (pending, declined, crew-originated, and four that led to rides), completed rides
both ways, a future and a past confirmed ride, feedback, a Crew-eligible connection, an
active and an ended Crew, blocks both ways, and safety reports by her and about her. Dan
is deleted first, so Ada also has a ride, invitation and Crew whose other side is already
gone. Eve and Fay are an unrelated pair whose rows must not change.

It checks:

1. Every foreign key into the deletable tables has an allowed action, and every set-null
   column is nullable (rule 1 and 2, for the whole schema).
2. Deleting Dan, then Ada, from `auth.users` succeeds.
3. No row in any table references Ada afterwards (every foreign key to `profiles`).
4. Bea's rides, invitations, feedback and Crews match the policy, and she can still read
   her rides and Crews as a client.
5. The rows with nobody left are deleted. Unrelated rows are unchanged.
6. Safety reports are kept with references cleared and stamped.
7. Connections equal what `resolve_connection` computes from the remaining feedback.
8. A staff delete of feedback recomputes the connection (both directions: connect and
   disconnect).
9. The required-on-insert columns still reject nulls.
10. `purge_expired_safety_reports()` deletes only expired reports.
11. Clients can't execute the new functions or write `account_deleted_at`.
