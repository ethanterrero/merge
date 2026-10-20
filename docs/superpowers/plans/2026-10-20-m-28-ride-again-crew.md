# First Ride: Ride Again and Commute Crew Implementation Plan (M-28)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** build the First Ride spec's New screens 3–5 (Ride Again, Crew setup, Crew view) in the prototype, with the Crew per pair held by `FirstRideProvider`, a Ride Again entry on Match detail, and a `kind` param on the `request` route.

**Architecture:** the Crew rules are a pure reducer in a new `src/lib/crew.ts` that wraps M-20's `firstRideReducer` (`relationshipReducer`). After every action it re-derives each pair's connection and applies `crewStatusAfter`, so the Crew follows the connection the way `resolve_connection` does. `src/state/firstRide.tsx` holds that state (D-21) and injects `resolveConnection` and `crewStatusAfter` from `state/connection.ts`, the way `lib/firstRide.ts` already takes `resolveConnection`. Screens read it through `useFirstRide()`.

**Tech Stack:** Expo SDK 54, React Native 0.81, TypeScript strict, `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-08-first-ride-design.md` §Commitment levels (lines 13–21), §`commute_crews` RPC rules (lines 84–98), §New screens 3–5 (lines 122–124), §Testing manual walkthrough (line 150). Card: `docs/mvp-backlog.md` §M-28.

**Base:** `origin/main` at `2a0f734` (M-13 one-date UI and `lib/rideKind.ts`, M-20 `lib/firstRide.ts` and `state/firstRide.tsx`, M-24 block/report).

## Global Constraints

- Mock data only. No Supabase calls, no `src/lib/data/` file (M-48 wires Crews).
- Exact copy: "You and {first} are open to riding again." / "Invite for another ride" / "Start a Commute Crew" / "Proposed" / "Not started". Simulators are labeled "Prototype".
- A Crew never creates rides on its own. Each Crew ride is one dated invitation, prefilled from the Crew's days, confirmed or skipped on its own. Skipping declines that day only.
- Pause, resume and end are open to either member at any time, without penalty: no confirmation dialog and no warning copy.
- Crew transitions mirror the RPCs: propose needs `ride_again_crew_eligible` and no open Crew (`proposed`/`active`/`paused`); the prototype partner answer works only on `proposed` (accept → `active`, decline → `not_started`); `active → paused`, `paused → active`, `active|paused → ended`.
- Crew days are a non-empty subset of the match's `sharedDays`. Departure time uses `TimeField`'s picker format (`'7:45 AM'`).
- Privacy: Ride Again shows only when `resolveConnection` says connected, which gives the same result for the partner's "no" and "not answered". Crew decline reads as the neutral "Not started", and Ride Again stays.
- All styling from `src/theme.ts`; no hex values in screens.
- Files: the card's list, plus the new pure `src/lib/crew.ts` and `src/lib/crew.test.ts` (tested logic must live in a pure module; `state/firstRide.tsx` imports `state/auth.tsx` and can't run under Node). `lib/firstRide.ts` is not changed.
- Known gap, outside this card's files: `BookedScreen` always says "First Ride booked with {first}", so a Ride Again booking shows that header until the Booked owner (M-43/M-47) reads the ride's kind. Called out in the PR.

## Review Focus

- Changing the simulated partner answer after a Crew exists (Yes → Individual, Yes → No): a proposed Crew becomes `not_started` or `ended`; an active one survives Individual and ends on No. Pinned in Task 1.
- Re-proposing after a decline or an end: allowed, because `not_started` and `ended` are terminal. Pinned in Task 1.
- Skipping a day moves to the next Crew day, and skipping repeatedly never loops forever or skips a confirmed day. Pinned in Task 1.
- Pausing hides the proposed ride, and resuming shows the same next unanswered day again. Pinned in Task 1.
- A signed-in person change clears Crews along with rides. Pinned in Task 1.

---

### Task 1: Pure Crew rules (TDD) — `src/lib/crew.ts`

**Files:**
- Create: `apps/mobile/src/lib/crew.ts`
- Test: `apps/mobile/src/lib/crew.test.ts`

**Interfaces:**
- Consumes: `firstRideReducer`, `emptyFirstRideState`, `connectionFor`, `FirstRideState`, `FirstRideAction`, `ResolveConnection` from `./firstRide`; `nextRideDates`, `toIsoWeekdays`, `weekdayToIso` from `./dates`; types `ConnectionOutcome`, `CrewStatus` from `../state/connection`; type `Weekday` from `../data/mock`.
- Produces:
  - `type CrewRideAnswer = 'confirmed' | 'skipped'`
  - `type Crew = { status: CrewStatus; days: Weekday[]; departureTime: string; rides: Record<string, CrewRideAnswer> }` (`rides` keyed by `'YYYY-MM-DD'`)
  - `type CrewAction = { type: 'crewProposed'; matchId: string; days: Weekday[]; sharedDays: Weekday[]; departureTime: string } | { type: 'crewAnswerSimulated'; matchId: string; accept: boolean } | { type: 'crewStatusChanged'; matchId: string; status: 'active' | 'paused' | 'ended' } | { type: 'crewRideAnswered'; matchId: string; rideDate: string; answer: CrewRideAnswer }`
  - `type RelationshipState = { firstRide: FirstRideState; crews: Record<string, Crew> }`, `type RelationshipAction = FirstRideAction | CrewAction`
  - `type CrewRules = { resolveConnection: ResolveConnection; crewStatusAfter: (outcome: ConnectionOutcome, current: CrewStatus) => CrewStatus }`
  - `emptyRelationshipState(owner: string | null): RelationshipState`
  - `relationshipReducer(state, action, rules): RelationshipState` — returns the same object when nothing changes
  - `crewFor(state, matchId): Crew | null`, `isOpenCrew(crew: Crew | null): boolean`, `canProposeCrew(outcome, crew): boolean`, `isValidCrewDays(days, sharedDays): boolean`
  - `nextCrewRide(crew: Crew, fromDate: string): string | null` — the first date on or after `fromDate` on the Crew's days with no answer; null unless `active`
  - `confirmedCrewRides(crew: Crew, fromDate: string): string[]` — confirmed dates on or after `fromDate`, ascending

- [ ] **Step 1: Write the failing tests** (`crew.test.ts`, with the real `resolveConnection` and `crewStatusAfter` as `rules`, and a helper that books, completes and answers `yes` for `priya`, then simulates the partner's answer):
  - `canProposeCrew`: only `ride_again_crew_eligible` with no open Crew; true again after `ended` or `not_started`.
  - `isValidCrewDays`: false for `[]` and for a day outside `sharedDays`; true for a non-empty subset.
  - `crewProposed`: creates `{ status: 'proposed', days sorted Mon→Fri and de-duplicated, departureTime, rides: {} }` for Yes+Yes; same state object for Yes+Individual, for invalid days, and while a Crew is open.
  - `crewAnswerSimulated`: accept → `active`, decline → `not_started`; same state object unless `proposed`.
  - `crewStatusChanged`: `active → paused → active → ended`, `paused → ended`; `proposed → paused`, `ended → active` and `not_started → active` return the same state object.
  - Connection follows answers: with a `proposed` Crew, partner Individual → `not_started`; with an `active` Crew, partner Individual keeps `active`, partner No → `ended`; with `paused`, partner No → `ended`. A later partner Yes never reopens an `ended` Crew.
  - `nextCrewRide` with days `['Mon','Wed']` from `'2026-10-13'`: `'2026-10-14'`; after skipping it, `'2026-10-19'`; after confirming `'2026-10-19'`, `'2026-10-21'`; `confirmedCrewRides` gives `['2026-10-19']`. Null while `paused` and `proposed`; after resume the same next date returns.
  - `crewRideAnswered` is ignored (same object) unless `active`, for a date not on the Crew's days, and for an already-answered date.
  - `ownerChanged` to another owner clears `crews` and the First Ride state; the same owner returns the same object.
- [ ] **Step 2: Run** `npm test` from `apps/mobile`. Expected: FAIL, `./crew` not found.
- [ ] **Step 3: Implement `src/lib/crew.ts`.** `relationshipReducer` runs `firstRideReducer` for First Ride actions (and `ownerChanged`, which also clears `crews` when the owner differs), the Crew transition for Crew actions, then maps every Crew through `rules.crewStatusAfter(connectionFor(firstRide, matchId, rules.resolveConnection), crew.status)`, keeping object identity when no status changes. `nextCrewRide` walks `nextRideDates(crew.days, fromDate, n)` with `n` = answered count + 1 (enough, since each answered date can hide at most one slot).
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(m-28): pure Commute Crew rules` (stage the two files by path).

### Task 2: Provider, routes, Request `kind`, Match detail entry

**Files:**
- Modify: `apps/mobile/src/state/firstRide.tsx`, `apps/mobile/src/navigation.tsx`, `apps/mobile/App.tsx`, `apps/mobile/src/screens/RequestRideScreen.tsx`, `apps/mobile/src/screens/MatchDetailScreen.tsx`

**Interfaces:**
- Consumes: Task 1's `relationshipReducer`, `emptyRelationshipState`, `crewFor`, `CrewRules`, `Crew`, `CrewRideAnswer`; `RideKind` and `rideKindBadge` from `lib/rideKind.ts`; `isConnected` from `lib/firstRide.ts`.
- Produces: `useFirstRide()` gains `crew(matchId): Crew | null`, `proposeCrew(matchId, days, sharedDays, departureTime)`, `simulateCrewAnswer(matchId, accept)`, `setCrewStatus(matchId, status: 'active' | 'paused' | 'ended')`, `answerCrewRide(matchId, rideDate, answer: CrewRideAnswer)`. Routes `{ name: 'rideAgain'; matchId: string }`, `{ name: 'crewSetup'; matchId: string }`, `{ name: 'crew'; matchId: string }`; `request` becomes `{ name: 'request'; matchId: string; kind?: RideKind }` (missing means `first_ride`).

- [ ] **Step 1:** Provider: replace the `firstRideReducer` `useReducer` with `relationshipReducer` (rules `{ resolveConnection, crewStatusAfter }`, a module constant), keep the owner guard on `stored.firstRide.owner`, keep every existing `Ctx` member's behavior, and add the five Crew members. Update the doc comment.
- [ ] **Step 2:** Append the three routes to the `Route` union, and change `request` to take `kind?: RideKind`. In `App.tsx`, pass `kind={route.kind}` to `RequestRideScreen`, append the three screen imports and `renderRoute` cases (the screens come in Task 3; create minimal placeholder components exporting `RideAgainScreen`, `CrewSetupScreen`, `CrewScreen` with `{ matchId }` so typecheck passes).
- [ ] **Step 3:** Request: `kind` prop defaulting to `'first_ride'`. Title "Request a First Ride with {first}" for `first_ride`, "Request another ride with {first}" otherwise. Badge from `rideKindBadge(kind)` (none for `ride_again`). "This is one ride. No recurring commitment." stays for every kind.
- [ ] **Step 4:** Match detail: when `isConnected(connection(m.id))`, a card above the stats card with a "Ride Again" badge, "You and {first} are open to riding again." and a tinted "Open Ride Again" button → `push({ name: 'rideAgain', matchId })`. Nothing else in the file changes.
- [ ] **Step 5:** `npm run typecheck`, `npm test`. Commit `feat(m-28): Crew state in the First Ride provider, routes and Ride Again entry`.

### Task 3: Ride Again, Crew setup and Crew screens

**Files:**
- Create (replace placeholders): `apps/mobile/src/screens/RideAgainScreen.tsx`, `CrewSetupScreen.tsx`, `CrewScreen.tsx`

**Interfaces:**
- Consumes: Task 2's `useFirstRide()` Crew members and routes; Task 1's `canProposeCrew`, `isOpenCrew`, `isValidCrewDays`, `nextCrewRide`, `confirmedCrewRides`; `formatDays`, `formatRideDate`, `addDays` from `lib/dates.ts`; `PROTOTYPE_RIDE_DATE`, `findMatch` from `data/mock.ts`; `TimeField`, `Chip`, `Badge`, `Card`, `InfoNote`, `Segmented`, `Button`, `Screen`, `TopBar`.
- Prototype "today" for Crew rides: `addDays(PROTOTYPE_RIDE_DATE, 1)`.

- [ ] **Step 1: Ride Again.** Header "Ride Again" badge, "You and {first} are open to riding again.", one line that each ride is its own invitation for one date, and the primary "Invite for another ride" → `push({ name: 'request', matchId, kind: 'ride_again' })`. Crew card by state: open Crew `active`/`paused` → "Commute Crew" with status badge, `formatDays(days) · departureTime`, "Open Commute Crew" → `crew`; `proposed` → "Proposed" badge, "View proposal" → `crewSetup`; otherwise, only when `canProposeCrew` → "Start a Commute Crew" card (a "Not started" neutral badge when the last Crew is `not_started`) → `crewSetup`. When not connected and no open Crew: a neutral "Nothing to show here yet." with no reason.
- [ ] **Step 2: Crew setup.** Form (when no Crew is open and the screen hasn't just been declined): day `Chip`s for `m.sharedDays` only (all selected by default), `TimeField` "Leave around" (default `${m.departs} AM`), an `InfoNote` "Each ride is still confirmed individually. You can pause, skip, or end anytime, with no penalty.", and "Send proposal" (disabled unless `isValidCrewDays`). `proposed`: "Proposed" badge, the days and time, and a dashed "Prototype" box ("Prototype: simulate {first}'s answer", Accept / Decline). Accept → `back()` then `push({ name: 'crew' })`. Decline → neutral "Not started" with "Ride Again stays on. You can still invite {first} for single rides." and "Back to Ride Again" (`back()`).
- [ ] **Step 3: Crew view.** Status badge (Active / Paused) and `formatDays(days) · departureTime`. While active: "Next proposed ride" with `formatRideDate(next) · departureTime`, Confirm / Skip, and the confirmed list ("Confirmed: …"). While paused: "Paused. No rides are proposed until you resume." Controls: Pause or Resume, and End Crew (destructive) → `setCrewStatus('ended')` then `back()` to Ride Again. Note: "Either of you can pause, skip, or end anytime, with no penalty." When the Crew is missing or not open, fall back to `back()`-able neutral text.
- [ ] **Step 4:** `npm run typecheck`, `npm test`, `npm run lint` (0 errors). Commit `feat(m-28): Ride Again, Crew setup and Crew screens`.

### Task 4: Verify

- [ ] `npm run typecheck`, `npm test`, `npm run lint`.
- [ ] Web build (`npm run web`), prototype mode: Priya → Request → Booked → simulate completed → answer Yes → Submit → Thanks, simulate partner Yes / Individual / No (Match detail shows Ride Again only for Yes and Individual; the Crew card only for Yes). Then Ride Again → Invite for another ride (no First Ride badge). Crew: propose, accept, confirm, skip, pause, resume, end (back on Ride Again); propose again, decline (Not started, Ride Again stays). Console has no errors. Screenshots for the PR.
- [ ] Push, open the PR "M-28: Ride Again and Commute Crew screens".
