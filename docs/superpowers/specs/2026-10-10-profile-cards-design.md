# Limited profile cards for related users — design (M-16)

**Date:** 2026-10-10
**Task:** M-16
**Status:** Approved by the owner on 2026-10-10, with all six owner questions
answered as recommended (see [Owner questions](#owner-questions)). Built in
`supabase/migrations/0014_profile_cards.sql`.
**Scope:** `supabase/migrations/0014_profile_cards.sql`,
`supabase/tests/profile_cards_test.sql`, `apps/mobile/src/lib/database.types.ts`
(CI artifact only). The backlog card plans 0009, which `0009_east_bay_neighborhoods.sql`
already uses, so this task takes 0014. M-26 takes 0015.
**Builds on:** `0002_profiles_rls.sql` (owner-only profiles), `0003_first_ride.sql`
(`invitations.ride_date`, `rides`, `connections`, `commute_crews`),
`0005_blocks_reports.sql` (`is_blocked`), `0008_commute_privacy.sql`
(`profiles.ride_prefs`), `0010_account_deletion.sql` (nullable participant columns,
"Former member"), `0011_member_status.sql` (`is_active`, `vetted_at`, `public_name`).

## Purpose

Since 0002, each person can read only their own `profiles` row. The driver inbox
(M-36), invitations (M-27), rides and Booked (M-43, M-47), Ride Again (M-44) and
Commute Crew (M-48) all need to show the other person's name, role and badges. This
task adds one server function that returns a short, fixed **card** for people the
caller already has a relationship with, and nothing for anyone else.

Success means:

- a client can turn a list of member ids it already holds (from its own rides,
  invitations, connections or Crews) into cards in one call;
- a card never contains a raw `display_name`, a timestamp, a location or any field
  beyond the ones allowed before confirmation;
- a blocked pair, a suspended member, a deleted member, an unrelated user and anon
  all get the same thing: no row, and no error that tells the cases apart.

App changes, discovery (M-26 returns its own limited fields), trust stats (M-49) and
the name rule itself (M-56) are out of scope.

## Decisions

The ones marked **(Q)** were owner questions, approved as recommended on 2026-10-10
(see [Owner questions](#owner-questions)). The rest follow from Decided rows or from the
privacy invariants.

1. **One card, before and after confirmation (Q4).** The card has the same five
   fields whether or not the pair has a confirmed ride. What a confirmed ride
   reveals is ride-scoped and belongs to the function that owns that ride's data:
   vehicle make, model, color and plate, the exact pickup spot and note (M-32,
   booking), contact details (M-55a, D-19) and messages (M-39, D-13). Photo, bio,
   employer and interests are deferred (owner exclusion, "Richer profiles").
2. **Fields:** `id`, `public_name`, `role`, `ride_prefs` **(Q1)**, `vetted`.
   - `public_name` is `public.public_name(p.display_name)`. The raw `display_name`
     never leaves the function (M-56 decision 5).
   - `role` is `profiles.role` (`driver`, `passenger` or `both`).
   - `ride_prefs` is `profiles.ride_prefs` (`quiet`, `smoke_free`; no gender data,
     D-05). The invariant allows ride preferences before confirmation, and
     `docs/mvp.md` says they show on cards.
   - `vetted` is a boolean, `p.vetted_at is not null`, never the timestamp (D-06).
     The client shows D-06's badge copy, "License & insurance checked by Merge".
3. **No areas on the card (Q2).** Areas belong to a commute, not to a person, and a
   member may have two commutes (driver and passenger). The function that knows
   which commute is in play returns its area label: `find_matches` (M-26), the
   invitation and inbox reads (M-27, M-36) and booking (M-32). A card that carried
   areas would hand every past contact all of a person's current areas, forever.
4. **"Related" means any of these rows exists between the caller and the other
   person, in any status:**
   - an invitation either sent or received (`pending`, `accepted`, `declined`,
     `expired` or `cancelled`) **(Q3)**;
   - a ride, as driver or passenger (`confirmed`, `completed` or `cancelled`);
   - a Ride Again connection;
   - a Commute Crew (any status).

   Status-blind on purpose. If a declined invitation stopped unlocking the card
   while an expired one didn't, the card would reveal the "no" (invariant, D-16,
   D-22). If a deleted connection hid the card, it would reveal a post-ride "no".
   In practice a ride always exists behind a connection or a Crew, so card
   visibility never moves when feedback changes; the tests prove this.
5. **Never visible, whatever the relationship:** a pair where either person blocked
   the other (`public.is_blocked`), a suspended member (`public.is_active` false),
   and a deleted member (no profile row; their ids in shared rows are already null,
   D-15). Visibility is computed on every call, so unblocking or clearing a
   suspension makes the card visible again. Neither restores any connection or
   Crew (0005, 0011); the card is only a read.
6. **A suspended caller gets zero rows, not an error (Q5).** M-56 decision 3: a
   suspended member's app shows nothing special. An error would tell them.
   A signed-in role with no `auth.uid()` (no `sub` claim) also gets zero rows.
7. **Anon can't call it.** Execute is revoked from `public` and `anon`, granted to
   `authenticated`. Calling it as anon raises 42501.
8. **Not the caller's own card.** The caller's own id is skipped. The member's own
   screens read their own row through 0002, and M-30 previews `public_name` on the
   client.
9. **Exclusions are indistinguishable.** Unknown id, unrelated, blocked (either
   way), suspended and deleted all return no row for that id and never raise.
   There's no per-id error and no count of hidden ids.
10. **Batch limit: 100 ids.** The pilot has at most 100 testers (D-11), so no
    honest call needs more. More than 100 distinct non-null ids raises 22023.
    Nulls and duplicates are ignored; a null array returns zero rows.

## Approaches considered

| Approach | Verdict |
| --- | --- |
| **A. `security definer` RPC `profile_cards(ids uuid[])` returning a fixed row type** | **Chosen.** One call per screen, a fixed column list the tests can pin, and `is_blocked` / `is_active` can be called inside it (they aren't executable by clients). Same pattern as the Crew RPCs and `withdraw_member`. |
| B. A select policy on `profiles` for related users | Rejected. RLS limits rows, not columns: the client would read `display_name`, `suspended_at` and `vetted_at`. A policy also can't call `is_blocked` or `is_active`, which clients can't execute. |
| C. A view over `profiles` that runs as its owner (no `security_invoker`) | Rejected. It could filter with `auth.uid()`, but Supabase's security advisor flags owner-run views, PostgREST would expose it as a listable table, and the batch limit and suspended-caller rule are awkward to express. |
| D. One-id `profile_card(id uuid)` | Rejected. An inbox or Ride Again list would make one call per row. A one-element array covers the single case. |

## SQL surface

### `public.profile_cards(ids uuid[])`

```sql
create function public.profile_cards(ids uuid[])
returns table (
  id uuid,
  public_name text,
  role text,
  ride_prefs text[],
  vetted boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$ ... $$;

revoke execute on function public.profile_cards(uuid[]) from public, anon;
grant execute on function public.profile_cards(uuid[]) to authenticated;
```

- `plpgsql`, because the 100-id limit has to raise before the query runs. The
  `returns table` columns are plpgsql variables, so every column reference in the
  body is table-qualified (`p.id`, `i.sender_id`) and the argument is written
  `profile_cards.ids`; no unqualified `id`, `role` or `ride_prefs` appears.
- Every name is schema-qualified (`public.profiles`, `public.is_blocked`,
  `public.public_name`, `pg_catalog.unnest`). No extension objects are used.
- `stable`: it only reads. Owned by the migration role, which keeps execute on
  `is_blocked` and `is_active` (both revoked from clients).
- No row order is promised. Clients key cards by `id`.

Body outline (the build phase writes the exact SQL test-first):

```sql
declare
  me uuid := auth.uid();
  wanted uuid[];
begin
  select coalesce(array_agg(distinct x.id), '{}') into wanted
  from pg_catalog.unnest(profile_cards.ids) as x(id)
  where x.id is not null;

  if pg_catalog.cardinality(wanted) > 100 then
    raise exception 'Ask for at most 100 profile cards at a time' using errcode = '22023';
  end if;

  -- No caller, or a suspended or profile-less caller: nothing, and no error.
  if me is null or not public.is_active(me) then
    return;
  end if;

  return query
  select p.id,
         public.public_name(p.display_name),
         p.role,
         p.ride_prefs,
         p.vetted_at is not null
  from public.profiles p
  where p.id = any (wanted)
    and p.id <> me
    and public.is_active(p.id)
    and not public.is_blocked(me, p.id)
    and (
         exists (select 1 from public.invitations i
                 where (i.sender_id = me and i.recipient_id = p.id)
                    or (i.sender_id = p.id and i.recipient_id = me))
      or exists (select 1 from public.rides r
                 where (r.driver_id = me and r.passenger_id = p.id)
                    or (r.driver_id = p.id and r.passenger_id = me))
      or exists (select 1 from public.connections c
                 where c.user_low = least(me, p.id)
                   and c.user_high = greatest(me, p.id))
      or exists (select 1 from public.commute_crews cc
                 where cc.user_low = least(me, p.id)
                   and cc.user_high = greatest(me, p.id))
    );
end
```

The limit is checked before the caller, so the error is the same for every caller
and says nothing about their status.

Existing indexes serve every lookup: `invitations_sender_id_idx` and
`invitations_recipient_id_idx` (0010), `rides_driver_id_idx` and
`rides_passenger_id_idx` (0003), the `connections` and `commute_crews` pair keys
(0003), and the `blocks` primary key in both directions (0005).

### Grants, RLS and tables

- No new table, column, policy or trigger. `profiles` stays owner-only (0002).
- Nothing in `profiles`, `invitations`, `rides`, `connections` or `commute_crews`
  changes, so 0010's deletion policy and its foreign-key rule are unaffected.
- `public_name` is already executable by `authenticated`; `is_blocked` and
  `is_active` stay client-inaccessible and are called only inside this function.

### Blocked and suspended filtering

Inside the definer function, per candidate: `public.is_active(me)` (the caller),
`public.is_active(p.id)` and `not public.is_blocked(me, p.id)`. This is the
pattern 0005 and 0011 prescribe for every place two people meet. No locks: it's a
read, and a block or suspension committing mid-call is seen by the next call.

### What later tasks must keep

- **Invitations unlock cards (M-27).** Because any invitation makes two people
  related, creating one must stay gated: M-27 may let a client invite only someone
  it could already see (a `find_matches` result or a connection, not blocked, both
  active) and keeps D-02's rate limits. Otherwise sending invitations to guessed
  ids would unlock cards.
- **Changing the columns (M-49, M-41).** Postgres can't change a function's output
  columns with `create or replace`. A task that adds D-03 trust stats or a
  review-cohort filter copies the latest definition, then `drop function` and
  `create function` in its own migration, re-applies the revoke and grant, and
  keeps this task's tests passing. M-49's added fields must be aggregates only
  (no ride dates or partners).
- **Richer profiles, later.** If a photo is ever added, it shows only after mutual
  confirmation; that would be the first field to depend on ride status, and the
  relationship check above already has the ride rows to decide it.

## Client usage (sketch; no app change in this task)

M-19's data layer doesn't exist on main yet; the wiring tasks (M-36, M-44, M-47,
M-48) add a `src/lib/data/profileCards.ts` module in its pattern.

```ts
export type RidePref = 'quiet' | 'smoke_free';

export type ProfileCard = {
  id: string;
  name: string;          // already "Priya S."; never format it again
  role: 'driver' | 'passenger' | 'both';
  ridePrefs: RidePref[];
  vetted: boolean;       // badge: "License & insurance checked by Merge"
};

// Supabase backend (injected, per M-19's rule)
const { data, error } = await supabase.rpc('profile_cards', { ids });
// Pure mapper, unit-tested: narrows role/ride_prefs, drops unknown values,
// returns Map<string, ProfileCard>.
```

- Collect every other-party id on a screen, call once, look cards up by id.
- **A missing card renders one generic label (Q6).** Deleted (null id), blocked,
  suspended and "not related any more" must look the same. The recommended label
  is the existing "Former member", with no name, role or badge. The consuming UI
  task owns the final copy.
- The mock backend returns cards for mock people and `null`/no entry for unknown
  ids.

## Test plan — `supabase/tests/profile_cards_test.sql`

One transaction, DO blocks that `raise exception`, `tests.as_user`, `tests.as_anon`,
`tests.as_admin`, in the style of `profiles_test.sql` and `member_status_test.sql`.
Relationship rows are inserted as admin (no client writes invitations or rides
yet). Invitations need a `commute_id` (0010's `require_on_insert`), so the fixture
saves one commute per inviting member as admin, with points in Alameda and San
Francisco.

People: Ada (the caller), Priya `'Priya Sharma'` (vetted driver, `quiet`), one
member per relationship kind (invitation as sender, invitation as recipient, ride as
driver, ride as passenger, connection only, Crew only), Uma (unrelated), Bo (Ada
blocked him), Bix (blocked Ada), Sue (suspended later), Del (deleted later), and a
control pair that never touches Ada.

1. **Privileges and shape.** `prosecdef` is true and `proconfig` sets
   `search_path=""`; `authenticated` can execute and `anon` can't; calling as anon
   raises 42501. The result columns are exactly `id, public_name, role, ride_prefs,
   vetted` (from `pg_proc.proargnames` / `proargmodes`), and none is `display_name`,
   `vetted_at`, `suspended_at`, `created_at` or `discovery_opt_in`.
2. **Name.** Priya's card reads `'Priya S.'`, never `'Priya Sharma'`, and equals
   `public.public_name(display_name)` for every returned row (checked as admin).
3. **Fields.** `role` and `ride_prefs` match the profile; `vetted` is true for Priya
   and false for an unvetted driver.
4. **Each relationship returns the card, from both sides.** Invitation sent and
   received, each of the five statuses; ride as driver and as passenger, each of the
   three statuses; connection with Ada as `user_low` and as `user_high`; Crew in each
   of the five statuses. Each is checked with only that one row between the pair.
5. **Status never changes visibility.** Moving one invitation through `pending` →
   `declined` and another through `pending` → `expired` returns identical cards at
   each step.
6. **Feedback never changes visibility.** After a completed ride with yes/yes
   (connection exists), the other person answers `no`; the connection is gone, and
   Ada still gets the card through the ride.
7. **Unrelated and unknown.** Uma: zero rows. A random uuid: zero rows. Mixed input
   (related, unrelated, unknown, null, duplicate, Ada's own id) returns exactly the
   related cards, once each.
8. **Blocks.** Bo and Bix each have a ride with Ada. Ada gets no card for either;
   neither gets Ada's. Neither call raises. Deleting the block makes the card
   visible again; the ended connection or Crew stays ended.
9. **Suspension.** After Sue is suspended (admin sets `suspended_at`), Ada gets no
   card for Sue, and Sue's own call returns zero rows even for her related, active
   contacts. Clearing `suspended_at` makes both visible again.
10. **Deletion.** After Del's `auth.users` row is deleted, the ride Ada shared with
    Del keeps Ada's side with `passenger_id`/`driver_id` null, and a call with Del's
    old id returns zero rows.
11. **No caller.** As `authenticated` with no `sub`, zero rows.
12. **Indistinguishable.** For the same input shape, blocked, suspended, deleted and
    unrelated ids each produce zero rows with no exception (one assertion over all
    four).
13. **Limit.** 100 distinct ids work; 101 raise 22023; 101 entries with duplicates
    and nulls that reduce to ≤ 100 work.
14. Every existing file in `supabase/tests/` keeps passing.

CI's `database` job is the test run (no Docker on the build machine). After the
first push, the build commits the `database-types` artifact, which adds
`profile_cards` under `Functions`.

## Privacy and safety impact

- Before this task no client could read any part of another profile. After it, a
  related member can read four fields that the invariant already allows before
  confirmation: first name and last initial, role, ride preferences, and a vetted
  flag. No location, no timestamp, no contact detail.
- Blocked pairs and suspended members never see each other's card. A blocked person
  sees the card disappear, exactly as for a suspended or deleted member; the call
  never confirms which. Known residual, accepted as in 0005: the blocked person can
  still read their own shared rides through 0003's RLS, where the other id is
  non-null, so they can tell "blocked or suspended" apart from "deleted".
- No "no" leaks: card visibility doesn't depend on invitation status, feedback or
  connection state.

## Out of scope

- App changes and the data-layer module (M-36, M-44, M-47, M-48 wire them).
- Discovery cards (`find_matches`, M-26), invitation and inbox reads with area
  labels (M-27, M-36), post-confirmation reveals (M-32, M-55a), trust stats (M-49),
  the name rule (M-56), the review cohort (M-41).
- Cancelling invitations or rides between a newly blocked pair (M-27, M-32).

## Owner questions

All six approved by the owner on 2026-10-10 as recommended.

1. **Ride preferences on the card?** Recommended: **yes**. Allowed before
   confirmation, profile-level, and `docs/mvp.md` says they show on cards. The
   backlog card listed only name, role and vetted.
   **Approved: yes, on the card.**
2. **Area labels on the card?** Recommended: **no**. Areas are per commute; the
   matching, invitation and booking functions return the one that applies. Putting
   them on the card would show every past contact all of a person's areas.
   **Approved: no areas on the card.**
3. **Which invitations make two people related?** Recommended: **every status, with
   no expiry.** Filtering by status reveals a "no" (D-16, D-22). Alternative: only
   invitations still pending or tied to a ride, which hides old contacts sooner but
   needs D-22's display timing reproduced exactly in SQL.
   **Approved: every status, no expiry.**
4. **Same card before and after confirmation?** Recommended: **yes.** Post-confirmation
   details stay with booking (M-32) and contact sharing (M-55a), each behind its own
   gate.
   **Approved: the same card.**
5. **Suspended caller: empty result or error?** Recommended: **empty**, per M-56
   decision 3 (nothing special in a suspended member's app).
   **Approved: empty result.**
6. **How a missing card renders.** Recommended: one label for every missing card,
   the existing "Former member", so deletion, block and suspension read alike.
   Final copy belongs to the UI tasks (M-44, M-47, M-48).
   **Approved: "Former member" for every missing card.**
