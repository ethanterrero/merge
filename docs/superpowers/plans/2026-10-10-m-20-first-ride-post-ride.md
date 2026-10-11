# First Ride post-ride feedback Implementation Plan (M-20)

**Goal:** build the First Ride spec's New screens 1–2 (Post-ride and After submitting) in the prototype, with per-match relationship state in a new `state/firstRide.tsx`, and a prototype "simulate ride completed" entry on Booked.

**Spec:** `docs/superpowers/specs/2026-10-08-first-ride-design.md` §Safeguards (lines 23–29), §Changed screens / Booked (line 112), §New screens 1–2 (lines 117–122), §State (lines 127–131). Decisions: D-21 (Decided 2026-10-08: state lives in `state/firstRide.tsx`, not `state/commute.tsx`). D-01 (Decided) is context only: the prototype completes a ride by a labeled simulator, not by ride mode.

**Base:** `origin/main` at `43532a1` (M-07 `resolveConnection`, M-10 safe areas, M-13 one-date UI and `src/lib/rideKind.ts`, M-19 data layer).

## Constraints

- Mock data only. No Supabase calls and no `src/lib/data/` feature file (M-44 wires feedback).
- Privacy: the UI never reveals the other person's answer and never tells "no" apart from "not answered". The only thing the outcome can change is whether a "you're both open to riding again" card shows, and `resolveConnection` gives the same result for `no` and `null`.
- "Decide later" records nothing (no `dismissed_at` in the prototype state).
- Safety is separate from feedback: "Report a safety concern" opens a placeholder notice, not a feedback field.
- Out of scope: Ride Again and Crew screens (M-28), editing a submitted answer, the real report flow (M-24/M-44), Supabase wiring (M-44), the Trips/Booked entry points on real rides (M-47).
- Tested logic lives in `src/lib/firstRide.ts`, which imports nothing from react-native, expo, `src/lib/supabase.ts` or `src/state` (types only). `resolveConnection` is injected by the provider, the way `authRules.ts` keeps platform code out.

## Task 1: Pure First Ride rules (TDD) — `src/lib/firstRide.ts`

- [x] Failing tests first (`src/lib/firstRide.test.ts`):
  - `canSubmitFeedback`: false with neither answer; true with only experience, only ride-again, or both.
  - `relationshipFor` returns a fresh confirmed relationship (no feedback, no simulated answer) for an unknown match.
  - `rideCompleted` moves confirmed → completed, leaves completed and cancelled alone.
  - `feedbackSubmitted` records the answers only for a completed ride, only when one is answered, and only once (no editing in the prototype); otherwise it returns the same state.
  - `partnerAnswerSimulated` sets the simulated answer, and touches only that match.
  - `postRideRoute`: Post-ride until feedback is recorded, then Thanks.
  - `connectionFor` (with the real `resolveConnection`): Yes+Yes is crew-eligible, Yes+Individual is Ride Again, nothing connects before the ride is completed, and for every one of my answers the outcome with the partner's `no` equals the outcome with no partner answer.
- [x] Implement `Experience`, `RideStatus`, `Feedback`, `MatchRelationship`, `FirstRideState`, `FirstRideAction`, `firstRideReducer`, `relationshipFor`, `canSubmitFeedback`, `postRideRoute`, `connectionFor`, `isConnected`.

## Task 2: Provider — `src/state/firstRide.tsx`, `App.tsx`

- [x] `FirstRideProvider` (useReducer over `firstRideReducer`) and `useFirstRide()` exposing `relationship(matchId)`, `connection(matchId)` (via `resolveConnection` from `state/connection.ts`), `completeRide`, `submitFeedback`, `simulatePartnerAnswer`.
- [x] Mount it in `App()` inside `CommuteProvider`. Leave a typed slot comment for M-28's Crew state.

## Task 3: Routes and screens

- [x] Append `postRide` and `postRideThanks` (both `{ matchId }`) to the Route union, the `renderRoute` switch and the import block.
- [x] Post-ride: spec copy; experience and ride-again as radio rows; Submit enabled once either is answered; "Decide later" goes back and records nothing; "Report a safety concern" toggles a placeholder notice.
- [x] Thanks: spec copy; a Ride Again card only when connected; a "Prototype: simulate {first}'s answer" control (Yes / Individual / No); Done returns to Discover.
- [x] Booked: footer wrapped in a View with "Prototype: simulate ride completed" above "Cancel ride".

## Task 4: Spec bullet (D-21)

- [x] Update the State bullet (line 129) to name `state/firstRide.tsx` and cite D-21.

## Task 5: Verify

- [x] `npm run typecheck`, `npm test`, `npm run lint` (0 errors).
- [x] Web walkthrough in prototype mode: Booked → simulate ride completed → answer one question → Submit → Thanks → simulate Yes, Individual, No; Decide later; the safety link. Screenshots.
- [x] Push; CI green.

## Task 6: Review follow-ups

- [x] Feedback per ride, not per match (TDD): Request dispatches `rideBooked`, which starts a fresh ride unless the match's latest ride is still open. Feedback is keyed by ride id. The pair's connection comes from my latest non-null ride-again answer across the pair's completed rides (ordered like `ride_again_at`), still through `resolveConnection`. Tests cover booking the same match twice. `RequestRideScreen.tsx` gains the one `bookRide` call (outside the card's file list; M-28 is next in that file's chain and starts after this merges).
- [x] Thanks shows "If {first} also wants to ride again, you'll see it here." only when my own latest answer is Yes or Individual; otherwise just "Thanks.".
- [x] The provider clears its state when the owner changes: 'prototype', the signed-in profile id, or null when signed out (`ownerChanged`).
- [x] typecheck, test, lint; web walkthrough of booking Priya twice; push; CI green.
