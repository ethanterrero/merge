# First Ride — design

**Date:** 2026-10-08
**Status:** Approved for planning
**Scope:** UI prototype (`apps/mobile`), product docs, Supabase migration + SQL tests

## Principle

Every new match starts with one ride. Recurring carpools require a separate, mutual decision.

> Find someone going your way. Try one ride. Keep commuting together only if you both want to.

## Commitment levels

| Relationship | What it means | How you get there |
| --- | --- | --- |
| **First Ride** | One confirmed trip on one date, no future commitment | Default for every new match |
| **Ride Again** | Both are open to future invitations, one trip at a time | Both answer `yes` or `individual` after a completed ride |
| **Commute Crew** | Both agree to propose rides on selected days | Both answered `yes`, then one proposes and the other accepts |

A Commute Crew can be paused, resumed, or ended by either member at any time, without penalty. A Crew never creates rides on its own: each Crew ride is a separate, dated invitation (prefilled from the Crew's days) that is confirmed or skipped individually. Skipping is declining that day's invitation.

## Safeguards

1. **Mutual interest stays private.** Neither person ever learns the other's post-ride answer. "They said no" and "they haven't answered" are indistinguishable to the client: in both cases no connection exists. No notification is sent when someone says no. Experience feedback (`great` / `good` / `not_a_fit`) is visible only to its author and Merge.
2. **Safety is separate from compatibility.** Safety reports are not stored with ride feedback and have their own entry point ("Report a safety concern") on the post-ride screen.
3. **No pressure to commit.** The post-ride prompt can be dismissed ("Decide later") with no answer recorded.

Accepted residual inference: if A answers `yes` and B answers `individual`, the pair gets Ride Again without the Crew option, so A may infer B did not choose full `yes`. The UI never promises Crew after a `yes`, so nothing is presented as a rejection.

## Data model — `supabase/migrations/0003_first_ride.sql`

### `invitations` (altered)

- Add `ride_date date not null`. Every request is for one specific day.
- Add `crew_id uuid null references commute_crews(id)` to trace Crew-originated invitations.

### `rides` (new)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `invitation_id` | uuid unique, references `invitations` | |
| `driver_id`, `passenger_id` | uuid, references `profiles` | check `driver_id <> passenger_id` |
| `ride_date` | date | |
| `pickup_time` | time | |
| `status` | text | `confirmed` \| `completed` \| `cancelled` |
| `kind` | text | `first_ride` \| `ride_again` \| `crew` |
| `created_at`, `completed_at` | timestamptz | |

RLS: participants can `select` their own rides. Writes come later with the booking API (default deny for now).

### `ride_feedback` (new)

| Column | Type | Notes |
| --- | --- | --- |
| `ride_id` | uuid, references `rides` | pk with `author_id` |
| `author_id` | uuid, references `profiles` | |
| `experience` | text null | `great` \| `good` \| `not_a_fit` |
| `ride_again` | text null | `yes` \| `individual` \| `no` |
| `dismissed_at` | timestamptz null | "Decide later" |
| `created_at`, `updated_at` | timestamptz | |

RLS: the author can `select`, `insert`, `update` their own rows only. `insert`/`update` require that `author_id = auth.uid()`, the author was on the ride, and the ride is `completed`. No one else, including the other rider, can read a row.

### `connections` (new)

| Column | Type | Notes |
| --- | --- | --- |
| `user_low`, `user_high` | uuid, references `profiles` | pk on the pair; check `user_low < user_high` |
| `crew_eligible` | boolean | true only when both latest answers are `yes` |
| `created_at`, `updated_at` | timestamptz | |

RLS: members can `select`. Clients have no insert/update/delete grants or policies.

Maintained by `resolve_connection(a uuid, b uuid)`, a `security definer` function called from an `after insert or update` trigger on `ride_feedback`:

1. For each person, take their most recent non-null `ride_again` across completed rides shared by the pair (ordered by `ride_feedback.updated_at`).
2. If both answers are in (`yes`, `individual`): upsert the connection with `crew_eligible = (both = 'yes')`.
3. Otherwise (any `no`, or either missing): delete the connection, and set any `proposed`/`active`/`paused` Crew for the pair to `ended`.
4. If the connection remains but `crew_eligible` becomes false, a `proposed` Crew becomes `not_started`. An `active`/`paused` Crew is left alone. Members end it explicitly.

### `commute_crews` (new)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `user_low`, `user_high` | uuid | the pair |
| `proposed_by` | uuid | one of the pair |
| `weekdays` | integer[] | ISO weekdays 1–5, non-empty |
| `departure_time` | time | |
| `status` | text | `proposed` \| `active` \| `paused` \| `ended` \| `not_started` |
| `created_at`, `responded_at`, `ended_at` | timestamptz | |

At most one non-terminal Crew per pair (partial unique index on the pair where status in `proposed`, `active`, `paused`).

RLS: members can `select`. All writes go through `security definer` RPCs:

- `propose_crew(other uuid, weekdays integer[], departure_time time)`: requires a connection with `crew_eligible = true` and no open Crew. Inserts `proposed`.
- `respond_to_crew(crew_id uuid, accept boolean)`: only the non-proposer, only while `proposed`. Accept sets `active` and decline sets `not_started`. The proposer sees a neutral "Not started", and Ride Again is unaffected.
- `set_crew_status(crew_id uuid, status text)`: either member. Allowed transitions: `active → paused`, `paused → active`, `active|paused → ended`. The proposer may also withdraw `proposed → not_started`.

## Prototype UI — `apps/mobile`

Mock data only, as today. No Supabase calls.

### Changed screens

- **Welcome:** replace "The same ride, every week" with "Start with one ride". Body: "Find someone going your way. Try one ride. Keep commuting together only if you both want to."
- **Request a ride:** title "Request a First Ride with {first}". Remove the "Repeat Mon–Thu" toggle. Show one date with a "First Ride" badge. Add a final line to "What happens next": "This is one ride. No recurring commitment."
- **Booked:** "First Ride booked with {first}" / "Mon, Oct 12". Remove "Skip one day". "Cancel ride" cancels only this ride. Add a prototype-only "Simulate ride completed" button that opens Post-ride.
- **Driver requests / request / confirm:** show "Mon, Oct 12 · First Ride" instead of "Mon–Thu". Mock `RideRequest.days` becomes `rideDate` + `kind`.

### New screens

1. **Post-ride:** "How was your ride with {first}?", with the line "Your feedback is private and helps make future rides better."
   - Experience: Great experience / Good experience / Not a good fit.
   - "Would you ride together again?": "Yes, I'd ride with {first} again" / "Maybe, but only for individual rides" / "No, thanks".
   - Buttons: "Submit" (enabled once either question is answered) and "Decide later" (dismisses, nothing recorded).
   - A separate "Report a safety concern" link below, leading to a placeholder notice.
2. **After submitting:** "Thanks. If {first} also wants to ride again, you'll see it here." It never reveals answers. A visibly labeled "Prototype: simulate {first}'s answer" control (Yes / Individual / No) drives the outcome. With No, nothing changes.
3. **Ride Again** (on the match connection): "You and {first} are open to riding again." The "Invite for another ride" button opens Request for one date (`kind: ride_again`, no First Ride badge). If both answered Yes, a "Start a Commute Crew" card appears.
4. **Crew setup:** choose shared days (limited to the match's `sharedDays`) and a departure time. Explains: each ride is still confirmed individually, and you can pause, skip, or end anytime with no penalty. Sending shows "Proposed", with a prototype control to simulate accept or decline (decline → "Not started", Ride Again stays).
5. **Crew view:** the Crew's days and time, the next proposed ride with Confirm / Skip, and Pause / Resume / End controls. Ending returns to Ride Again.

### State

- `state/commute.tsx` gains per-match relationship state: ride status, my feedback, simulated partner answer, and the Crew (status, days, time).
- `state/connection.ts` exports a pure `resolveConnection(mine, theirs)` that returns `none | ride_again | ride_again_crew_eligible`, mirroring the SQL rules.
- The minimal navigator in `navigation.tsx` gains routes: `postRide`, `postRideThanks`, `rideAgain`, `crewSetup`, `crew`.

## Docs

- **`docs/mvp.md`:** Primary journey step 4 becomes "Request a First Ride for one date". Add steps for private post-ride feedback and the mutual Ride Again decision. Add the commitment-levels table and the safeguards as product rules. Add "automatic recurring ride generation" to Out of scope for v0.1.
- **`docs/ui.md`:** Passenger flow → Request First Ride → Booked → Post-ride → Ride Again → Crew. The driver flow shows one date. Add a rule: the UI never reveals who said no, or whether a missing connection means "no" or "not answered".
- **`README.md`:** Replace "coordinate recurring rides" with "start with one ride and keep commuting together only if you both want to". Add First Ride / Ride Again / Commute Crew to MVP features. Roadmap step 4 mentions First Ride.

## Testing

- `npm run typecheck` passes (the app's CI check).
- `supabase/tests/first_ride_test.sql`: plain SQL with `DO` blocks that `raise exception` on failure, run by `scripts/db-test.sh` (defined in the Supabase connection spec, `2026-10-08-supabase-auth-design.md`). It asserts:
  1. Only the author can read their `ride_feedback`. The other rider gets zero rows.
  2. Feedback can't be submitted for a ride that isn't completed or that the author wasn't on.
  3. Yes + No → no connection. Yes + (no answer) → no connection. Both look identical to the client.
  4. Yes + Individual → connection, `crew_eligible = false`.
  5. Yes + Yes → connection, `crew_eligible = true`.
  6. Changing an answer to No removes the connection and moves an active Crew to `ended`.
  7. Clients can't insert, update, or delete `connections` directly.
  8. `propose_crew` is refused without `crew_eligible`. `respond_to_crew` is refused for the proposer.
- Manual walkthrough of every new prototype path in the Expo web build, including all three simulated partner answers and Crew accept/decline/pause/end.

## Out of scope

- Wiring First Ride screens to Supabase. Sign-in and profiles are covered by the Supabase connection spec. Rides, feedback, and Crews stay on mock data in the app.
- Automatically generated Crew rides.
- The safety report flow beyond its entry point.
- Notifications.
- Editing a submitted answer in the prototype (the schema supports it via `update`).
