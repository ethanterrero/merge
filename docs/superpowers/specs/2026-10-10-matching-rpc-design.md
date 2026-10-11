# Server-side matching RPC: design (M-26)

**Date:** 2026-10-10
**Task:** M-26
**Status:** Approved by the owner on 2026-10-10. Q1–Q7 were approved as recommended. Q8 was changed: the detour leaves the function only as a band (`under_3` or `3_to_5`), never as whole minutes. See [Owner questions](#owner-questions).
**Scope:** `supabase/migrations/0015_matching.sql`, `supabase/tests/matching_test.sql`, `apps/mobile/src/lib/database.types.ts` (CI artifact only)
**Builds on:** `0001_initial.sql` and `0004_vehicles_commutes_rls.sql` (owner-only `commutes` and `vehicles`), `0003_first_ride.sql` (`rides`, `connections`), `0005_blocks_reports.sql` (`is_blocked`), `0008_commute_privacy.sql` and `0009_east_bay_neighborhoods.sql` (stored areas and labels, seats, cargo, ride preferences), `0010_account_deletion.sql`, `0011_member_status.sql` (`is_active`, `is_vetted`, `public_name`), `0012_detour_estimate.sql` (`estimate_detour_minutes` and its constants)
**Consumers:** M-27 (invitations re-check eligibility), M-42 (Discover and Match detail), M-49 (adds trust stats to the result), M-41 (may add a cohort filter), M-52 (security audit)

The migration number is **0015**. The card's planned 0010 was taken by account deletion, and M-16 holds 0014. The usual rule applies at merge: if main has a migration at or above 0015 by then, rename this one above it.

## Problem

Discover reads the static `MATCHES` array. `profiles`, `commutes` and `vehicles` are owner-only under RLS, so no client can read anyone else's commute, and it must stay that way: exact points never leave the server. Real discovery needs one `security definer` function. It reads everyone's commutes as its owner, applies every hard filter, ranks with M-33's detour estimate, and returns only what the privacy invariants allow before a ride is confirmed.

## Decisions this design rests on

| Source | What it fixes here |
| --- | --- |
| D-05 (Decided) | No women-only filter and no gender data. Nothing in matching reads or returns gender. |
| D-06 (Decided) | Owner vetting sets `profiles.vetted_at`. Whether vetting gates discovery was left as a suggestion: [Q1](#owner-questions). |
| D-08 (Decided) | No routing provider. Detour comes only from `public.estimate_detour_minutes` (0012): straight-line insertion cost ×1.35 at 25 mph, whole minutes, with a direction check. |
| D-14 (Decided) | Only people with `discovery_opt_in = true` are returned to others. The caller doesn't need to be opted in to browse. |
| D-04 (Decided) | A passenger who brings a scooter matches only a driver whose vehicle fits one. |
| D-16, D-02, D-22 | Matching doesn't touch requests. M-27 re-checks eligibility through the same helper (section 4). |
| Commute privacy spec #1, #4, #5, #7, #10, #12 | Exact points are owner-only. Preferences rank and never filter. Seats use `least(seats_offered, passenger_seats)`. Discovery never returns make, model, color or plate. M-33 returns whole minutes, and since Q8 matching narrows that further to a band. Probing by repeated pin edits is an accepted pilot risk. |
| Member status spec | Every place two people meet filters with `public.is_active(other)` and `not public.is_blocked(me, other)` inside its own `security definer` code. Names go out only as `public.public_name(display_name)`. |
| Backlog privacy invariants | Before confirmation, others see only first name and last initial, role, approximate (~0.5 mi) areas, ride preferences and verification flags. Blocked pairs and suspended members never appear to each other. |

## Approaches considered

1. **One `security definer` SQL function, computed on every call (chosen).** The pilot pool is at most 100 testers, so at most 200 commute rows. Every hard filter is a cheap column test, and the only geometry is four distances and two azimuths per surviving pair. Nothing derived from someone else's exact point is stored, and there's no cache to invalidate when a commute, block or suspension changes.
2. **A precomputed `matches` table, kept current by triggers on commutes, profiles, blocks and rides.** It's faster at scale, but it stores cross-user derived data, multiplies the places blocks and suspensions must be honored, and goes stale between trigger runs. Not worth it at pilot size.
3. **An Edge Function using the service role.** It would move exact points out of Postgres into a function runtime and its logs, add a deploy (O-09) and a secret, and need its own block and suspension logic. Rejected.

A variant of approach 1 was also rejected: computing detour from the other person's **area centers** instead of exact points. That would make the result depend only on public data. But an area center sits up to 402 m from the pin, and four such offsets move the estimate by up to about 3 minutes, which is too coarse for a 5-minute limit. The result would also be asymmetric (A sees B but B doesn't see A). Commute privacy decision 12 already accepted exact-point detour with whole-minute output. Q8 narrows what leaves matching to a two-value band.

## 1. The RPC

```sql
public.find_matches(ride_date date, role_filter text default 'all')
returns table (...)        -- columns in section 3
language plpgsql
stable
security definer
set search_path = ''
```

- **`ride_date`**: the date to match for. Commutes are weekly patterns, but seats and existing rides are per date (section 2, rules 10–11), so the result depends on the date and not only on its weekday.
- **`role_filter`**: the **other** person's role. `'all'` (the default) or `null` returns both; `'driver'` returns only drivers; `'passenger'` returns only passengers. This maps directly to Discover's All / Drivers / Passengers control. Any other value raises `22023`.
- The parameter names are the PostgREST JSON keys M-42 sends, so they stay `ride_date` and `role_filter`. `ride_date` is also a column of `rides`. The body must qualify every column reference and declare `#variable_conflict use_column` (or qualify the parameter as `find_matches.ride_date`).

### Caller checks

| Situation | Result |
| --- | --- |
| `auth.uid()` is null (anon is revoked; this covers the service role and migrations) | Raise `42501` |
| `ride_date` is null, or before today in America/Los_Angeles | Raise `22023` |
| `role_filter` not in (`all`, `driver`, `passenger`, null) | Raise `22023` |
| The caller has no profile | Empty set |
| The caller is suspended (`suspended_at` set) | **Empty set.** This is the card's "refuse", in the form the member-status spec's decision 3 wants: a suspended person's own app shows nothing special. It reads as "No matches yet", reveals nothing, and needs no new error copy. |
| `ride_date` is a Saturday or Sunday | Empty set (commutes are Monday to Friday only) |
| The caller has no commute whose `weekdays` include the date's ISO weekday | Empty set. M-42 detects "Set up your commute" from the caller's own commute row, not from this. |
| The caller isn't opted in | **Results as normal** (D-14: anyone may browse) |

There's no upper bound on `ride_date`. Results for a far date differ from a near one only in seat counts, and M-42's date selector already limits dates to requestable ones. Matching doesn't apply the 8 PM request cutoff (D-02). M-27 enforces it when a request is sent.

## 2. Eligibility: hard filters

A **pair** is one of the caller's commutes, `mine`, and one other person's commute, `theirs`, with opposite roles. The driver side is `drv` (with vehicle `v`), and the passenger side is `pax`. A person with role "Both" has two commute rows (commute privacy section 8), so they can appear twice, once per role. The unique key of a result row is `(other_id, role)`.

Every filter runs inside the definer code. None of them is an RLS policy or a view.

| # | Rule | SQL |
| --- | --- | --- |
| 1 | Not yourself | `theirs.owner_id <> me` |
| 2 | Opposite roles | `theirs.role <> mine.role` |
| 3 | The other person opted in (D-14) | `p.discovery_opt_in` |
| 4 | The other person is active | `public.is_active(theirs.owner_id)` |
| 5 | Not blocked, in either direction | `not public.is_blocked(me, theirs.owner_id)` |
| 6 | Vetting gate ([Q1](#owner-questions), recommended on): an unvetted person never appears **as a driver** | `theirs.role <> 'driver' or public.is_vetted(theirs.owner_id)` |
| 7 | The weekday is in both schedules | `dow = any(mine.weekdays) and dow = any(theirs.weekdays)`, where `dow = extract(isodow from ride_date)` |
| 8 | Departure windows overlap ([Q5](#owner-questions)) | `abs(gap) <= mine.departure_flex_minutes + theirs.departure_flex_minutes`, where `gap` = their departure minus mine, in whole minutes. There's no wrap past midnight (morning commutes). |
| 9 | The driver commute has a vehicle | `drv.vehicle_id is not null`. This holds on both sides: a driver commute whose vehicle was deleted neither matches nor is matched (commute privacy section 5). |
| 10 | Seats open on that date ([Q2](#owner-questions)) | When the other person is the driver: `seats_open > 0`, where `seats_open = least(drv.seats_offered, v.passenger_seats) - count(rides where driver_id = drv.owner_id and ride_date = ride_date and status in ('confirmed','completed'))` |
| 11 | The other person's date isn't used up ([Q2](#owner-questions)) | As a passenger: no ride that date in either role, with status `confirmed` or `completed`. As a driver: no such ride as a passenger (driving other people is covered by rule 10). The caller's own rides don't filter anything: M-27 and M-32 refuse a request the caller can't take. |
| 12 | Cargo fits (D-04) | `not pax.brings_scooter or v.accepts_foldable_scooters` |
| 13 | Detour is within the limit | `d := public.estimate_detour_minutes(drv.origin, drv.destination, pax.origin, pax.destination)`, then `d is not null and d <= least(public.detour_limit_minutes(), drv.max_detour_minutes)`. A null result (the pickup doesn't come before the drop-off) fails. |

Notes:

- **Rule 13 calls M-33's function once per surviving pair and reimplements nothing.** `drv.max_detour_minutes` (0001; default 5, range 0–60) only makes the limit tighter, never looser. No screen sets it today, so in practice the limit is 5.
- **Ride preferences never filter** (commute privacy decision 4). They only rank (section 5) and appear on the card.
- **Pending invitations don't filter.** A pair with a pending request still appears. M-42 can show the caller's own request state from `invitations`, which M-27 makes participant-readable.
- **Deleted members** are gone by cascade (`auth.users` → `profiles` → `commutes`), so matching never shows a "Former member".
- **Cheap rules run first.** Rules 1–12 are column tests and index lookups. `is_blocked`, `is_active` and `is_vetted` are single-row primary-key lookups. Rule 13 runs last, on the pairs that are left.

## 3. What each row returns

No column has type `geography` or `geometry`. The only column computed from exact points is `detour_band`, which has two values. Exact detour minutes are used inside the function for filtering and ranking, and never appear in any returned column (Q8).

| Column | Type | Value |
| --- | --- | --- |
| `other_id` | `uuid` | The other person's profile id. M-27's `send_invitation` and M-16's `profile_cards` need it. |
| `role` | `text` | The other person's role **in this match**: `driver` or `passenger` |
| `name` | `text` | `public.public_name(p.display_name)`. Never the raw `display_name`. |
| `vetted` | `boolean` | `public.is_vetted(other_id)`. This is the D-06 verification flag; the app shows the badge only when it's true. |
| `ride_prefs` | `text[]` | The other person's `profiles.ride_prefs` (`quiet`, `smoke_free`) |
| `origin_area_lat`, `origin_area_lng` | `double precision` | The **stored** `theirs.origin_area` center, through `extensions.st_y` and `extensions.st_x` on its geometry. Never recomputed. |
| `origin_area_label` | `text` | The stored `theirs.origin_area_label` |
| `destination_area_lat`, `destination_area_lng`, `destination_area_label` | same | The same, for the destination |
| `area_radius_m` | `integer` | 402, from `public.area_radius_m()`, so the client draws the circle the server means |
| `shared_weekdays` | `integer[]` | ISO weekdays in **both** commutes, sorted: the intersection, never the other person's full schedule |
| `departure_time` | `time` | The other person's departure time ([Q4](#owner-questions)) |
| `window_start`, `window_end` | `time` | The other person's departure time ± their flex, clamped to the day ([Q4](#owner-questions)) |
| `departure_gap_minutes` | `integer` | Their departure minus mine, signed. The card shows "Departs, 5 min early". |
| `detour_band` | `text` | From rule 13's whole minutes `d`: `under_3` when `d` ≤ 2 (under 3 minutes), `3_to_5` when `d` is 3–5. When the caller is the driver, it's the caller's own detour. A driver whose `max_detour_minutes` is below 5 needs no special case: rule 13 has already dropped every pair above their limit, so the band only says which range the surviving estimate falls in. A limit of 0–2 yields only `under_3`; 3 or 4 yields both bands, and `3_to_5` then means "3 up to their limit". The band never shows the limit itself. |
| `seats_offered` | `integer` | Driver rows: `least(seats_offered, passenger_seats)`. Passenger rows: null. Used for "N of M seats open". |
| `seats_open` | `integer` | Driver rows: rule 10's value. Passenger rows: null. |
| `brings_scooter` | `boolean` | Passenger rows: whether they bring one. Driver rows: null. |
| `scooter_fits` | `boolean` | Driver rows: `v.accepts_foldable_scooters`. Passenger rows: null. |
| `connected` | `boolean` | A `connections` row exists for the pair (Ride Again). Both people can already read that row, so it reveals nothing new. Its absence looks the same whether the other person said "no" or never answered. |
| `reasons` | `jsonb` | An array of `{code, label, ok}` objects (section 6) |
| `rank` | `integer` | 1..n in the order of section 5, so the client never re-sorts |

**Never returned:** exact `origin` or `destination`, anything computed from them except the two-value detour band, exact detour minutes, `display_name`, email, `vetted_at` and `suspended_at` timestamps, `profiles.role`, commute ids, vehicle id, make, model, model year, color, plate, `max_detour_minutes`, `departure_flex_minutes` as a separate field, the other person's full weekday list, and any distance.

The result is capped at **50 rows** after ranking. That's more than one screen of cards, and it bounds the work a single call can ask for.

## 4. Structure

Two functions, both `set search_path = ''`, with every name schema-qualified (`extensions.st_*`, `public.*`):

| Function | Kind | Who can execute | Purpose |
| --- | --- | --- | --- |
| `public.match_candidates(me uuid, ride_date date)` | `stable`, **invoker**, returns a table | Nobody (revoked from `public`, `anon`, `authenticated`) | Section 2's rules for any member. Returns raw pair fields: `my_commute_id`, `other_commute_id`, `other_id`, `role`, `detour_minutes` (exact whole minutes, internal only), `departure_gap_minutes`, `shared_weekdays`, `seats_offered`, `seats_open`, `pax_brings_scooter`, `scooter_fits`, `shared_prefs`, `connected`, `reaches_hov`. Seat and scooter fields are filled for every row; `find_matches` nulls the ones that don't apply to the other person's role. |
| `public.match_prefilter(driver_origin, driver_dest, pax_origin_area, pax_dest_area)` | `immutable` SQL, returns boolean | Nobody | Section 7's area prefilter, factored out so a test can check it on its own |
| `public.match_days_label(days integer[])` | `immutable` SQL, returns text | Nobody | Section 6's `days` label |
| `public.find_matches(ride_date date, role_filter text)` | `stable`, **security definer** | `authenticated` only (revoked from `public`, `anon`) | Caller checks (section 1), `match_candidates(auth.uid(), ride_date)`, the role filter, presentation columns (section 3), reasons, ranking and the cap |

Why the split:

- **M-27 re-checks with the same rules.** `send_invitation` (its own `security definer` function) can test `exists (select 1 from public.match_candidates(sender, ride_date) where other_id = recipient and role = ...)`, so a request can't be sent to someone discovery would hide. Whether `ride_again` and `crew` invites skip opt-in (the M-27 card suggests they do) is M-27's call. It can add a parameter to `match_candidates` by `create or replace`, copying this definition first.
- **M-41 and M-49 have one place to extend.** A cohort filter belongs in `match_candidates`. Trust stats belong in `find_matches`'s output.
- **`match_candidates` is invoker on purpose.** It runs as the owner only when a definer function calls it. If a grant were ever added by mistake, a client calling it would still see only its own commutes under RLS (and would fail on `is_blocked`, which it can't execute).

## 5. Ranking

Sort keys, in order:

1. Exact `detour_minutes` ascending. This is computed internally and never returned (Q8). The rank order shows which of two candidates is the shorter detour, but not by how much.
2. `abs(departure_gap_minutes)` ascending
3. `connected` first ([Q3](#owner-questions): recommended here, as a tie-breaker, not pinned to the top)
4. Number of shared ride preferences, descending
5. `cardinality(shared_weekdays)` descending (recurring-schedule fit)
6. `reaches_hov` first ([Q7](#owner-questions)): the driver plus this passenger plus the driver's confirmed passengers that date make at least 3 people. It's only a ranking key. It's never shown, and nothing claims carpool-lane eligibility or time savings.
7. `other_id`, then `role`, for a deterministic order

## 6. Reasons

Built in SQL from the pair's fields, in this order. Labels follow the prototype's existing copy in `mock.ts` ([Q6](#owner-questions)). No reason mentions a distance, a place finer than an area label, carpool lanes, or vetting (vetting is the badge).

| Code | When | Label | ok |
| --- | --- | --- | --- |
| `detour` | Always | "Under 3 min detour" (`under_3`) or "3–5 min detour" (`3_to_5`) | true |
| `time` | \|gap\| ≤ 5 | "Same departure window" | true |
| `time` | \|gap\| > 5 | "Leaves N min earlier" or "Leaves N min later" | **false** (still a match, just a looser fit) |
| `days` | Always | "Every weekday" for Mon–Fri. Otherwise "{days} overlap": a range for 3 or more consecutive days, otherwise a list, with pieces joined by commas ("Mon–Thu overlap", "Mon, Wed overlap", "Mon–Wed, Fri overlap") | true |
| `cargo` | The caller is the passenger and brings a scooter | "Your scooter fits" | true |
| `cargo` | The caller is the driver and the passenger brings a scooter | "Brings a foldable scooter" | true |
| `pref_quiet` | Both list `quiet` | "Both prefer quiet rides" | true |
| `pref_smoke_free` | Both list `smoke_free` | "Both prefer smoke-free" | true |
| `connected` | `connected` | "You've ridden together" | true |

The structured columns in section 3 carry the same facts, so a later UI can render its own copy without a migration.

## 7. Performance

- **Scale assumption:** at most 100 members and 200 commutes in the pilot. One call does at most about 100 pair evaluations, each with a few primary-key lookups and one detour estimate. That's well under 10 ms. No caching.
- **New indexes:** GiST on `commutes (origin_area)` and `commutes (destination_area)`. 0008 created neither, and the card asks for them. They support the prefilter below, and later area queries such as M-29's picker.
- **Area prefilter (when the caller drives).** A passenger can only be within the limit if both of their points lie inside the ellipse with foci at the driver's origin and destination and major axis `L + D`, where:
  - `L` is the driver's direct distance;
  - `D = (detour_limit_minutes() + 0.5) × detour_speed_mph() × 1609.344 / 60 / detour_road_factor()`, about 2,732 m. That's the largest insertion cost that still rounds to 5 minutes, derived from M-33's constants, never hard-coded.

  That ellipse lies inside the disc around the route's midpoint with radius `(L + D) / 2`. Each exact point is within 402 m of its area center, so the prefilter is

  ```
  extensions.st_dwithin(pax.origin_area,      mid, (L + D) / 2 * 1.01 + area_radius_m())
  and extensions.st_dwithin(pax.destination_area, mid, (L + D) / 2 * 1.01 + area_radius_m())
  ```

  `mid` is `extensions.st_project(drv.origin, L / 2, extensions.st_azimuth(drv.origin, drv.destination))`. The 1% covers the planar approximation over Bay Area distances. Because `mid` comes from the caller's own commute, the GiST index can serve it. It's a necessary condition only: rule 13 still decides, and a test proves the prefilter never drops a pair rule 13 accepts.
- **When the caller rides,** there's no index-friendly bound on the drivers' points: a far-away driver whose route passes through the pickup has a detour near zero. The scan is over driver commutes on that weekday after the cheap rules, which at pilot scale is at most about 100 rows. Post-pilot, if needed: store a route line per driver commute and use `st_dwithin(route, pickup, b)` with a constant `b` from the ellipse's semi-minor axis.
- `blocks` is served by its primary key in both directions (0005). `rides` per driver is served by `rides_driver_id_idx` (0003). `connections` is served by its primary key.

## 8. Privacy and safety

- **Exact points stay inside the function.** Only areas, labels and the two-value detour band leave it. A test asserts that no returned value equals an exact coordinate, and that the returned centers equal the stored areas.
- **Stable areas.** The areas are the stored columns (commute privacy section 2), so repeated calls return identical circles. A test asserts this.
- **Blocks and suspension both ways.** If A blocked B, neither sees the other in any role. A suspended member appears to nobody, and their own calls return nothing. Both checks run inside the definer code, and `is_blocked`, `is_active` and `is_vetted` stay non-executable for clients.
- **No error carries data.** Only the fixed errors in section 1 are raised. Nothing that touches an exact point can raise with a value in its message.
- **Accepted residual risks**, all inside decisions already taken:
  - *Probing by pin edits* (commute privacy decision 12, narrowed by Q8). A member can move their own pins and watch another person's detour band, their rank, or whether they're in or out of the results, to narrow down that person's exact point. Banding cuts each observation from about 6 values (0–5 minutes) to 2, so it takes many more pin edits to learn the same amount. Invite-only and at most 100 testers. **Revisit before a wider launch:** an edit cool-down on commute points, coarser or noisier bands, or a per-caller call budget.
  - *Date inference* ([Q2](#owner-questions)). `seats_open` shows how many seats a driver has filled that date, and a passenger who disappears for one date probably has a ride that day.
  - *Schedule fields* ([Q4](#owner-questions)). The other person's departure time and window, and the days you share, are visible before confirmation.
- **No new tables or foreign keys**, so there's nothing new for the deletion policy. `supabase/tests/account_deletion_matching_test.sql` isn't needed. `matching_test.sql` still checks that a deleted member disappears from results.

## 9. Grants

```sql
revoke execute on function public.match_candidates(uuid, date) from public, anon, authenticated;
revoke execute on function public.find_matches(date, text) from public, anon;
grant  execute on function public.find_matches(date, text) to authenticated;
```

The test shim grants execute on every new function by default, so the revokes are explicit and the tests check them. `find_matches` runs as the migration owner, which already has execute on `is_blocked`, `is_active`, `is_vetted`, `estimate_detour_minutes`, `detour_limit_minutes`, `area_radius_m` and `public_name`.

## 10. Tests: `supabase/tests/matching_test.sql`

Sixteen groups, in the same harness and style as `member_status_test.sql` and `detour_estimate_test.sql`: one transaction, `DO` blocks that `raise exception`, and identity switched with `tests.as_user`, `tests.as_anon` and `tests.as_admin`. Commutes are saved as their owner, so the area trigger's owner check passes. `vetted_at`, `suspended_at`, blocks set up as admin and rides are written as admin. Ride dates are relative to today in America/Los_Angeles, using the next date whose ISO weekday is in the fixture's schedules. Places reuse the detour test's Bay Area points: Park St and Webster St in Alameda, Montgomery and Fremont in the Financial District, Rockridge and Lake Merritt in Oakland.

**Fixture:** a passenger caller (Ada, Webster St → Montgomery, 7:45, flex 15, brings a scooter), a vetted driver who matches (Bea, Park St → Fremont, 7:40, vehicle fits a scooter, a 2-minute detour), and one driver per filter, each failing exactly one rule: opted out, suspended, blocked by Ada, blocked Ada, unvetted, no vehicle, wrong weekday, window just outside, detour too long (Lake Merritt → FiDi, 8 minutes), wrong direction (FiDi → Alameda), a `max_detour_minutes` below the estimate, seats full on the date, a trunk with no scooter room, and a driver with a confirmed ride as a passenger that date. Plus a "Both" member with two commutes, a driver caller with passenger candidates, and a connected pair.

1. **Privileges and shape.** `anon` can't execute `find_matches` (42501). `authenticated` can. Neither can execute `match_candidates`. `find_matches` is `security definer` with `search_path=""`, and `match_candidates` is invoker. No output column of either has type `geography` or `geometry`.
2. **Caller checks.** No `auth.uid()` raises 42501. A null or past `ride_date` raises 22023. A bad `role_filter` raises 22023. These return empty: a Saturday, a caller with no profile, a caller with no commute on that weekday, a suspended caller. A caller who isn't opted in still gets results.
3. **The match.** Ada sees Bea once, as a driver, with `detour_band = 'under_3'`. A driver from near Laney College, Oakland, gets `3_to_5` (4 minutes). A driver whose `max_detour_minutes` is 2 on a 2-minute pair is included, and one whose limit is 3 on the 4-minute pair is excluded. Seats, `scooter_fits`, `shared_weekdays`, `departure_gap_minutes`, the window and `name = 'Bea B.'` are as expected.
4. **Each hard filter.** Every one-rule-failing driver is absent, and Bea is present in the same call. The window check also includes the boundary: a gap equal to the sum of the flexes is included, and one minute more is excluded.
5. **Both directions.** Blocked pairs (either blocker) are invisible to each other in both roles. A suspended member is invisible as a driver and as a passenger. The driver caller sees Ada and the other passengers through the same rules.
6. **Role filter.** `'driver'` returns only drivers. `'passenger'` returns only passengers. `'all'` and null return both. The "Both" member appears once per role when both rows match.
7. **Privacy.**
   - Each row's area lat/lng equals the stored `origin_area` and `destination_area` of that commute, and its labels equal the stored labels and `area_label(center)`.
   - No returned number equals an exact `origin` or `destination` coordinate.
   - The JSON text of every row contains none of these: the raw `display_name` surname, the vehicle's make, model, color or plate, an email, or a `vetted_at` or `suspended_at` value.
8. **Stability.** Two calls in a row return identical rows (compared as `jsonb`). Editing only the other person's `departure_time` keeps their areas.
9. **Date effects.** A confirmed ride lowers the driver's `seats_open` by one, and the driver disappears at 0. A passenger with a confirmed ride that date disappears. A driver with a confirmed ride as a passenger that date disappears as a driver.
10. **Ranking.** Fixture drivers that differ in one key at a time come back in section 5's order, and `rank` is 1..n with no gaps.
11. **Reasons.** Exact `{code, label, ok}` arrays for Bea, for a driver 10 minutes later (`time` with ok false), and for the connected pair (`connected`). There's no reason whose code or label mentions vetting, HOV or carpool lanes.
12. **Connections.** `connected` is true only with a `connections` row. A pair where one person answered "no" and a pair where nobody answered return identical rows.
13. **No exact minutes leave the function (Q8).** `find_matches`'s output columns are exactly the list in section 3, none is named like `detour_minutes`, `detour_band` only takes `under_3` and `3_to_5`, and every `detour` reason label is one of the two band labels.
14. **The prefilter is a superset.** As admin, over a grid of passenger points around several driver routes, every pair where `estimate_detour_minutes` passes rule 13 also passes the prefilter predicate.
15. **Deletion.** Deleting Bea's `auth.users` row removes her from Ada's results, and the call still succeeds.
16. **Other suites.** Every earlier suite still passes. Nothing here redefines an existing function.

## 11. For the tasks that consume this

- **M-27:** re-check with `public.match_candidates(sender, ride_date)` inside `send_invitation`. It returns no commute ids, so the invitation picks its own commute rows server-side. Copy the definition before adding a parameter.
- **M-42:** the row key is `(other_id, role)`. Draw circles from `*_area_lat`, `*_area_lng` and `area_radius_m`. Show `reasons` as given; the detour shows as its band ("Under 3 min detour" / "3–5 min detour"), never as minutes. The vehicle card is "{seats_open} of {seats_offered} seats open · cargo fits" from `scooter_fits` (D-04). There's no make, model or color anywhere. The rows come back in `rank` order.
- **M-49:** add stats columns to `find_matches`'s output (copy the latest definition first). `vetted` is already there.

## Out of scope

- Requests, accept, decline, expiry, rate limits, and the 8 PM request cutoff (M-27). Booking, seat reservation and pickup reveal (M-32).
- App wiring, the date selector, map circles and empty states (M-42). Copy outside the reason labels.
- Trust stats (M-49) and a review cohort (M-41).
- A drive-time offset between the driver's departure and the pickup. It would be another exact-point-derived number, and the departure windows already absorb it at pilot distances.
- Multi-passenger route optimization (automatic multi-stop grouping is out of v0.1). Each pair is judged on its own.
- Real routing. Post-pilot, it can go behind `estimate_detour_minutes`'s signature with no change here.
- Rate-limiting `find_matches` calls (see the residual risks in section 8).

## Owner questions

Owner review, 2026-10-10: Q1–Q7 approved as recommended; Q8 changed to banded detours. Q1 and Q2 close suggestions that the D-06 and D-02 rows left open, and the coordinator records them on those rows.

| # | Question | Recommendation | Alternative |
| --- | --- | --- | --- |
| Q1 | **D-06 vetting gate in discovery.** Can an unvetted member appear as a driver? | **No.** Rule 6 hides unvetted drivers from everyone; their passenger commute still matches. An unvetted driver may still *browse* passengers, the way D-14 lets anyone browse. M-27 should refuse their driver invites, and M-32 their confirmations. | Show unvetted drivers without the badge and gate only at confirmation (M-32). Passengers might then request rides that can never be confirmed. |
| Q2 | **Per-date availability.** Should matching hide people whose date is already used up, and net out booked seats? This builds on D-02's suggested "one confirmed ride per person per date" and commute privacy section 8. | **Yes**, for the other person only: rules 10–11. `seats_open` is net of confirmed rides, a full driver disappears, and a passenger with a ride that date disappears. The caller's own rides don't filter their results. | Ignore rides in matching and let M-27/M-32 refuse. That's less inference (no `seats_open` drop, nobody disappears), but cards would show seats that aren't there. |
| Q3 | **Ride Again pairs in ranking.** | **Tie-breaker after detour and time gap**, plus the reason "You've ridden together". Ride Again keeps its own screen (M-28). | Pin connected pairs to the top of Discover. |
| Q4 | **Schedule fields before confirmation.** The invariant names "role, approximate areas, ride preferences and verification flags", while the card asks for shared days and a departure window. | **Return** the other person's departure time, their ± flex window and the **shared** weekdays only, and treat them as part of "the match" in the invariant's wording. Cards can't explain fit without them. | Return only the signed gap and the shared weekdays, and hide their actual time and window until they accept. |
| Q5 | **Window rule.** | **The windows overlap:** \|gap\| ≤ my flex + their flex, so 30 minutes apart at the default ±15. A time exists that's inside both people's flex. | Stricter: \|gap\| ≤ min(flexes), at most 15 minutes apart by default. Fewer matches in a 100-person pool. |
| Q6 | **Reason copy lives in SQL.** | **Yes:** `{code, label, ok}` with the labels in section 6, reusing the prototype's wording. The card asks for server reasons, and the codes let the UI replace labels later. | Return only codes and structured fields, and have M-42 write the copy. |
| Q7 | **Carpool-occupancy tie-breaker.** | **Yes, internal only:** favor a pairing that brings the car to 3 or more people, as a late tie-breaker. It's never displayed, so nothing claims eligibility or time savings. | Drop it. The ranking loses a key that mvp.md asks for, but nothing visible changes. |
| Q8 | **Probing by pin edits** (commute privacy decision 12, accepted at M-18). `find_matches` is now the real, unthrottled channel. | Recommended: keep accepting it for the pilot with whole minutes. **Owner's answer (2026-10-10): keep accepting it for the pilot, but return the detour only as a band** (`under_3`, `3_to_5`). Exact minutes may drive filtering and ranking inside the function, and never appear in a returned column. No call rate limit. Revisit before a wider launch (section 8). | Add a per-caller call budget now (for example 60 calls an hour) in a small table. That adds a table and a write on a read path. |
