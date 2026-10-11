# Invitations lifecycle and booking: design (M-27, with M-32's half)

**Date:** 2026-10-10
**Tasks:** M-27 (invitations, built from this spec in `0017_invitations.sql`) and M-32 (booking, built from [section 9](#9-handoff-to-m-32-booking) in `0018_booking.sql`)
**Status:** Draft for owner review. Twelve [owner questions](#owner-questions) carry a recommended answer; nothing is built until the owner approves.
**Scope (M-27):** `supabase/migrations/0017_invitations.sql`, `supabase/tests/invitations_test.sql`, `supabase/tests/account_deletion_invitations_test.sql`, `apps/mobile/src/lib/database.types.ts` (CI artifact only)
**Builds on:** `0001` (`invitations`), `0003` (`rides`, `connections`, `commute_crews`), `0005` (`blocks`, `is_blocked`, the `merge.pair:` advisory lock), `0008` (stored areas, `within_area`, seats, cargo), `0010` (deletion policy, `require_on_insert`), `0011` (`is_active`, `is_vetted`, `public_name`, `withdraw_member`), `0014` (`profile_cards`), `0015` (`match_candidates`, `find_matches`); M-08's `REPLY_CUTOFF_MINUTES` and `CANCEL_CUTOFF_MINUTES` in `apps/mobile/src/lib/dates.ts`; M-19's error model.
**Consumers:** M-32 (booking), M-35 (requests and invites in the app), M-36 (driver inbox), M-37 (expiry sweep, completion), M-38/M-45 (notification events), M-42 (request state on Discover), M-44/M-48 (Ride Again and Crew invites), M-52 (audit).

## Problem

`invitations` exists (0001, 0003, 0010) but nobody can write it: RLS is on with no policies, and no RPC sends, answers or withdraws one. Requesting a ride is the core of the pilot, and it is also where the strictest privacy rule lives: the person who asked must never learn that the other person said "no", and must never be able to tell a "no" from "not answered" (D-16, D-22). The rule has to hold not only in what a screen says, but in every observable: status fields, timestamps, error codes, rate-limit counters, row ordering and the moment a state changes. M-16 adds a second constraint: any invitation, in any status, unlocks a profile card, so creating one must be gated to people the sender could already see.

## Decisions this design rests on

| Source | What it fixes here |
| --- | --- |
| D-02 (Decided) | Reply cutoff 8 PM America/Los_Angeles the evening before; pending requests expire then; no requests for a date once its cutoff has passed. Cancel cutoff 9 PM. Late cancels allowed, recorded privately, no penalty. Limits: 10 sent per day, 5 pending at once, 1 pending per recipient. Update 2026-10-10: matching hides a person on a date they're booked or full. "One confirmed ride per person per date" is still a suggestion: [Q1](#owner-questions). |
| D-06 (Decided, update 2026-10-10) | Unvetted members are hidden as drivers; M-27 refuses their driver invitations and M-32 their confirmations. |
| D-16 (Decided) | Keep driver invites. No counter-proposals and no "Move". The request carries the pickup **area** and time; the driver sets the exact spot and a note when confirming, and the server checks `public.within_area(area, spot)` against the area copied onto the invitation. A decline reads like an expiry. |
| D-22 (Decided) | A declined request keeps showing as pending to the requester until the reply cutoff, then shows exactly like an expired request. |
| D-13 (Decided) | No push for a decline, an expiry or any other "no". |
| D-07, member-status spec | Suspension withdraws invitations and cancels future rides; a suspended member's own app shows nothing special. New invitations and rides must lock both profiles `for share` and check `is_active`. |
| D-15, account-deletion spec | Invitations with no ride are deleted; an invitation behind a ride stays with the deleted person's column null ("Former member"). |
| M-16 (profile cards) | Any invitation unlocks a card, so `send_invitation` admits only people `match_candidates` returns, plus the connected exception. Refused sends create no row. |
| M-19 (data layer) | Business-rule refusals carry a stable `hint`; raw messages never reach the UI; "not found" and "not allowed" read the same. |
| M-26 (matching) | `match_candidates(me, ride_date)` is the eligibility check. M-27 adds a parameter by copying its definition. |

## Approaches considered

1. **Stored truth plus a per-viewer projection (chosen).** The table records what really happened (`declined`, `withdrawn`, …) and when the other side may learn it (`held_until`). Clients never read the table; one `security definer` function, `my_invitations()`, computes each viewer's state at read time from the row and the clock. Expiry needs no job: a row past `expires_at` simply projects as unavailable. Every RPC decides from the **caller's projected state**, never the stored status, so no action's success or error can reveal what the other side did.
2. **Delay the write.** Keep a decline in a private side table and apply it at the cutoff with a scheduled job. The stored status would then always be safe to show, but it needs pg_cron (M-37 avoids it, and CI can't run it), and a missed job run shows a decline late or never.
3. **Participant-readable table with column grants.** Grant `select` on harmless columns under a participant-only policy. It can't hide a blocked counterpart (`is_blocked` can't run in RLS), the status still has to come from somewhere, and every new column becomes a fresh leak review. Rejected; [Q3](#owner-questions).

## 1. Vocabulary

- **Direction.** `request`: a passenger asks a driver. `invite`: a driver invites a passenger. The driver of an invitation is `recipient_id` for a request and `sender_id` for an invite; the passenger is the other one.
- **Kind.** `first_ride`, `ride_again` or `crew` (0003's ride kinds). Derived by the server ([section 3](#3-send_invitation)), never taken from the client ([Q12](#owner-questions)).
- **Acting party / waiting party.** At any moment one side owes the next move and the other is waiting:

  | Stored status | Acting party | Waiting party |
  | --- | --- | --- |
  | `pending` | recipient (answers) | sender |
  | `accepted` (driver invite only) | driver = sender (confirms) | passenger = recipient |

- **The hold.** When the **acting** party says no (declines a pending invitation, or the driver withdraws an invite the passenger accepted), the waiting party keeps seeing the pre-"no" state until `held_until`, which always equals `expires_at`, the reply cutoff. This is D-22, applied to both places where someone waits on an answer ([Q8](#owner-questions)). When the **waiting** party gives up (the sender withdraws a pending invitation, the passenger un-accepts), nothing is held: the acting party wasn't waiting, so it learns at once, as "This ride isn't available anymore".
- **Open.** An invitation is open for a person when their projected state is one of the four live states in [section 2](#2-lifecycle). Rate limits, the pair-date rule and every system close work on "open", never on the stored status, so a held row counts exactly like a pending one.

## 2. Lifecycle

### Stored statuses

0001's check becomes `pending | accepted | declined | withdrawn | expired | cancelled | booked`.

```
send ─▶ pending ── accept (passenger; invites only) ──▶ accepted
          │                                               │
          ├─ confirm (driver; requests, M-32) ─▶ booked ◀─┤─ confirm (driver, M-32)
          ├─ decline (recipient) ─▶ declined              ├─ withdraw (driver) ─▶ withdrawn
          │                         [held for the sender] │                  [held for the passenger]
          ├─ withdraw (sender) ─▶ withdrawn               ├─ decline (passenger "un-accept") ─▶ declined
          └─ system close ─▶ cancelled                    └─ system close ─▶ cancelled

At expires_at, every pending or accepted row projects as expired. M-37 may later
write 'expired'; the projection is the same.
```

Stored columns added by 0017 ([section 8](#8-database-changes-0017_invitationssql)) that drive the projection: `direction`, `expires_at`, `accepted_at`, `closed_at`, `held_until`, `waiting_closed_at`, `cancel_reason`.

### Transitions and who may make them

| From (caller's projected state) | Action | Caller | Stored result | The other side sees |
| --- | --- | --- | --- | --- |
| — | `send_invitation` | sender | `pending`, `expires_at = reply_cutoff(ride_date)` | `waiting_for_me` |
| `waiting_for_me`, direction `invite` | `accept_invitation` | passenger (recipient) | `accepted`, `accepted_at = now()` | `accepted_confirm_seat` (driver) |
| `waiting_for_me`, direction `request` | `accept_invitation` | driver | refused, hint `driver_confirms`: a driver books with M-32's confirm, which is the accept | — |
| `waiting_for_me` | `decline_invitation` | recipient | `declined`, `held_until = expires_at` | sender: unchanged (`waiting_for_them`) until the cutoff, then `unavailable` |
| `accepted_waiting_for_driver`, row really `accepted` | `decline_invitation` ("un-accept") | passenger | `declined`, not held | driver: `unavailable` at once ([Q9](#owner-questions)) |
| `accepted_waiting_for_driver`, row really `withdrawn` (held) | `decline_invitation` | passenger | `waiting_closed_at = now()`; status unchanged | driver: unchanged (`closed_by_me`) |
| `waiting_for_them`, row really `pending` | `withdraw_invitation` | sender | `withdrawn`, not held | recipient: `unavailable` at once |
| `waiting_for_them`, row really `declined` (held) | `withdraw_invitation` | sender | `waiting_closed_at = now()`; status unchanged | recipient: unchanged (`closed_by_me`) |
| `accepted_confirm_seat` | `withdraw_invitation` | driver (sender) | `withdrawn`, `held_until = expires_at` | passenger: unchanged (`accepted_waiting_for_driver`) until the cutoff, then `unavailable` |
| `waiting_for_me` (request) or `accepted_confirm_seat` (invite) | `confirm_ride` (M-32) | driver | `booked`, plus a `rides` row | `booked` |
| any open state | system close ([section 2, system closes](#system-closes)) | server | live rows: `cancelled` + reason; held rows: `held_until = now()` + reason | `unavailable` at once (or the row disappears, [Q10](#owner-questions)) |
| any other state | any action | anyone | refused, hint `unavailable` | — |

The last two rows of withdraw and decline are why every RPC reads the **caller's projection**: a sender withdrawing a request the driver secretly declined must get exactly the success, and then exactly the state, they'd get withdrawing one nobody answered. The `waiting_closed_at` column lets the waiting party close a held row without changing what the acting party sees (otherwise the acting party would learn that the other side gave up after the "no").

A decline is final for the person who declined: their projection is `closed_by_me`, and M-32's confirm refuses it.

### Projection: `public.invitation_state(i, viewer, at)`

Internal (`stable`, not executable by clients), pure in its arguments so tests can pass a fixed `at`. Returns null when `viewer` is neither party.

```
live      := i.status in ('pending','accepted') and at < i.expires_at
held      := i.held_until is not null and at < i.held_until and i.waiting_closed_at is null
if i.status = 'booked'                                  → 'booked'
if viewer = sender:
   status = 'pending'   and live                         → 'waiting_for_them'
   status = 'declined'  and held                         → 'waiting_for_them'      -- D-22
   status = 'accepted'  and live                         → 'accepted_confirm_seat' -- invites only
   status = 'withdrawn' or i.waiting_closed_at not null  → 'closed_by_me'
   otherwise                                             → 'unavailable'
if viewer = recipient:
   status = 'pending'   and live                         → 'waiting_for_me'
   status = 'accepted'  and live                         → 'accepted_waiting_for_driver'
   status = 'withdrawn' and held                         → 'accepted_waiting_for_driver' -- Q8
   status = 'declined'  or i.waiting_closed_at not null  → 'closed_by_me'
   otherwise                                             → 'unavailable'
```

(`waiting_closed_at` is only ever set by the waiting party, so "closed_by_me" is right for whichever side that was.) `held_until` is always `expires_at` when set by an RPC, so a held row and a live row switch to `unavailable` at the same instant. M-37 may later write `expired` onto stale `pending`/`accepted` rows; `expired` falls to "otherwise", so the projection doesn't change.

### What each side sees

Copy is for the UI tasks; the states are the contract.

| Projected state | Who | Suggested copy (M-35, M-36) |
| --- | --- | --- |
| `waiting_for_them` | sender | "Request sent, waiting for {first}" / "Invite sent" · "Reply by {reply_by}" |
| `waiting_for_me` | recipient | Inbox item: "{first} wants a ride" (driver) or "{first} invited you" (passenger) · "Reply by {reply_by}" |
| `accepted_confirm_seat` | driver | "Accepted, confirm seat" |
| `accepted_waiting_for_driver` | passenger | "You accepted. {first} confirms your seat by {reply_by}." |
| `booked` | both | Booked (ride id returned) |
| `unavailable` | either | "This ride isn't available anymore" (never "Declined", "Withdrawn", "Expired" or "Cancelled") |
| `closed_by_me` | the person who withdrew or declined | hidden, or "You withdrew this request" / "You declined" |

**What each side can never learn:** whether `unavailable` came from a decline (revealed at the cutoff), an expiry, a withdrawal, the other person booking elsewhere, a full car, "Can't drive", or (with [Q10](#owner-questions)'s alternative) a block or suspension. No push, timestamp, counter or error distinguishes them.

### System closes

Done by the server, never by a client, through one internal helper so M-32 reuses it:

`public.close_invitations(ids uuid[], reason text)`: for each id, a live row (`pending`/`accepted`, not past `expires_at`) becomes `cancelled` with `cancel_reason = reason` and `closed_at = now()`; a held row (`held_until > now()`, `waiting_closed_at` null) gets `held_until = now()` and `cancel_reason = reason`, keeping its status, so the waiting party sees `unavailable` at the same moment it would have for a live row and the acting party still sees `closed_by_me`. Reasons: `block`, `suspension`, `booked_elsewhere`, `full`, `cant_drive`. `cancel_reason` is never returned to a client.

| Trigger | Built by | Closes |
| --- | --- | --- |
| A new block, either direction | M-27: `after insert on blocks` trigger `blocks_close_invitations` (its own; `blocks_end_pair` is untouched) | every invitation of the pair, both directions, open for either party, any date |
| A suspension | M-27: `create or replace public.withdraw_member` (copied from 0011) | every invitation open for either party where the member is sender or recipient (0011 only did `pending`; `accepted` and held rows were left) |
| Confirming a ride | M-32 | the other open invitations of both people for that date that the booking makes impossible ([section 9](#9-handoff-to-m-32-booking), Q1) |
| A full car or trunk | M-32 | the driver's remaining open driver-side invitations that date that no longer fit |
| "Can't drive" | M-32 | the driver's open driver-side invitations that date |

Ending a connection or a Crew closes nothing: open `ride_again` and `crew` invitations stay single, dated invitations until answered or expired. Closing them would add a second, timed signal on top of the connection disappearing.

## 3. `send_invitation`

```sql
public.send_invitation(
  recipient uuid,
  other_role text,                 -- the recipient's role in this ride: 'driver' (a request) or 'passenger' (an invite)
  ride_date date,
  pickup_time time default null,   -- null: the passenger's departure, clamped into both windows
  brings_scooter boolean default null,  -- null: the passenger commute's brings_scooter
  crew_id uuid default null        -- set only for a Crew ride
) returns uuid                     -- the new invitation's id
language plpgsql volatile security definer set search_path = ''
```

`other_role` mirrors `find_matches`' row key `(other_id, role)`, so a "Both" member is addressed in one role at a time.

### Check order (privacy-critical)

Checks about the **caller** come first, then the **rate limits**, and only then anything about the **recipient**. If a recipient check ran before a rate limit, a sender at their limit would get `unavailable` for a person who blocked them and `daily_limit` for everyone else, which reveals the block.

| # | Check | Refusal (SQLSTATE, hint) |
| --- | --- | --- |
| 1 | `auth.uid()` is set | `42501`, `not_signed_in` |
| 2 | Arguments well-formed: `recipient`, `other_role`, `ride_date` not null; `recipient <> me`; `other_role in ('driver','passenger')`; `pickup_time` a whole minute | `22023`, `invalid_input` |
| 3 | The caller has a profile and isn't suspended (`is_active(me)`) | `42501`, `unavailable` (member-status decision 3: nothing special) |
| 4 | `now() < reply_cutoff(ride_date)` | `P0001`, `past_cutoff` |
| 5 | `ride_date <= today_la + 14` ([Q7](#owner-questions)) | `P0001`, `too_far_ahead` |
| 6 | The caller has a commute in the opposite role whose `weekdays` include the date's ISO weekday | `P0001`, `no_commute_that_day` |
| 7 | Caller as driver: `is_vetted(me)` (D-06) | `P0001`, `not_vetted` |
| 8 | Caller as driver: their driver commute has a vehicle | `P0001`, `no_vehicle` |
| 9 | The caller's own date (Q1): as passenger, no `confirmed`/`completed` ride that date in either role; as driver, none as a passenger | `P0001`, `already_booked` |
| 10 | Caller as driver: seats open that date (`least(seats_offered, passenger_seats)` minus booked seats) | `P0001`, `car_full` |
| 11 | Lock both profiles `for share` in id order (serializes with a suspension), then the sender lock `pg_advisory_xact_lock(hashtextextended('merge.sender:' \|\| me, 0))` | — |
| 12 | Fewer than 10 invitations sent by the caller with `created_at` in today's LA calendar day, any status (withdrawn ones count, so send-and-withdraw can't reset it) | `P0001`, `daily_limit` |
| 13 | Fewer than 5 invitations open **in the caller's projection** among those they sent (`waiting_for_them` or `accepted_confirm_seat`; a secretly declined request counts) | `P0001`, `pending_limit` |
| 14 | Pair lock: 0005's `merge.pair:{lo}:{hi}` advisory lock, the same key `blocks_end_pair` takes, so a send and a block on the pair serialize | — |
| 15 | Per-recipient (D-02, [Q4](#owner-questions)): no invitation from the caller to this recipient open in the **caller's** projection (any date for `first_ride`; the same date for `ride_again`/`crew`) | `P0001`, `already_requested` |
| 16 | Pair-date: no invitation between the pair for `ride_date`, either direction, open in **either party's** projection | `P0001`, `already_requested` |
| 17 | Kind: `crew` when `crew_id` is given (an `active` Crew of exactly this pair whose `weekdays` include the date); else `ride_again` when a `connections` row exists; else `first_ride`, refused if the pair has a `completed` ride ([Q5](#owner-questions)) | `42501`, `unavailable` |
| 18 | Eligibility: `public.is_active(recipient)`, `not public.is_blocked(me, recipient)`, and a row `(other_id = recipient, role = other_role)` in `public.match_candidates(me, ride_date, skip_opt_in_if_connected => kind in ('ride_again','crew'))` | `42501`, `unavailable` |
| 19 | `pickup_time` inside both windows: `[max(dp - fp, dd - fd), min(dp + fp, dd + fd)]` (departure ± flex of the passenger and the driver); the default clamps the passenger's departure into it | `P0001`, `time_outside_window` |
| 20 | `brings_scooter` true needs the driver's vehicle to fit one (D-04) | `P0001`, `scooter_doesnt_fit` |

Then insert: `sender_id = me`, `recipient_id = recipient`, `commute_id` = the caller's commute in their role (`match_candidates.my_commute_id`), `direction`, `kind`, `crew_id`, `ride_date`, `pickup_area` and `pickup_area_label` copied from the **passenger's** commute (`origin_area`, `origin_area_label`; commute-privacy spec, D-16 section), `pickup_time`, `seats = 1`, `brings_scooter`, `expires_at = reply_cutoff(ride_date)`. Return the id.

Notes:

- Rule 16's "either party's projection" matters: if a driver withdrew an invite the passenger accepted (held, so the passenger still sees "accepted"), a fresh invite from the same driver for the same date would show the passenger two invites and reveal the withdrawal. The driver gets `already_requested` instead.
- Rules 19–20 run after eligibility, so a refused recipient's window or trunk is never probed. Both facts are already visible in that person's `find_matches` row.
- A scooter slot already taken that date isn't checked here; requesting isn't booking. M-32 refuses it at confirm and closes the leftover scooter invitations when the slot fills.
- Commute edits after sending change nothing: the area and time are copies. Detour and window rules aren't rechecked at confirm.
- The caller doesn't need `discovery_opt_in` to send (D-14 lets anyone browse; sending is an explicit act).
- Every `unavailable` refusal raises the same SQLSTATE, the same constant message and the same hint, whatever the cause. A test compares them across causes.

## 4. Answering and withdrawing

All three take `invitation_id uuid`, return `void`, are `security definer` with `search_path = ''`, and are granted to `authenticated` only.

**Common steps:** `not_signed_in` if no `auth.uid()`. Read the row; if it doesn't exist or the caller isn't a party, `unavailable` (not found and not yours are the same). If either party column is null (a Former member), `unavailable`. `unavailable` for a suspended caller. Lock both profiles `for share` in id order, then the pair lock, then the row `for update`, and recompute the caller's projection at `now()`. If the other person is inactive or the pair is blocked, `unavailable` (the trigger will have closed the row anyway; this covers the window before it commits).

| RPC | Allowed when the caller's projection is | Effect | Other refusals |
| --- | --- | --- | --- |
| `accept_invitation` | `waiting_for_me` on an `invite` | `status = 'accepted'`, `accepted_at = now()` | `driver_confirms` (P0001) on a `request`; `already_booked` (P0001) when the passenger already has a ride that date (Q1); `unavailable` when the driver is no longer vetted |
| `decline_invitation` | `waiting_for_me`, or `accepted_waiting_for_driver` | `waiting_for_me`: `declined`, `held_until = expires_at`. Live `accepted`: `declined`, not held. Held `withdrawn`: `waiting_closed_at = now()` | — |
| `withdraw_invitation` | `waiting_for_them`, or `accepted_confirm_seat` | live `pending`: `withdrawn`, not held. Held `declined`: `waiting_closed_at = now()`. `accepted`: `withdrawn`, `held_until = expires_at` | — |

Each sets `closed_at = now()` when it closes a live row. `updated_at` is maintained by a trigger and never returned to clients. An action on a row whose projection isn't in the allowed column is `unavailable`, including a repeat of the same action.

## 5. Reading: `my_invitations()`

```sql
public.my_invitations() returns table (
  id uuid,
  ride_date date,
  kind text,                 -- first_ride | ride_again | crew
  direction text,            -- request | invite
  my_role text,              -- driver | passenger
  other_id uuid,             -- for profile_cards
  state text,                -- section 2's seven projected states
  reply_by timestamptz,      -- expires_at
  pickup_area_lat double precision,
  pickup_area_lng double precision,
  pickup_area_label text,
  area_radius_m integer,     -- 402
  pickup_time time,
  seats integer,
  brings_scooter boolean,
  crew_id uuid,
  ride_id uuid,              -- only when state = 'booked'
  created_at timestamptz
)
language plpgsql stable security definer set search_path = ''
```

- Rows where the caller is sender or recipient and `ride_date >= today_la`. Ordered by `ride_date`, `created_at`, `id`, never by anything that changes on a decline.
- A suspended or profile-less caller gets no rows (as `profile_cards` and `find_matches`).
- **A row whose counterpart isn't visible is omitted**: the counterpart is null (deleted), inactive, or the pair is blocked ([Q10](#owner-questions)). That puts block and suspension in the same class as deletion, which D-15 already makes disappear, and matches `profile_cards`, which returns no card for all three. Blocked pairs never appear to each other.
- **Never returned:** `status`, `accepted_at`, `closed_at`, `held_until`, `waiting_closed_at`, `cancel_reason`, `updated_at`, `commute_id`, any exact point, the counterpart's areas other than the copied pickup area. The pickup area is the passenger's own area, or the area the driver already saw in `find_matches`.
- M-36's badge counts `waiting_for_me` plus `accepted_confirm_seat`. M-42 shows "Request sent" on a Discover card from the caller's `waiting_for_them` rows for that `other_id` and date.

## 6. Error model

Every business refusal is `raise exception '<constant message>' using errcode = '<code>', hint = '<hint>'`. The message is fixed English with no names, ids, dates or counts. The hint is the stable contract M-19's `toDataError(…, overrides)` maps with `hint:<name>`.

| Hint | SQLSTATE | Raised by | Meaning (always about the caller's own situation, except `unavailable`) | M-19 kind | Suggested copy |
| --- | --- | --- | --- | --- | --- |
| `not_signed_in` | 42501 | all | no `auth.uid()` | `auth` / `notAllowed` | session copy |
| `invalid_input` | 22023 | all | malformed arguments, inviting yourself, bad role, a time with seconds, an over-long note (M-32) | `invalid` | generic |
| `unavailable` | 42501 | all | the person or invitation can't be acted on: unknown, not yours, closed, expired, blocked either way, suspended, deleted, opted out, not a match that date, unvetted as a driver, booked or full that date, no active Crew; also a suspended caller | `notAllowed` | "This ride isn't available anymore" |
| `past_cutoff` | P0001 | send | the 8 PM cutoff for that date has passed | `invalid` | "Requests for {date} closed at 8 PM the evening before. The earliest you can request is {earliestRequestDate}." |
| `too_far_ahead` | P0001 | send | beyond the horizon ([Q7](#owner-questions)) | `invalid` | "You can request up to 2 weeks ahead." |
| `no_commute_that_day` | P0001 | send | no commute in that role on that weekday | `invalid` | "Add {weekday} to your commute first." |
| `no_vehicle` | P0001 | send | driving with no vehicle on the commute | `invalid` | "Add your car first." |
| `not_vetted` | P0001 | send, M-32 confirm | the caller isn't vetted to drive (D-06) | `notAllowed` | "Merge checks your license and insurance before you can offer rides." |
| `already_booked` | P0001 | send, accept, M-32 confirm | the caller already has a conflicting ride that date (Q1) | `conflict` | "You already have a ride on {date}." |
| `car_full` | P0001 | send, M-32 confirm | the caller's seats that date are taken | `conflict` | "Your seats for {date} are full." |
| `daily_limit` | P0001 | send | 10 sent today | `rateLimited` | "You've sent 10 requests today. Try again tomorrow." |
| `pending_limit` | P0001 | send | 5 open | `rateLimited` | "You have 5 requests waiting. Withdraw one or wait for replies." |
| `already_requested` | P0001 | send | an open invitation to this person (Q4), or for this pair and date | `conflict` | "You already have a request with {first}." |
| `time_outside_window` | P0001 | send | the pickup time isn't in both windows | `invalid` | "Pick a time between {start} and {end}." |
| `scooter_doesnt_fit` | P0001 | send | the driver's trunk doesn't fit a scooter (already shown on the match card) | `invalid` | "{first}'s trunk doesn't fit a scooter." |
| `driver_confirms` | P0001 | accept | a driver tried to accept a passenger's request | `invalid` | (UI never offers it) |

M-32 adds `no_cargo_room`, `cargo_not_approved`, `spot_outside_area` and `note_too_long` ([section 9](#9-handoff-to-m-32-booking)). The UI fills `{placeholders}` from its own data, never from the error.

## 7. Data per stage, and the pickup-spot rule

| Stage | The passenger sees about the driver | The driver sees about the passenger | Source |
| --- | --- | --- | --- |
| Discover | card (public name, role, vetted, preferences), both generalized areas, shared days, departure time and window, detour band, seats open, scooter fit | card, both generalized areas, shared days, time, window, detour band, brings scooter | `find_matches` (M-26) |
| Invitation open (any open state) | card; the invitation's date, pickup area (their own), time, seats, scooter, reply-by, state | card; the passenger's **pickup area** (copied), label, time, seats, scooter, reply-by, state | `my_invitations` + `profile_cards` |
| Unavailable / closed | card only (still related, M-16); state `unavailable` | the same | same |
| Booked | + exact pickup spot, the driver's note, vehicle make, model, color and plate | + the exact pickup spot (they chose it) | M-32's `ride_pickup(ride_id)` |
| Cancelled | "Ride cancelled", no pickup details | the same | M-32 |

**Pickup spot (D-16).** No exact spot exists before confirmation, so nothing before booking may look like one (M-35 and M-36 replace the fake map pins with a "Pickup area" card). At confirm the driver supplies `spot`; M-32 refuses it unless `public.within_area(invitation.pickup_area, spot)`, comparing against the area **copied onto the invitation**, never the passenger's exact point or their current commute. A driver testing spots learns only the circle they already see. A passenger who dislikes the spot cancels by 9 PM with no penalty.

## 8. Database changes (`0017_invitations.sql`)

### Guard

Like 0008: `raise exception` if `public.invitations` has any row, because the new not-null columns have no backfill. No client could write the table before this migration, so the hosted table is empty.

### Cutoff helpers (mirror M-08)

| Function | Body | Grants |
| --- | --- | --- |
| `public.reply_cutoff_minutes()` | `1200` (= `REPLY_CUTOFF_MINUTES`, 8 PM) | none for clients |
| `public.cancel_cutoff_minutes()` | `1260` (= `CANCEL_CUTOFF_MINUTES`, 9 PM; used by M-32) | none |
| `public.ride_cutoff(ride_date date, minutes integer) returns timestamptz` | `((ride_date - 1)::timestamp + make_interval(mins => minutes)) at time zone 'America/Los_Angeles'`, `stable` (zone data) | none |
| `public.reply_cutoff(ride_date date)` | `ride_cutoff(ride_date, reply_cutoff_minutes())` | none |

A comment names `apps/mobile/src/lib/dates.ts` as the other copy. The local wall-clock conversion handles both DST changes; tests pin both.

### `invitations` columns

| Column | Type | Notes |
| --- | --- | --- |
| `direction` | text not null, check in (`request`,`invite`) | |
| `kind` | text not null, check in (`first_ride`,`ride_again`,`crew`) | check `crew_id is null or kind = 'crew'` (not an equivalence: `crew_id` is set null if the Crew is ever deleted, 0010) |
| `pickup_area` | `extensions.geography(point,4326)` | the passenger's `origin_area` at send. Nullable only so the deletion policy can clear it; required on insert |
| `pickup_area_label` | text | the same |
| `pickup_time` | time not null | check whole minute |
| `seats` | integer not null default 1 | check `seats = 1` for the pilot ([Q2](#owner-questions)) |
| `brings_scooter` | boolean not null default false | D-04: one per passenger |
| `expires_at` | timestamptz not null | `reply_cutoff(ride_date)`, server-set |
| `accepted_at`, `closed_at`, `held_until`, `waiting_closed_at` | timestamptz | server-set; never returned |
| `cancel_reason` | text, check in (`block`,`suspension`,`booked_elsewhere`,`full`,`cant_drive`) | server-set; never returned |
| `updated_at` | timestamptz not null default now() | `before update` trigger; never returned |

- Status check replaced to add `withdrawn` and `booked`.
- A second `require_on_insert` trigger, `invitations_require_pickup_on_insert`, for `pickup_area`, `pickup_area_label` (0010's trigger is left as it is).
- Indexes: the advisor's four (`sender_id`, `recipient_id`, `commute_id`, `crew_id`) already exist from 0010; the test asserts them. Add `(sender_id, ride_date)` and `(recipient_id, ride_date)` for the per-date checks and M-32's closes.

### RLS and grants ([Q3](#owner-questions))

- Policy "Participants read their invitations": `for select to authenticated using ((select auth.uid()) in (sender_id, recipient_id))`, kept as defense in depth and for the M-52 audit.
- `revoke all on public.invitations from public, anon, authenticated`. No client reads or writes the table; the projection is the only read path, because the raw `status` and timestamps carry the "no", and RLS can't hide blocked pairs.
- Client RPCs (`send_invitation`, `accept_invitation`, `decline_invitation`, `withdraw_invitation`, `my_invitations`): revoke from `public, anon`; grant to `authenticated`.
- Internal (`invitation_state`, `close_invitations`, the cutoff helpers, trigger functions, `match_candidates`): revoked from `public, anon, authenticated`.

### `match_candidates` gains a parameter

Copy 0015's definition, `drop function public.match_candidates(uuid, date)`, and create `public.match_candidates(me uuid, ride_date date, skip_opt_in_if_connected boolean default false)`. Only rule 3 changes: `(op.discovery_opt_in or (match_candidates.skip_opt_in_if_connected and <a connections row for the pair>))`. With [Q5](#owner-questions) approved, also exclude pairs that have a `completed` ride and no connection (a past First Ride that didn't lead to Ride Again), in both `find_matches` and send. `find_matches` keeps calling it with two arguments, so its results are unchanged apart from Q5. Re-apply the revoke. `create or replace` can't add a parameter (it would make an ambiguous overload).

### Triggers and replaced functions

- `blocks_close_invitations` (`after insert on public.blocks`, security definer): takes the pair lock (re-entrant with `blocks_end_pair`'s), then `close_invitations(…, 'block')` for every invitation of the pair, both directions, any date.
- `public.withdraw_member` (`create or replace`, copied from 0011): its invitation step becomes `close_invitations(<every invitation open for either party with the member as a party>, 'suspension')`. Connections, Crews and rides are unchanged; M-32 replaces it again for the rides' safety reason.
- `public.profiles_apply_deletion_policy` (`create or replace`, copied from 0010): additionally, on invitations it keeps (those behind a ride) where the deleted person is the passenger, set `pickup_area` and `pickup_area_label` to null. The area is derived from their home, and D-15 deletes what they own. Everything else is unchanged.

### Account deletion and blocks

| Situation | Result |
| --- | --- |
| A member is deleted | 0010 deletes every invitation of theirs with no ride, both directions, any status. Invitations behind a ride stay with their column null and, when they were the passenger, the pickup area cleared. No new foreign keys, so no new `on delete` decisions. The other person's `my_invitations` omits rows with a null counterpart. Their daily and open counts drop accordingly. |
| A member blocks another | `blocks_close_invitations` closes everything open between them; `my_invitations` omits the pair's rows for both; send, accept, decline and withdraw refuse with `unavailable`. Unblocking restores nothing. |
| A member is suspended | `withdraw_member` closes everything open; their rows vanish for others; their own calls refuse or return nothing. Clearing `suspended_at` restores nothing. |

## 9. Handoff to M-32 (booking)

M-32 builds this in `0018_booking.sql` with `booking_test.sql` and `account_deletion_booking_test.sql`. It changes nothing in M-27's contracts except by `create or replace` of the functions named here, copying the latest definitions.

### Rides and pickup details

- `rides` gains `seats integer not null default 1`, `brings_scooter boolean not null default false` (copied from the invitation), `cancelled_at timestamptz`, `cancelled_by uuid references profiles on delete set null`, `cancel_reason text check in ('participant','cant_drive','safety','account_deleted')`, `cancelled_late boolean`. None of the cancel columns reach the other participant's screen: they see "Ride cancelled".
- Backstop index: `unique (passenger_id, ride_date) where status in ('confirmed','completed')` ([Q1](#owner-questions)).
- New table `public.ride_pickups` (`ride_id` primary key, references `rides` on delete cascade; `spot extensions.geography(point,4326) not null`; `note text check (char_length(note) <= 280)`; `vehicle_make`, `vehicle_model`, `vehicle_color`, `vehicle_plate` snapshotted at confirm; `created_at`). RLS on, no policies, all privileges revoked from clients.
- `public.ride_pickup(ride_id uuid)` (definer): one row (spot lat/lng, note, vehicle fields) only when the caller is a participant, the ride is `confirmed`, both are active and the pair isn't blocked; otherwise no row and no error. A pending requester, a third party, a cancelled ride, a blocked pair and a suspended participant all get nothing.

### `confirm_ride(invitation_id uuid, spot_lat double precision, spot_lng double precision, note text, scooter_ok boolean default false) returns uuid`

Called by the driver, for a passenger request whose driver projection is `waiting_for_me`, or a driver invite whose projection is `accepted_confirm_seat`. One transaction:

1. `not_signed_in`; read the row; caller must be its driver, else `unavailable`; projection check, else `unavailable` (this refuses a driver invite that wasn't accepted, a declined row, and anything past the cutoff).
2. Locks, always in this order: both profiles `for share` (id order) → the pair lock `merge.pair:` → per-person day locks `pg_advisory_xact_lock(hashtextextended('merge.day:' || uid || ':' || ride_date, 0))` for both people in uuid order → the invitation row `for update`, then recompute the projection. This is the "per-driver-per-date capacity" lock without a capacity table: every path that changes a person's rides on a date (confirm, cancel, can't drive) takes that person's day lock. Concurrency can't run in the harness; tests show the refusals sequentially.
3. Both active, not blocked, else `unavailable`. `is_vetted(driver)`, else `not_vetted`.
4. Q1: the passenger has no confirmed/completed ride that date in either role (else `unavailable`: they booked elsewhere in a race), and the driver has none as a passenger (else `already_booked`).
5. Capacity from the driver's **current** driver commute and vehicle: `least(seats_offered, passenger_seats) - sum(seats of confirmed/completed rides as driver that date) >= invitation.seats`, else `car_full`. No driver commute or vehicle: `no_vehicle`.
6. Cargo (D-04): if `brings_scooter`, the vehicle must accept a scooter and no other confirmed ride that date carries one, else `no_cargo_room`; and `scooter_ok` must be true (the driver approves each request), else `cargo_not_approved`.
7. Spot (D-16): `public.within_area(invitation.pickup_area, extensions.st_setsrid(extensions.st_makepoint(spot_lng, spot_lat), 4326)::extensions.geography)`, else `spot_outside_area`. Note over 280 characters: `note_too_long`.
8. Insert the ride (`invitation_id`, driver, passenger, `ride_date`, `pickup_time`, `kind`, `seats`, `brings_scooter`), insert `ride_pickups` with the vehicle snapshot, set the invitation `booked`, `closed_at = now()`.
9. System closes ([section 2](#system-closes)), all for that `ride_date`:
   - the passenger's other open invitations, any role: `booked_elsewhere`;
   - the driver's open invitations as a passenger: `booked_elsewhere`;
   - if the car is now full, the driver's open driver-side invitations: `full`; if only the scooter slot filled, those with `brings_scooter`: `full`.
10. Return the ride id.

### Cancel, can't drive, safety

- `cancel_ride(ride_id uuid)`: either participant, while `confirmed` and `ride_date >= today_la` (M-37 later forbids it after "Picked up"). Takes the driver's and passenger's day locks. Sets `cancelled`, `cancelled_at`, `cancelled_by`, `cancel_reason = 'participant'`, `cancelled_late = now() >= ride_cutoff(ride_date, cancel_cutoff_minutes())`. Late cancels are allowed with no penalty (D-02). Invitations closed by the booking stay closed.
- `cant_drive(ride_date date)`: the caller's confirmed rides **as driver** that date become `cancelled` with `cant_drive`; their open driver-side invitations that date close with `cant_drive`. With [Q11](#owner-questions), it also records the date in a new owner-only `driver_days_off (driver_id, ride_date)` table (cascade on the driver), and M-32 extends `match_candidates` and `send_invitation` so the driver doesn't appear, or can't be asked, as a driver that date.
- Safety: an `after insert on blocks` trigger `blocks_cancel_rides` cancels the pair's `confirmed` rides dated today or later with `safety` (not `blocks_end_pair`). `withdraw_member` is replaced again to set `cancel_reason = 'safety'` on the rides it cancels.
- Deletion: `profiles_apply_deletion_policy` is replaced again to set `cancel_reason = 'account_deleted'` on the future rides it cancels and to delete `ride_pickups` of every ride involving the deleted person (the spot is near the passenger's home and the plate is the driver's). `cancelled_by` is `on delete set null`.
- `driver_day(ride_date date)` (definer): for the caller as driver, `seats_total`, `seats_booked`, `scooter_booked`, so M-36 shows real "seats open" instead of the prototype's `seatsOffered - 1`.

### Hooks for later tasks

- **M-37 (completion and expiry):** may add a sweep that writes `expired` onto `pending`/`accepted` rows past `expires_at`. The projection is the same either way (tested here). `picked_up_at`/`arrived_at` belong to rides; `cancel_ride` should refuse once `picked_up_at` is set. Tests call `invitation_state(…, at)` with a fixed time.
- **M-45 (push), per D-13:** fire on invitation insert (new request or invite, to the recipient), ride insert (confirmed, to the passenger), and a ride becoming `cancelled` (to the other participant, "Ride cancelled", reason not shown). **Never** on decline, withdraw, un-accept, expiry, a system close or the end of a hold: each of those is a "no" or looks like one, and a push at the cutoff would differ between "declined" and "expired" only if it fired for one of them, so it fires for neither.
- **M-38:** no schema dependency on invitations.

## 10. Test plan

### `supabase/tests/invitations_test.sql`

Same harness and style as `matching_test.sql`: one transaction, `DO` blocks that `raise exception`, `tests.as_user` / `as_anon` / `as_admin`, commutes saved as admin, the place points and route geometry reused from `matching_test.sql` so Ada (passenger, Webster St → Montgomery) and Bea (vetted driver, Park St → Fremont) match. Ride dates are the next Tuesday/Wednesday at least two days after today in Los Angeles, so the 8 PM cutoff never interferes; cutoff behavior is tested through `invitation_state(…, at)`, `reply_cutoff` and rows whose `expires_at` the admin moves into the past.

1. **Privileges and shape.** `anon` can execute none of the five client RPCs (42501); `authenticated` can execute them and none of the internal helpers or `match_candidates`. No client can select, insert, update or delete `invitations`. Every function is `security definer` (where intended) with `search_path=""`. `my_invitations` has exactly section 5's columns, none of type geography, none named like a status or timestamp other than `reply_by`/`created_at`. The advisor's four indexes and the two new ones exist.
2. **Cutoffs.** `reply_cutoff('2026-10-13') = '2026-10-13 03:00+00'` (PDT); `reply_cutoff('2026-11-02') = '2026-11-02 04:00+00'` (the Sunday DST ends); `reply_cutoff('2027-03-15') = '2027-03-15 03:00+00'` (the Sunday DST starts); `ride_cutoff(d, 1260)` is an hour later. A sent row's `expires_at = reply_cutoff(ride_date)`.
3. **Send, both directions.** Ada requests Bea; Bea invites Ada. Columns as section 3 says: `pickup_area` equals Ada's stored `origin_area` and keeps it after Ada moves her pin out of the area; `pickup_time` defaults to the clamped departure; `kind = 'first_ride'`; `commute_id` is the sender's commute; `seats = 1`; scooter from Ada's commute. Each side's `my_invitations` row shows the right state.
4. **Every refusal, with SQLSTATE and hint.** One case per row of section 3's table and section 6's send/accept rows: not signed in, self, bad role, a time with seconds, suspended caller, today's date (past cutoff), 15 days ahead, no commute that weekday, unvetted caller inviting, no vehicle, caller already booked, caller's car full, time outside the windows, scooter that doesn't fit.
5. **Neutral refusals are identical.** For Bea blocked by Ada, Ada blocked by Bea, a suspended driver, an opted-out driver, an unvetted driver, a non-matching driver (detour), a full driver, a driver with a ride as a passenger that date, an unknown uuid, a deleted member, a paused Crew: the same SQLSTATE, message and hint (compared as text). No row is inserted, and `profile_cards` returns no card for any of them afterwards (M-16's gate).
6. **Rate limits.** The 11th send in a day is `daily_limit` (withdrawn ones count). The 6th open is `pending_limit`; a secretly declined request counts, an expired or withdrawn one doesn't. Per-recipient: a second `first_ride` to the same person on another date is `already_requested` (Q4's per-date rule for `ride_again`/`crew` as approved). Pair-date: a crossed request for the same date is `already_requested`, including when the driver withdrew an accepted invite (held). **Order:** a sender at 10 sends gets `daily_limit` for a blocked recipient, not `unavailable`.
7. **Accept.** A passenger accepts a driver invite → `accepted_confirm_seat` / `accepted_waiting_for_driver`. Accepting a passenger request is `driver_confirms`. A third party, a repeat accept, an accept after the cutoff, and an accept after the driver lost `vetted_at` are `unavailable`. A passenger who already has a ride that date gets `already_booked`.
8. **Decline and withdraw.** Each transition in section 2's table, with both projections checked after each step, and every disallowed action `unavailable`.
9. **D-22: declined vs expired.** Two requests from Ada, to Bea (declined) and to Cy (never answered), same date. With `invitation_state` at `expires_at - 1 second` both are `waiting_for_them`; at `expires_at` both are `unavailable`. Ada's `my_invitations` rows for the two are identical except `id`, `other_id` and `created_at` (compared as `jsonb`), before the cutoff and after it (moving `expires_at` and `held_until` into the past as admin). Ada's open count and `already_requested` behave identically for both. An admin-written `expired` status (M-37's future sweep) projects the same.
10. **Driver withdraws an accepted invite (Q8).** The passenger's projection is identical to an accepted invite the driver ignored, before and at the cutoff.
11. **The waiting party closes a held row.** Ada withdraws the declined request to Bea and the unanswered one to Cy: both calls succeed, both become `closed_by_me` for Ada, and Bea's view stays `closed_by_me`.
12. **Connected exception.** Connected pair, recipient opted out: a send succeeds with `kind = 'ride_again'`. Unconnected and opted out: `unavailable`. A Crew send with an active Crew succeeds as `crew`; paused, ended, another pair's Crew, or a weekday outside the Crew's days: `unavailable`. Blocks and suspension still refuse connected pairs. Q5: an unconnected pair with a completed ride can't send `first_ride` and don't see each other in `find_matches`.
13. **Blocks.** Ada blocks Bea, and separately Bea blocks Ada: pending, accepted and held rows in both directions are closed; held rows end their hold; neither sees the other's rows; every action on them is `unavailable`; a later send is `unavailable`; unblocking restores nothing.
14. **Suspension.** Suspending Bea closes pending, accepted and held rows both ways; others' `my_invitations` omit them; Bea's `my_invitations` is empty and her sends are `unavailable`.
15. **Projection hygiene.** No row for past ride dates or for invitations of other people; `ride_id` is null unless booked; the JSON of every row contains no exact coordinate, `display_name` surname, status word (`declined`, `withdrawn`, `cancelled`, `expired`) or `cancel_reason`.
16. **Matching unchanged.** `find_matches` returns the same rows as before for the matching fixture (apart from Q5); `matching_test.sql` still passes against the three-argument `match_candidates`.

### `supabase/tests/account_deletion_invitations_test.sql`

Own fixture: Ada (to be deleted) and Bea, Cy. Ada has: a pending request to Bea, an invite from Bea she accepted, a request Bea declined (held), a withdrawn request to Cy, an invite to Cy, and one invitation behind a ride with Bea (ride inserted as admin, Ada the passenger). Delete Ada's `auth.users` row:

1. The delete succeeds.
2. Every invitation of Ada's with no ride is gone, both directions and every status.
3. The invitation behind the ride stays, with Ada's column null and `pickup_area`, `pickup_area_label` null; the ride stays (0010's policy, cancelled if future).
4. Bea's and Cy's `my_invitations` show nothing of Ada's; their sends to others still work, and their counts no longer include rows to or from Ada.
5. Every RPC on the kept invitation is `unavailable` for Bea.

## Out of scope

- The booking RPCs and pickup reveal (M-32, from section 9), ride completion and any expiry sweep (M-37), push notifications (M-38, M-45).
- App wiring and copy (M-35, M-36, M-42, M-43, M-44, M-47, M-48). Copy above is a suggestion.
- Counter-proposals, "Move", multi-seat or guest requests, recurring rides created automatically (D-16, docs/mvp.md).
- Rate-limiting reads (`my_invitations`, `find_matches`), and a recipient-side cap on incoming requests.
- Realtime subscriptions on `invitations` (no client grant to subscribe with).
- Editing `docs/mvp-backlog.md` (the coordinator records decisions on the D-02 and D-22 rows and the M-35 card).

## Residual inferences (accepted unless the owner says otherwise)

- **"Unavailable" before the cutoff means something other than the other person's "no".** It covers a withdrawal, booking elsewhere, a full car and "Can't drive". Combined with `find_matches` (a passenger who booked elsewhere disappears for that date, M-26 Q2), a driver can sometimes tell that a requester withdrew rather than booked. A withdrawal is the requester giving up, not an answer, so it isn't a "no" the invariant protects.
- **A passenger's un-accept shows at once** ([Q9](#owner-questions)), at the same disclosure level as a cancelled ride, which D-02 already allows.
- **Disappearing rows** ([Q10](#owner-questions)) mark the "deleted, suspended or blocked" class, as `profile_cards`' "Former member" already does.

## Owner questions

| # | Question | Recommendation | Alternative |
| --- | --- | --- | --- |
| Q1 | **One ride per person per date** (D-02 left it as a suggestion). | **A passenger holds at most one confirmed ride per date; a driver may carry several passengers that date up to their seats; nobody rides in both roles on one date.** Booking closes the other open invitations that become impossible (both people, that date) and, when the car or trunk fills, the driver's leftover ones. Matches M-26's Q2 availability rules. Ask the coordinator to record it on D-02. | Literally one ride per person, so a driver carries one passenger a day. Simpler, but it drops HOV carpools, which matching ranks for. |
| Q2 | **Seats per invitation.** | **Always 1 in the pilot** (`check (seats = 1)`): every rider is an invited, signed-in tester (D-11), so a second seat would carry an unknown, unvetted person. The column stays so a later migration can widen it. M-35's "seats and cargo editor" edits only the scooter. | 1 to `seats_open`, with an editor. |
| Q3 | **Read path.** The card asks for "participant-only select". | **Keep the participant-only policy, but grant clients no table access; read through `my_invitations()`.** The raw status and timestamps reveal a decline (D-22), and RLS can't hide blocked pairs. | Column-level grants on harmless columns. Fragile: every new column needs a leak review, and blocked pairs still show. |
| Q4 | **"1 pending per recipient"** (D-02). | **One open invitation from a sender to a given recipient at a time, any date, for `first_ride`; one per recipient per date for `ride_again` and `crew`,** so a Crew can line up its week (each Crew ride is still a separate, dated invitation). The 5-open and 10-a-day limits still apply to all kinds. | Literal for every kind: a Crew invites one day at a time. |
| Q5 | **Another First Ride after a completed one with no Ride Again.** | **Refuse it (`unavailable`), and hide such pairs from each other in matching.** Ride Again exists to make future rides mutual; otherwise a "no" in post-ride feedback still lets the other person keep asking. Both people already see that they have no Ride Again, so this reveals nothing new. A cancelled ride doesn't count. This changes M-26's approved output for those pairs. | Allow repeat First Rides; the recipient declines or blocks. |
| Q6 | **Ride Again and Crew invites skip the recipient's discovery opt-in** (the card's suggested default). | **Yes**, for connected pairs (and an active Crew) only. Every other match rule still applies, as do blocks, suspension and vetting. | Opt-in applies to every invitation. |
| Q7 | **How far ahead can someone request?** | **14 days.** It bounds how long an invitation sits in the 5-open limit and narrows M-26's "booking calendar" inference. | No limit. |
| Q8 | **A driver withdraws an invite the passenger already accepted.** D-22 covers a decline; this is the same "no" from the side that owes the answer. | **Hold it like a decline:** the passenger sees "accepted, waiting for confirmation" until the cutoff, then "This ride isn't available anymore". | Show it at once. Simpler, but the passenger learns the driver said no. |
| Q9 | **Can a passenger un-accept before the driver confirms?** | **Yes,** with `decline_invitation`; the driver sees "This ride isn't available anymore" at once (the driver isn't waiting on the passenger at that point, and it can't be held: the driver's confirm would have to fail). | No un-accept; the passenger cancels after booking (by 9 PM, no penalty). |
| Q10 | **Invitations with a blocked, suspended or deleted counterpart.** | **Omit them from `my_invitations`,** the same as deletion (which D-15 makes delete them) and `profile_cards` (no card). | Show them as "unavailable" with no counterpart. Then a block or suspension would look different from a deletion. |
| Q11 | **"Can't drive" for a date (M-32).** | **Record the day off** so the driver doesn't appear, and can't be requested, as a driver that date; otherwise passengers whose ride was just cancelled see the driver still available. | Cancel the rides only. |
| Q12 | **Who sets the kind?** M-35's card says the app passes it. | **The server derives it**: `crew` with a valid `crew_id`, `ride_again` when connected, else `first_ride`. The app passes `crew_id` only. Nothing to forge, no mismatch errors. The coordinator updates M-35's card wording. | The app passes `kind`; the server refuses a mismatch. |

D-22 is Decided and applied as written (section 2). D-06's 2026-10-10 update is applied (`not_vetted`, and unvetted drivers are unavailable as recipients). No other open D-row blocks this design.
