# Saved commutes and vehicles: privacy design

**Date:** 2026-10-08
**Task:** M-18
**Status:** Approved by the owner on 2026-10-08, with #3 changed to boundary labels. Built in `supabase/migrations/0008_commute_privacy.sql`.
**Builds on:** `0001_initial.sql`, `0002_profiles_rls.sql`, `0004_vehicles_commutes_rls.sql` (owner-only RLS, composite `(vehicle_id, owner_id)` key). It doesn't depend on 0003 or later.

## Decisions for the owner

Owner review, 2026-10-08: #1, #2, #4 and #5–#12 approved as recommended. #3 changed: labels come from open boundary data (section 3).

| # | Question | Recommendation | Alternative |
| --- | --- | --- | --- |
| 1 | Who can read exact origin/destination points? | **Owner only**, through the 0004 RLS policies, unchanged. Other people's points are read only inside `security definer` functions, which never return a point or anything finer than an area. | None. This is a fixed invariant. |
| 2 | How is the ~0.5 mi area made? | **A stored random-offset circle.** On save, the server picks a center at a uniformly random spot within 0.25 mi (402 m) of the exact point, using a secure random source, and stores it. The area is the 402 m circle (0.5 mi wide) around that center, so it always contains the exact point. The center never changes on re-query. Moving the pin keeps the same area while the pin stays inside it. A pin that matches any of the owner's existing areas reuses that area. | **Snap to a fixed grid** of about 0.0073° lat × 0.0091° lon (0.5 mi square at 37.8°N). There's no secret and no randomness, but the pin can sit in a corner, 0.35 mi from the shown center. A small pin move across a cell edge also shows the point is right at that edge. |
| 3 | Area label ("Park St area, Alameda") | **Changed by the owner:** the server labels each area from open boundary polygons loaded into PostGIS (`place_boundaries`), using the area **center**, never the pin. No geocoding API. | (Proposed, not chosen: a fixed pick list, or free text.) |
| 4 | Ride preferences (quiet, smoke-free) | **Preferred, not mandatory**, for the pilot. They're shown on cards and used for ranking, but never hide a match. Stored as `profiles.ride_prefs text[]`, limited to `quiet` and `smoke_free`. No women-only and no gender (D-05). | **Mandatory** (as `docs/mvp.md` puts it): add `required_ride_prefs text[]`. A required pref matches only people who also chose it. That shrinks a pool of ≤100 testers. |
| 5 | Seats offered | **`commutes.seats_offered`**, required on driver commutes and null on passenger commutes. A trigger rejects more seats than the linked vehicle has. Lowering a vehicle's seats lowers its commutes' offers to match. | Reject the vehicle edit until the commutes are lowered, or check only at match time. |
| 6 | Cargo (D-04) | **Two booleans.** Passenger: `commutes.brings_scooter`. Driver: the existing `vehicles.accepts_foldable_scooters`, meaning "my trunk fits one". D-04 fixes the size and weight, so they aren't stored. The driver approves each scooter at confirmation (booking task). | Store the scooter's type, size and weight per passenger. That isn't needed while D-04 fixes one size. |
| 7 | Plate and color | **`vehicles.plate`** (new, nullable, normalized to uppercase letters and digits) and the existing `vehicles.color`, both owner-only through 0004. The booking task reveals them to the matched rider after confirmation. Discovery never returns them. | Require a plate when the vehicle is saved, instead of before a driver's first confirmation. |
| 8 | Role "Both" ("Switch by day") | **Two commute rows**, one `driver` and one `passenger`, each with its own days. Days may overlap: overlap means "either role that day". Add `unique (owner_id, role)`, so there's at most one of each. The two rows share areas through the reuse rule in 2. | One row with a role per weekday. That needs a new shape for `role` and `weekdays`, and it can't hold a different vehicle, seats or scooter setting per role. |
| 9 | Weekdays and time | **ISO 1–5 `integer[]`**, non-empty, Monday–Friday only (same check as `commute_crews`), normalized to sorted and de-duplicated by a trigger. `departure_time` is a Postgres `time` at whole minutes. `timezone` is fixed to `America/Los_Angeles`. The app converts with `toIsoWeekdays` / `parseTime` / `formatTime` (`apps/mobile/src/lib/dates.ts`, M-08). | Allow any time zone. No tester needs it in the pilot. |
| 10 | Discovery opt-in | **Keep `profiles.discovery_opt_in`, default `false`** (D-14). One switch covers all of a person's commutes. Anyone signed in may browse, but only opted-in people are returned to others. The prototype's `discoverable: true` default must change to false. | A per-commute switch. That's more to explain, and nobody has asked for it. |
| 11 | Account deletion (0007) | **No new deletion work.** All new columns ride on `profiles`, `vehicles` and `commutes`, which already cascade from `auth.users`. `place_boundaries` holds no user data. The 0007 tests must cover a user with a vehicle and both commute rows. | None. |
| 12 | Probing exact points through detour (M-33, not 0008) | **M-33 returns only "within 5 min" (in or out of results) plus whole minutes**, never distances. Treat repeated pin edits as a known pilot risk (invite-only, ≤100 testers) and revisit before a wider launch. | Add an edit cool-down on commute points in 0008, for example 10 point changes per day. |

## Privacy invariants (fixed)

- Exact origin, destination and pickup points never reach another person's device.
- Before confirmation, others see only first name + last initial, role, approximate (~0.5 mi) areas, ride preferences and verification flags.
- No gender data (D-05). No geocoding or reverse geocoding (D-08).
- Every extension object is schema-qualified: `extensions.geography`, `extensions.geometry`, `extensions.st_*`, `extensions.gen_random_bytes`. Every function sets `search_path = ''`.

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
- **Clients can't set an area or a label.** A `before insert or update` trigger always overwrites `origin_area`, `destination_area` and their labels. A value the client sends is ignored.
- **Labels follow the center.** When a center is kept, its label is kept as stored (not recomputed). When a new center is chosen (reused or drawn), the label is computed from that center (section 3).

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

## 3. Area labels (boundary data)

### How a label is chosen

The trigger labels each stored area from its **center**, never the exact pin, with `public.area_label(center)`:

1. A **neighborhood** polygon covers the center → "{neighborhood} area, {city}", for example "Mission area, San Francisco".
2. Else a **city** polygon covers the center → "{city}", for example "Alameda".
3. Else (outside every polygon) → a fixed regional label: "San Francisco" if the nearest city polygon is San Francisco, otherwise "East Bay".

If two polygons of the same kind cover the center (possible in slivers left by simplifying), the smallest wins, then the lowest id, so the result is deterministic.

- The labels are stored as `commutes.origin_area_label` and `commutes.destination_area_label`. They're recomputed only when that area's center changes.
- The center is already what others see, so a label derived from it adds nothing. A label from the exact pin could, near a boundary. Test 23 checks this with a pin 55 m inside the Mission.
- There's no geocoding or reverse-geocoding vendor. The lookup is a point-in-polygon query on our own table.

### `public.place_boundaries`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `text primary key` | `datasf-j2bu-swwd:<slug>` or `tiger2025-place:<GEOID>` |
| `kind` | `text` | `neighborhood` or `city` |
| `name`, `city` | `text not null` | For a city row, both are the city name |
| `geom` | `extensions.geometry(MultiPolygon, 4326) not null` | GiST index |
| `source`, `license` | `text not null` | Dataset name and URL; licence |

- **Geometry, not geography.** The only operation is point-in-polygon (`st_covers`), which doesn't depend on distance, and planar coordinates make it exact and fast with a GiST index. The nearest-city fallback uses the `<->` index operator in degrees, which is fine for choosing between San Francisco and the East Bay.
- **Clients can't read or write it.** Its rows are open data, but the app doesn't need them: labels are stored on the commute. RLS is enabled with no policies, and all privileges are revoked from `public`, `anon` and `authenticated`. Only the migration (or the service role) writes it.
- `area_label` is `security definer`, so it can read the table on the signed-in person's behalf. It's executable by `authenticated` (the commute trigger runs as the signed-in person), not by `anon`. It returns only labels derived from public data.

### Sources and licences

| Data | Source | Licence | Rows |
| --- | --- | --- | --- |
| San Francisco neighborhoods | DataSF **Analysis Neighborhoods** (`j2bu-swwd`), https://data.sfgov.org/d/j2bu-swwd, downloaded from https://data.sf.gov/resource/j2bu-swwd.geojson | Open Data Commons PDDL 1.0 (public domain dedication) | 41 |
| City limits: San Francisco, Alameda, Oakland, Berkeley, Emeryville, Piedmont, San Leandro, Richmond, Albany | US Census Bureau **TIGER/Line 2025, Places, California**, https://www2.census.gov/geo/tiger/TIGER2025/PLACE/tl_2025_06_place.zip | Public domain (US Government work, 17 U.S.C. 105) | 9 |

- **Why Analysis Neighborhoods, not SF Find Neighborhoods (`pty2-tcw4`).** Both are public domain. Analysis Neighborhoods is the City's official 41-area set: it covers the whole city with no overlaps. Find Neighborhoods has about 117 smaller, more familiar names, but it's built for search, not as a clean partition. Coarser labels are also the more private choice. Its names are what DataSF publishes, for example "Financial District/South Beach".
- **East Bay neighborhoods: none. Labels there are city-level** ("Alameda", "Oakland").
  - No open, licence-clear neighborhood polygons were found for Alameda or Berkeley.
  - Oakland's are a 2002 city layer, or a Zillow set under CC BY-SA, neither current nor clean to reuse.
  - OpenStreetMap neighbourhoods here are mostly points. (The Overpass API was down during the build, so this wasn't re-checked.) Voronoi cells around points would draw boundaries nobody published, mislabel people near them, and bring in ODbL share-alike.
  - So the simpler correct option is city-level labels. The table can take East Bay neighborhoods later without a schema change.
- **No OpenStreetMap data is used**, so there are no ODbL terms. Every row is public domain.
- TIGER coordinates are NAD83. They're used as WGS 84: in the Bay Area the two differ by under 2 m, far below the simplification tolerance.
- TIGER city limits include the water inside them (much of the Bay is inside San Francisco, Alameda or Oakland). So an area center over water still gets a city label.

### Build: `scripts/boundaries/build.py`

```
python3 -I scripts/boundaries/build.py supabase/migrations/0008_commute_privacy.sql
```

- Uses the standard library only (`json`, `zipfile`, `struct`), so there's nothing to install.
- Downloads both sources into a fresh empty temp directory outside the repo (`--from-dir` reuses an earlier download). It refuses files over 64 MB.
- Treats the downloads as untrusted data. They're parsed, never executed, never unpacked to disk. Every coordinate must fall inside the Bay Area, and the expected cities and GEOIDs must match.
- Simplifies each ring with Douglas–Peucker at 20 m, drops rings under 2,000 m², and rounds coordinates to 5 decimals (about 1 m).
- Rewrites only the block between `-- BEGIN GENERATED place_boundaries` and `-- END GENERATED` in 0008. That block records the SHA-256 of each download.
- Each geometry is loaded through `extensions.st_makevalid`, keeping polygons only. So any self-intersection from simplifying is repaired in the database.
- **Topology:** simplification is per ring, not shared-edge (the test image's GEOS 3.9 has no coverage simplification). Neighbors can have slivers of up to about 20 m between them or overlapping. A center in a gap falls back to the city label. A center in an overlap takes the smaller polygon. Neither reveals anything, because the label comes from the public center.
- **Size:** 50 rows, 2,882 vertices, about 76 KB of SQL, so it fits in 0008.

## 4. Ride preferences

- `profiles.ride_prefs text[] not null default '{}'`, with a check like `ride_prefs <@ array['quiet','smoke_free']` and `array_ndims` 1 or empty. They live on the profile because the UI says "Change these anytime in your profile" and they don't vary by commute.
- Approved pilot rule: **preferred**. Shared prefs raise a match's rank, and a candidate's prefs are shown on the card. They never filter or hide a match.
- `docs/mvp.md` still lists "mandatory ride preferences" among the hard filters. The docs task (M-09) changes that line. This task doesn't edit `mvp.md`.
- Mandatory was not chosen. If it's ever wanted, add `profiles.required_ride_prefs text[]` (a subset of `ride_prefs`); a required pref would then match only people whose `ride_prefs` include it.
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
- It adds `extract(second from departure_time) = 0` (whole minutes).
- It adds `timezone = 'America/Los_Angeles'`.

## 10. Discovery opt-in

- No schema change. `profiles.discovery_opt_in boolean not null default false` already exists (0001) and is owner-only (0002).
- The discovery function (later task) returns another person only when they're opted in. The caller doesn't need to be opted in to browse.
- App follow-up: `commute.tsx` starts with `discoverable: true`. It must start from the profile value, which is false.

## 11. For the account-deletion task (0007)

- All of these are deleted with their parent row through the existing cascades (`auth.users` → `profiles` → `vehicles`, `commutes`): `ride_prefs`, `plate`, `seats_offered`, `brings_scooter`, the areas and their labels.
- `place_boundaries` is reference data with no user link, and nothing references it.
- Deleting a vehicle is an `update` on its commutes (`set null (vehicle_id)`), so the commute triggers run during a cascade:
  - The area trigger must keep the areas when the points haven't changed.
  - The seats trigger must skip a null vehicle.
  - Tests cover both.
- Area centers copied onto requests and rides (by the booking task) are generalized, not exact. 0007 treats them like the rest of the shared ride under D-15.
- `invitations.commute_id` still has no `on delete` action (inventory section 9). It's 0007's gap, and it's unchanged here.

## What 0008 adds

0008 opens with a guard that stops if `public.commutes` has any rows. Commute saving was out of scope until now. If a row exists, the new not-null columns need a backfill first.

**`public.commutes`**

| Column / object | Definition |
| --- | --- |
| `origin_area`, `destination_area` | `extensions.geography(point,4326) not null`. Server-set by the trigger. |
| `origin_area_label`, `destination_area_label` | `text not null`. Server-set from the area center. |
| `seats_offered` | `integer`. Checks in section 5. |
| `brings_scooter` | `boolean not null default false`. Check in section 6. |
| Checks | weekdays (ISO 1–5, non-empty, one-dimensional), whole-minute `departure_time`, LA `timezone`, and the role / vehicle / seats / scooter rules |
| Default dropped | `weekdays default '{}'` |
| Index | `unique (owner_id, role)` |

**`public.vehicles`**: `plate text` with the format check, a `color` length check, and a comment on `accepts_foldable_scooters` (D-04).

**`public.profiles`**: `ride_prefs text[] not null default '{}'` with a check.

**`public.place_boundaries`** (new, section 3), plus its 50 generated rows. RLS is on with no policies. All privileges are revoked from `public`, `anon` and `authenticated`.

**Extension:** `create extension if not exists pgcrypto with schema extensions` (it's already there on hosted Supabase).

**Functions** (all `set search_path = ''`)

| Function | Kind | Who can execute | Purpose |
| --- | --- | --- | --- |
| `public.area_radius_m()` | `immutable sql`, returns 402 | `authenticated` | One place for R |
| `public.within_area(area, spot)` | `immutable sql`, returns boolean | `authenticated` | The D-16 check. It reads no table. |
| `public.random_area_center(p)` | `volatile`, invoker | `authenticated` | Rule 3: a uniform draw in the disk using `extensions.gen_random_bytes` |
| `public.commute_area_for(owner, self_id, p, sibling)` | `stable`, invoker | `authenticated` | Rules 2–3: reuse an area of the owner's (RLS shows only their own) or draw one |
| `public.area_label(center)` | `stable`, `security definer` | `authenticated` | Section 3 |
| `public.commutes_set_areas()` | Trigger, invoker, before insert or update | nobody (fires as trigger) | Rules 1–3 and labels; ignores client-sent areas and labels |
| `public.commutes_normalize()` | Trigger, before insert or update | nobody | Sorts and de-duplicates `weekdays` |
| `public.commutes_check_seats()` | Trigger, invoker, before insert or update | nobody | Seats ≤ vehicle |
| `public.vehicles_normalize()` | Trigger, before insert or update | nobody | `plate` uppercased without spaces or dashes; `color` trimmed, blank to null |
| `public.vehicles_clamp_seats()` | Trigger, invoker, after update of `passenger_seats` | nobody | Lowers commute offers |

- Postgres doesn't check execute rights when a trigger fires, so execute on the trigger functions is revoked from every client role, as in 0003.
- A helper that a trigger calls *is* checked against the signed-in person. So the area helpers stay executable by `authenticated`, and `authenticated` must be able to run `extensions.gen_random_bytes`. Tests 1 and 23 run as signed-in users.
- The helpers reveal nothing:
  - `random_area_center` returns a random point near the point you give it.
  - `commute_area_for` reads commutes under RLS, so it sees only your own.
  - `area_label` labels public data.

**Also update after 0008:**

- `docs/privacy/data-inventory.md`:
  - Areas are now stored once, not recomputed.
  - Add the area labels, the plate, `seats_offered`, `brings_scooter`, `ride_prefs` and `place_boundaries` (with its sources).
  - Close Q7 (no gender).
- `docs/mvp.md`: preferences rank only (M-09).
- The generated database types.
- About/Legal screen (M-40), attribution line: "Neighborhood boundaries: DataSF Analysis Neighborhoods (PDDL 1.0). City limits: US Census Bureau TIGER/Line 2025 (public domain)." Neither licence requires it, but it's good practice.

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

**Cargo, boundaries and preferences**

14. `brings_scooter` is rejected on a driver commute.
15. Clients (`authenticated`, `anon`) can't read, insert, update or delete `place_boundaries`. It holds 9 cities and the SF neighborhoods, each with a source, a licence and valid geometry.
16. `ride_prefs` accepts `quiet` and `smoke_free`, and rejects `women_only` and unknown values. No column in `public` is named like `gender` or `sex`.

**Vehicles**

17. The plate is normalized to uppercase and an invalid one is rejected. Another user can't read `vehicles.plate`.

**Deletion and defaults**

18. Deleting a vehicle used by a driver commute succeeds: `vehicle_id` becomes null, and the areas and seats are unchanged.
19. Deleting an `auth.users` row that has a vehicle and both commute rows cascades with no error.
20. A profile inserted without `discovery_opt_in` gets `false`.
21. The trigger functions aren't directly executable by `authenticated` or `anon`. `anon` can't execute the area helpers.

**Labels**

22. Known centers get the expected labels:
    - in the Mission → "Mission area, San Francisco";
    - in the Financial District → "Financial District/South Beach area, San Francisco";
    - in Alameda → "Alameda";
    - in Walnut Creek (outside every polygon, nearest the East Bay) → "East Bay";
    - in Daly City (outside every polygon, nearest San Francisco) → "San Francisco".
23. The label comes from the center, not the pin. A pin 55 m inside the Mission is redrawn until its center lands in another polygon. The stored label then differs from the pin's, and every draw matches `area_label(center)`.
24. A label isn't recomputed while its center stays put: renaming the boundary and editing another field keeps the old label (part of test 3).

`vehicles_commutes_test.sql` (0004) now gives its commutes weekdays and, for drivers, `seats_offered`, which 0008 requires.

## Out of scope

- The discovery and matching function and the detour estimate (M-33, 0012).
- Requests, booking, the plate reveal and enforcing the pickup spot (they use `within_area`).
- East Bay neighborhood polygons (no open source found; section 3).
- App screens. The follow-ups noted above are: no Women-only, discovery off by default, show the stored area labels, seat stepper max and scooter limits copy.
