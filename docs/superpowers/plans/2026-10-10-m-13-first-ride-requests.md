# First Ride one-date requests Implementation Plan (M-13)

**Goal:** apply the First Ride spec's "Changed screens" to the prototype (mock data only): every request and booking is for one date, labeled "First Ride", with no recurring toggle or "Skip one day".

**Spec:** `docs/superpowers/specs/2026-10-08-first-ride-design.md` §Principle (lines 7–11) and §Changed screens (lines 108–113). Decisions: D-01 (Decided 2026-10-08, ride-mode location copy).

**Base:** `origin/main` at `670d6ae` (Waves 1–2 merged; Forest theme and the new animated Welcome from #17; M-10 safe areas).

## Constraints

- Mock data only. No Supabase calls, no route param changes (M-28 adds `kind` and M-35 adds `rideDate` to the `request` route).
- Out of scope: "Simulate ride completed" (M-20), Post-ride / Ride Again / Crew screens, seats-open math, "Suggest a change" and "Move" (D-16, owned by M-35/M-36), `[cutoff]` and other bracketed values.
- Welcome: no change. #17 replaced the screen; it has no "same ride, every week" copy and no privacy line any more, so the spec's Welcome items and D-01's Welcome line have no place to land (owner question).
- Pure logic lives in `src/lib/rideKind.ts` (no react-native or expo imports) with `rideKind.test.ts`, so later tasks (M-20, M-28, M-35) share one label rule.

## Task 1: Ride kind labels (TDD)

- [x] Failing tests: `rideKindBadge('first_ride')` is "First Ride", `ride_again` and `crew` have no badge; `rideDateLine('2026-10-12', 'first_ride')` is "Mon, Oct 12 · First Ride", other kinds give the date alone; a bad date throws.
- [x] Implement `RideKind`, `rideKindBadge`, `rideDateLine` on top of `formatRideDate`.

## Task 2: Mock data

- [x] `RideRequest.days` becomes `rideDate` ('YYYY-MM-DD') plus `kind` (`RideKind`). Jordan: 2026-10-12, Alex: 2026-10-13, both `first_ride`.
- [x] `PROTOTYPE_RIDE_DATE = '2026-10-12'` for the passenger request and booking.

## Task 3: Screens

- [x] Request: title "Request a First Ride with {first}", remove "Repeat Mon–Thu", one date with a "First Ride" badge, final line "This is one ride. No recurring commitment."
- [x] Booked: "First Ride booked with {first}" over "Mon, Oct 12"; remove "Skip one day" and the skip wording; "Cancel ride" hint says it cancels only this ride; D-01 line "Your location stays on your phone. {first} never sees it." replaces "No live tracking during the pilot."
- [x] Driver requests / request / confirm: "Mon, Oct 12 · First Ride" instead of "Mon–Thu"; Upcoming lists an accepted rider only under their own date.

## Task 4: Verify

- [x] `npm run typecheck`, `npm test`, `npm run lint` (0 errors).
- [x] Web walkthrough in prototype mode: Discover → Match → Request → Booked, and Trips → request → confirm → Upcoming.
- [x] Push; CI green.
