# Saved commutes and vehicles: privacy design

**Date:** 2026-10-08
**Task:** M-18, phase 1 (design only)
**Status:** Draft, awaiting owner approval. Migration `0008_commute_privacy.sql` and its tests come after approval.
**Builds on:** `0001_initial.sql`, `0002_profiles_rls.sql`, `0003_first_ride.sql`, `0004_vehicles_commutes_rls.sql` (owner-only RLS, composite `(vehicle_id, owner_id)` key).

## Decisions for the owner

Each row is a recommendation. Approve it, or pick the alternative (or something else).

| # | Question | Recommendation | Alternative |
| --- | --- | --- | --- |
| 1 | Who can read exact origin/destination points? | **Owner only**, through the 0004 RLS policies, unchanged. Other people's points are read only inside `security definer` functions, which never return a point or anything finer than an area. | None. This is a fixed invariant. |
| 2 | How is the ~0.5 mi area made? | **A stored random-offset circle.** On save, the server picks a center at a uniformly random spot within 0.25 mi (402 m) of the exact point, using a secure random source, and stores it. The area is the 402 m circle (0.5 mi wide) around that center, so it always contains the exact point. The center never changes on re-query. Moving the pin keeps the same area while the pin stays inside it. A pin that matches any of the owner's existing areas reuses that area. | **Snap to a fixed grid** of about 0.0073° lat × 0.0091° lon (0.5 mi square at 37.8°N). There's no secret and no randomness, but the pin can sit in a corner, 0.35 mi from the shown center. A small pin move across a cell edge also shows the point is right at that edge. |
| 3 | Area label ("Park St area, Alameda") | **A fixed list of pilot places**, stored in a `pilot_places` table and picked by the person. The picker sorts places by distance from the stored area center, never from the exact pin. | Free text typed by the person. People would type addresses, so it needs moderation and can't be checked. |
| 4 | Ride preferences (quiet, smoke-free) | **Preferred, not mandatory**, for the pilot. They're shown on cards and used for ranking, but never hide a match. Stored as `profiles.ride_prefs text[]`, limited to `quiet` and `smoke_free`. No women-only and no gender (D-05). | **Mandatory** (as `docs/mvp.md` puts it): add `required_ride_prefs text[]`. A required pref matches only people who also chose it. That shrinks a pool of ≤100 testers. |
| 5 | Seats offered | **`commutes.seats_offered`**, required on driver commutes and null on passenger commutes. A trigger rejects more seats than the linked vehicle has. Lowering a vehicle's seats lowers its commutes' offers to match. | Reject the vehicle edit until the commutes are lowered, or check only at match time. |
| 6 | Cargo (D-04) | **Two booleans.** Passenger: `commutes.brings_scooter`. Driver: the existing `vehicles.accepts_foldable_scooters`, meaning "my trunk fits one". D-04 fixes the size and weight, so they aren't stored. The driver approves each scooter at confirmation (booking task). | Store the scooter's type, size and weight per passenger. That isn't needed while D-04 fixes one size. |
| 7 | Plate and color | **`vehicles.plate`** (new, nullable, normalized to uppercase letters and digits) and the existing `vehicles.color`, both owner-only through 0004. The booking task reveals them to the matched rider after confirmation. Discovery never returns them. | Require a plate when the vehicle is saved, instead of before a driver's first confirmation. |
| 8 | Role "Both" ("Switch by day") | **Two commute rows**, one `driver` and one `passenger`, each with its own days. Days may overlap: overlap means "either role that day". Add `unique (owner_id, role)`, so there's at most one of each. The two rows share areas through the reuse rule in 2. | One row with a role per weekday. That needs a new shape for `role` and `weekdays`, and it can't hold a different vehicle, seats or scooter setting per role. |
| 9 | Weekdays and time | **ISO 1–5 `integer[]`**, non-empty, Monday–Friday only (same check as `commute_crews`), normalized to sorted and de-duplicated by a trigger. `departure_time` is a Postgres `time` at whole minutes. `timezone` is fixed to `America/Los_Angeles`. The app converts with `toIsoWeekdays` / `parseTime` / `formatTime` (`apps/mobile/src/lib/dates.ts`, M-08). | Allow any time zone. No tester needs it in the pilot. |
| 10 | Discovery opt-in | **Keep `profiles.discovery_opt_in`, default `false`** (D-14). One switch covers all of a person's commutes. Anyone signed in may browse, but only opted-in people are returned to others. The prototype's `discoverable: true` default must change to false. | A per-commute switch. That's more to explain, and nobody has asked for it. |
| 11 | Account deletion (0007) | **No new deletion work.** All new columns ride on `profiles`, `vehicles` and `commutes`, which already cascade from `auth.users`. `pilot_places` holds no user data. The 0007 tests must cover a user with a vehicle and both commute rows. | None. |
| 12 | Probing exact points through detour (M-33, not 0008) | **M-33 returns only "within 5 min" (in or out of results) plus whole minutes**, never distances. Treat repeated pin edits as a known pilot risk (invite-only, ≤100 testers) and revisit before a wider launch. | Add an edit cool-down on commute points in 0008, for example 10 point changes per day. |

## Privacy invariants (fixed)

- Exact origin, destination and pickup points never reach another person's device.
- Before confirmation, others see only first name + last initial, role, approximate (~0.5 mi) areas, ride preferences and verification flags.
- No gender data (D-05). No geocoding or reverse geocoding (D-08).
- Every extension object is schema-qualified: `extensions.geography`, `extensions.st_dwithin`, `extensions.st_project`, `extensions.gen_random_bytes`. Every function sets `search_path = ''`.

## 1. Exact points stay owner-only

0004 already gives `commutes` owner-only `select`, `insert`, `update` and `delete`, and revokes everything from `anon`. 0008 doesn't change those policies. New columns on `commutes` inherit them, so a person reads their own exact points and areas and nobody else's.

Rules for every later task:

- No policy on another table may expose `commutes` rows to anyone but the owner. Invitations, rides and discovery use `security definer` functions.
- A `security definer` function that reads someone else's exact point returns only an area, a place name, or a yes/no or whole-minute result. It never returns a point, a distance, or an error message that contains a coordinate.
- `commutes` is never added to the `supabase_realtime` publication.
- The owner's app needs its own exact points (to edit them) and its own destination area (D-01 arrival check). Both come from the owner's own row.

## 2. Generalized areas

### How an area is made

```
R = 402 m (0.25 mi). The area is the circle of radius R around a stored center.

On insert, or when an exact point changes:
  1. The new point is within R of this slot's current center   → keep that center.
  2. Else, it's within R of any other area center the owner has
     (origin or destination, on any of their commutes)          → reuse that center
                                                                  (oldest commute first).
  3. Else, draw a new center:
       u, v  = two uniform numbers from extensions.gen_random_bytes
       d     = R · sqrt(u)          (uniform over the disk, not bunched at the middle)
       angle = 2π · v
       center = extensions.st_project(point, d, angle)
```

- **The exact point is always inside its area**, because `d ≤ R`.
- **What a viewer learns:** the point is somewhere in a 0.5 mi-wide circle, with every spot in it equally likely. That's exactly what the UI says ("about 0.5 mi wide").
- **No averaging.** The center is stored, not recomputed, so re-querying returns the same circle forever. It never moves toward the point.
- **Tiny pin moves reveal nothing.** The area stays put while the pin stays inside it (rule 1).
- **"Both" and repeated places don't multiply samples.** A second commute row with the same home, or a later commute whose destination is home, reuses the first area (rule 2). Two independent circles around one home would let a viewer intersect them.
- **Secure randomness.** `random()` is not used. Its generator can be reconstructed from outputs, and people see their own draws. `gen_random_bytes` comes from pgcrypto, created in `extensions` if it's missing.
- **Clients can't set an area.** A `before insert or update` trigger always overwrites `origin_area` and `destination_area`. A value the client sends is ignored.

### Accepted residual risks

- **Leaving an area draws a new one.** If someone drags the pin just outside its area, the new circle and the old one overlap near the edge. A viewer who saw both could narrow the point. This takes a deliberate move of up to 0.5 mi, and the viewer must check discovery before and after.
- **Deleting every commute forgets the areas.** Saving the same home again draws a fresh circle. Keeping areas after the commutes are deleted would mean storing location data the person asked to remove, so this is accepted.

### Why not a grid

A grid needs no secret and puts everyone in a cell behind the same marker. But the exact point can sit in a corner, 0.35 mi from the center. A 50 ft drag across an edge moves the marker to the next cell, which shows the point is on that edge line. Fixing that needs stickiness rules much like the random option's, without its even spread.

### D-16: the pickup spot must be inside the passenger's area

- The request carries the passenger's pickup **area**: the `origin_area` of their passenger commute. The booking task copies that center onto the request, so a later commute edit doesn't move an open request.
- When the driver sets the exact spot, the server checks `public.within_area(area, spot)`, which is `extensions.st_dwithin(spot, area, R)`.
- The check uses the **area**, never the passenger's exact point. A driver testing spots learns only the circle they can already see, not where the passenger lives.
- The worst case is a spot on the far edge of the circle, up to 0.5 mi from the passenger's pin.

## 3. Area labels

- `public.pilot_places`: `id text primary key` (a slug such as `alameda-park-street`), `name` ("Park St area"), `city` ("Alameda"), `sort_order`. It's seeded in 0008. Authenticated users can read it, and nobody can write it from the client.
- `commutes.origin_place` and `commutes.destination_place` are not null and reference `pilot_places(id)`. Cards show "{name}, {city}".
- The person picks the label. The picker sorts places by distance from the person's stored **area center**, which they read from their own row after saving. Because the center is already public, the label adds nothing on top of the circle. Sorting by the exact pin would.
- Each list includes a city-wide fallback ("Alameda", "San Francisco"), so nobody has to pick a wrong neighborhood.
- **Proposed seed** (the owner edits this list):
  - Alameda: West End, Alameda Point, Webster St, Park St, Gold Coast, Fernside, East End, South Shore, Bay Farm Island, Alameda (anywhere).
  - San Francisco: Financial District, Embarcadero, SoMa, Union Square, Civic Center, Mission Bay, San Francisco (anywhere).
- The app reads the list from the database (it's small, so it can be cached), so the app and the database never disagree. There's no geocoding vendor and no reverse geocoding.

## 4. Ride preferences

- `profiles.ride_prefs text[] not null default '{}'`, with a check like `ride_prefs <@ array['quiet','smoke_free']` and `array_ndims` 1 or empty. They live on the profile because the UI says "Change these anytime in your profile" and they don't vary by commute.
- Recommended pilot rule: **preferred**. Shared prefs raise a match's rank, and a candidate's prefs are shown on the card. A match is never hidden.
- If the owner picks mandatory, add `profiles.required_ride_prefs text[]` (a subset of `ride_prefs`). A required pref then matches only people whose `ride_prefs` include it.
- Women-only is removed from the app's `RidePref` and from the Preferences screen (D-05).

## 5. Seats

- `commutes.seats_offered integer`, with these checks:
  - `seats_offered between 1 and 8`
  - `(role = 'driver') = (seats_offered is not null)`
- Trigger `commutes_check_seats` (before insert or update): when `vehicle_id` is set and `seats_offered > vehicles.passenger_seats`, it raises `23514`, "You offered more seats than your car has."
- Trigger `vehicles_clamp_seats` (after update of `passenger_seats`): it sets `seats_offered = least(seats_offered, new.passenger_seats)` on that vehicle's commutes.
- Both triggers are `security invoker`. The composite key from 0004 makes the vehicle and the commute the same owner's, so RLS allows both reads.
- Checks for passenger commutes: `role = 'driver' or vehicle_id is null`.
- A driver commute isn't required to have a vehicle in a check. 0004 sets `vehicle_id` to null when a vehicle is deleted, and a not-null rule would make that delete fail. Instead, discovery skips driver commutes with no vehicle, and the app prompts the person to add one.
- Matching always uses `least(seats_offered, passenger_seats)` as a second guard.
- The app's seat stepper uses the vehicle's seats as its max, not a fixed 6.

## 6. Cargo (D-04)

D-04 sets the scooter: one medium foldable scooter per passenger, folded within 120 × 50 × 60 cm and 20 kg (44 lb).

- **Passenger:** `commutes.brings_scooter boolean not null default false`, with check `role = 'passenger' or not brings_scooter`. Turning it on means "my scooter is within the D-04 limits", and the app states the limits next to the toggle (this replaces `[weight]`).
- **Driver:** the existing `vehicles.accepts_foldable_scooters` keeps its name and means "my trunk fits one D-04 scooter". 0008 adds a column comment saying so. It's a vehicle fact, not a commute fact.
- Matching filter: a passenger with a scooter matches only drivers whose vehicle fits one. The driver still approves each scooter at confirmation (booking task). Per-ride capacity, such as two passengers with scooters, is the booking task's job.

## 7. Plate and color

- `vehicles.plate text`, nullable. A trigger trims it and uppercases it, then a check requires `plate ~ '^[A-Z0-9]{2,8}$'`.
- `vehicles.color` already exists. A check limits it to 1–30 characters after trimming.
- Both are owner-only (0004). The booking task's `security definer` function reveals make, model, color and plate to the matched rider after confirmation (`BookedScreen` `[plate]`). That task also requires a plate before a driver's first confirmation.
- Discovery returns only whether the vehicle fits a scooter, and later a "vehicle verified" flag. It never returns make, model, color or plate.

## 8. Role "Both"

- `profiles.role` stays the person's stated role (`driver`, `passenger` or `both`).
- "Both" saves two `commutes` rows. The app asks for "Days you drive" and "Days you ride", both defaulting to the same days.
- `unique (owner_id, role)` allows at most one driver commute and one passenger commute per person. That matches the pilot's single morning East Bay → SF commute and caps how many areas one person can create.
- Overlapping days are allowed, and they mean either role works that day. **For the booking task:** a confirmed ride on a date uses up that person's date in both roles.

## 9. Weekdays and time

| Value | App | Database |
| --- | --- | --- |
| Days | `Weekday[]` (`'Mon'`…`'Fri'`) | `weekdays integer[]`, ISO 1 = Mon … 5 = Fri |
| Convert | `toIsoWeekdays` / `fromIsoWeekdays` | A trigger sorts and de-duplicates |
| Departure | `'7:45 AM'` | `time` `'07:45:00'`, via `parseTime` / `formatTime` |
| Flex | `5 \| 10 \| 15` | `departure_flex_minutes` (0–60, unchanged) |
| Time zone | none (always LA) | `timezone = 'America/Los_Angeles'` |

0008 changes three things here:

- It adds the `commute_crews` weekday check (non-empty, one-dimensional, `<@ {1,2,3,4,5}`) and drops the `'{}'` default.
- It adds `departure_time = date_trunc('minute', departure_time)`.
- It adds `timezone = 'America/Los_Angeles'`.

## 10. Discovery opt-in

- No schema change. `profiles.discovery_opt_in boolean not null default false` already exists (0001) and is owner-only (0002).
- The discovery function (later task) returns another person only when they're opted in. The caller doesn't need to be opted in to browse.
- App follow-up: `commute.tsx` starts with `discoverable: true`. It must start from the profile value, which is false.

## 11. For the account-deletion task (0007)

- All of these are deleted with their parent row through the existing cascades (`auth.users` → `profiles` → `vehicles`, `commutes`): `ride_prefs`, `plate`, `seats_offered`, `brings_scooter`, the areas and the place ids.
- `pilot_places` is reference data with no user link. Commutes reference it, but it never references people.
- Deleting a vehicle is an `update` on its commutes (`set null (vehicle_id)`), so the commute triggers run during a cascade:
  - The area trigger must keep the areas when the points haven't changed.
  - The seats trigger must skip a null vehicle.
  - Tests cover both.
- Area centers copied onto requests and rides (by the booking task) are generalized, not exact. 0007 treats them like the rest of the shared ride under D-15.
- `invitations.commute_id` still has no `on delete` action (inventory section 9). It's 0007's gap, and it's unchanged here.

## What 0008 adds

**`public.commutes`**

| Column / object | Definition |
| --- | --- |
| `origin_area`, `destination_area` | `extensions.geography(point,4326) not null`. Server-set by the trigger. |
| `origin_place`, `destination_place` | `text not null references public.pilot_places(id)` |
| `seats_offered` | `integer`. Checks in section 5. |
| `brings_scooter` | `boolean not null default false`. Check in section 6. |
| Checks | weekdays (ISO 1–5, non-empty), whole-minute `departure_time`, LA `timezone`, and the role / vehicle / seats / scooter rules |
| Default dropped | `weekdays default '{}'` |
| Index | `unique (owner_id, role)` |

**`public.vehicles`**: `plate text` with the format check, a `color` length check, and a comment on `accepts_foldable_scooters` (D-04).

**`public.profiles`**: `ride_prefs text[] not null default '{}'` with a check.

**`public.pilot_places`** (new): `id text pk`, `name text not null`, `city text not null`, `sort_order int not null`, plus the seed rows. RLS is on. `select` is allowed for `authenticated`. Insert, update, delete and truncate are revoked from `public`, `anon` and `authenticated`.

**Functions** (all `set search_path = ''`)

| Function | Kind | Purpose |
| --- | --- | --- |
| `public.area_radius_m()` | `immutable sql`, returns 402 | One place for R |
| `public.within_area(area extensions.geography, spot extensions.geography)` | `immutable sql`, returns boolean | The D-16 check. It reads no table, so it's safe for clients. |
| `public.commutes_set_areas()` | Trigger, `security invoker`, before insert or update | Rules 1–3 in section 2, with the random draw inline; ignores client-sent areas |
| `public.commutes_normalize()` | Trigger, before insert or update | Sorts and de-duplicates `weekdays` |
| `public.commutes_check_seats()` | Trigger, before insert or update | Seats ≤ vehicle |
| `public.vehicles_normalize()` | Trigger, before insert or update | Trims and uppercases `plate` |
| `public.vehicles_clamp_seats()` | Trigger, after update of `passenger_seats` | Lowers commute offers |

Trigger function execute rights are revoked from `public`, `anon` and `authenticated`, as in 0003. That's safe because Postgres doesn't check execute rights when a trigger fires. A helper that a trigger calls is checked against the signed-in person, though. So the random draw lives inside `commutes_set_areas` rather than in a revoked helper, and `authenticated` must be able to execute `extensions.gen_random_bytes` (test 1 runs as a signed-in user).

**Before pushing to hosted:** confirm `select count(*) from public.commutes` is 0. Commute saving was out of scope until now. If any rows exist, 0008 needs a backfill for the new not-null columns.

**Also update after 0008:**

- `docs/privacy/data-inventory.md`: areas are now stored once (not recomputed), add places, plate, `seats_offered`, `brings_scooter` and `ride_prefs`, and close Q7 (no gender).
- The generated database types.

## Tests: `supabase/tests/commute_privacy_test.sql`

They run with `scripts/db-test.sh`, using the same harness and `tests.as_user` as `vehicles_commutes_test.sql`.

**Areas**

1. Inserting a commute sets both areas, each within 402 m of its exact point.
2. Areas sent by the client on insert and on update are ignored.
3. Selecting twice returns identical areas. Editing only `departure_time` keeps them.
4. Moving a pin 100 m, still inside the area, keeps the area. Moving it 1 km draws a new area that contains the new point.
5. A second commute (the passenger row for "Both") with the same origin reuses the first row's origin area. A destination that equals an existing origin reuses that area.
6. Spread: 100 draws all fall within R, with a mean distance between 0.55 R and 0.78 R (expected about 0.67 R).
7. Another user selects 0 rows from `commutes`, so neither exact points nor areas are visible to them. `anon` is denied.

**D-16 helper**

8. `within_area` is true inside R and false outside. A spot within R of the exact point but more than R from the center is false.

**Schedule**

9. Weekdays reject `{}`, `{0}`, `{6}`, `{7}`, a 2-D array and nulls. `{3,1,1}` is stored as `{1,3}`.
10. A `departure_time` with seconds is rejected, and so is a time zone other than LA.

**Seats and role**

11. A driver commute needs `seats_offered` from 1 to 8. A passenger commute rejects `seats_offered` and `vehicle_id`.
12. Seats over the vehicle's `passenger_seats` are rejected. Lowering a vehicle's seats lowers its commutes' offers.
13. A second driver commute for the same owner is rejected (`unique (owner_id, role)`).

**Cargo, places and preferences**

14. `brings_scooter` is rejected on a driver commute.
15. An unknown place id is rejected. `pilot_places` is readable by `authenticated` and not writable. `anon` can't read it.
16. `ride_prefs` accepts `quiet` and `smoke_free`, and rejects `women_only` and unknown values. No column in `public` is named like `gender` or `sex`.

**Vehicles**

17. The plate is normalized to uppercase and an invalid one is rejected. Another user can't read `vehicles.plate`.

**Deletion and defaults**

18. Deleting a vehicle used by a driver commute succeeds: `vehicle_id` becomes null, and the areas and seats are unchanged.
19. Deleting an `auth.users` row that has a vehicle and both commute rows cascades with no error.
20. A profile inserted without `discovery_opt_in` gets `false`.
21. The trigger functions aren't directly executable by `authenticated` or `anon`.

## Out of scope

- The discovery and matching function and the detour estimate (M-33, 0012).
- Requests, booking, the plate reveal and enforcing the pickup spot (they use `within_area`).
- App screens. The follow-ups noted above are: no Women-only, discovery off by default, place picker, seat stepper max and scooter limits copy.
