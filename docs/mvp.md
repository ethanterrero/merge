# Merge MVP product requirements

## Pilot
East Bay → San Francisco morning commute; initial focus on Alameda. The product is free during the pilot.

## Primary journey
1. Sign in and create a commuter profile (driver, passenger, or both).
2. Save origin, destination, recurring days, departure time, and preferences.
3. Discover eligible commuters via privacy-safe approximate map markers and ranked cards.
4. Request a First Ride for one date, with a proposed pickup area and trip time.
5. The driver accepts, then confirms the seat and any cargo reservation transactionally, setting the exact pickup spot inside the passenger's pickup area.
6. Coordinate pickup and complete the ride.
7. Give private post-ride feedback: how the ride went, and whether you'd ride together again. "Decide later" dismisses the prompt with nothing recorded.
8. If both people want to ride again, they reach Ride Again and can invite each other for one ride at a time. If both answered yes, either can propose a Commute Crew.

## Commitment levels
Every new match starts with one ride. Recurring carpools require a separate, mutual decision.

| Relationship | What it means | How you get there |
| --- | --- | --- |
| **First Ride** | One confirmed trip on one date, no future commitment | Default for every new match |
| **Ride Again** | Both are open to future invitations, one trip at a time | Both answer `yes` or `individual` after a completed ride |
| **Commute Crew** | Both agree to propose rides on selected days | Both answered `yes`, then one proposes and the other accepts |

Either member can pause, resume, or end a Commute Crew at any time, without penalty. A Crew never creates rides on its own: each Crew ride is a separate, dated invitation, prefilled from the Crew's days, that is confirmed or skipped individually. Skipping declines that day's invitation.

## Safeguards
- **Mutual interest stays private.** Neither person ever learns the other's post-ride answer. "They said no" and "they haven't answered" look the same: in both cases no connection exists. No notification is sent when someone says no. Experience feedback is visible only to its author and Merge.
- **Safety is separate from compatibility.** Safety reports are not stored with ride feedback, and have their own entry point ("Report a safety concern") on the post-ride screen.
- **No pressure to commit.** The post-ride prompt can be dismissed with no answer recorded.
- Accepted residual inference: if A answers `yes` and B answers `individual`, the pair gets Ride Again without the Crew option, so A may infer B didn't choose full `yes`. The UI never promises a Crew after a `yes`, so nothing is presented as a rejection.

## Matching rules
- Driver detour <= 5 minutes relative to the original route, including pickup and drop-off.
- Departure window ±15 minutes (respect both parties' constraints).
- Display both drivers and passengers by default.
- Hard filters: available seats, blocks, visibility, and cargo compatibility.
- Ride preferences (quiet, smoke-free) are preferred, never mandatory. Shared preferences raise a match's rank and show on its card, but never hide a match.
- Cargo example: **medium, foldable scooter**. Request dimensions and weight; verify available secure storage and obtain driver approval.
- Prefer recurring schedule fit and carpools that reach HOV occupancy, but never guarantee eligibility or travel-time savings.

## Privacy and safety
- Discovery opt-in: off until the person turns it on, asked on its own onboarding screen. People can browse matches before opting in; only opted-in people appear to others. No public exact home/work coordinates or real-time locations.
- Ride mode: location is used on the device only, during a ride the driver starts by tapping "Picked up". The device checks arrival at the destination area, and the server receives only "arrived" and a timestamp, never coordinates. Others never see your location, during a ride or otherwise.
- No counter-proposals: a request carries the pickup area and time, and the driver sets the exact spot when confirming. The server checks that the spot falls inside the passenger's ~0.5 mi pickup area. A passenger who dislikes the spot can cancel before the cancellation cutoff, with no penalty.
- The app never reveals who said no. A declined request looks the same as an expired one: "This ride isn't available anymore".
- Contact sharing is mutual and optional: each person chooses what to share (phone, email, or both), and neither sees anything until both have offered. It's available only while a confirmed ride between the pair exists (until 24 hours after it completes) or they're connected through Ride Again, and never across a block. Phone numbers aren't verified by Merge. In-app ride messages stay the main way to coordinate.
- Server-side matching, generalized map pins, rate-limited invitations, blocking and reporting.
- Reveal agreed pickup instructions only after mutual acceptance and booking confirmation.
- Review driver verification, insurance, regulations, and accessibility before real-world launch.
- No women-only preference in the pilot, and no gender data is stored.

## Out of scope for v0.1
Payments, tips, live tracking (others never see your location, during a ride or otherwise; ride mode uses location on the device only), automatic multi-stop group formation, AI-based matching, production HOV-time guarantees, and automatic recurring ride generation.

## Acceptance criteria for first milestone
- Expo starter launches in development.
- README, environment template, initial data model, and contribution instructions exist.
- No real user data or secrets are committed.

## Pilot acceptance criteria (draft)
Draft for the owner to approve in review. The pilot starts only when all of these hold.

- **End to end in connected mode.** A tester can sign in with an email code, save a commute, turn on discovery, and see approximate matches. A passenger can send a First Ride request for one date, and a driver can receive it. The driver accepts and confirms the seat and any cargo. Pickup details appear only after confirmation. Either rider can cancel. After the ride, each gives private post-ride feedback, and a pair who both want to ride again reaches Ride Again.
- **Privacy invariants hold.** Exact origin, destination and pickup points never reach another client. Before confirmation, others see only first name and last initial, role, approximate areas, ride preferences and verification flags. No screen reveals who said no, or tells "no" apart from "not answered". Ride mode sends the server only "arrived" and a timestamp.
- **Decided values only.** Every `[bracketed]` value in the UI is decided or removed.
- **Pilot blockers are cleared:** custom SMTP, in-app account deletion, the legal, insurance and regulatory review, and a store-review sign-in path (see [Pilot blockers](#pilot-blockers)).
- **Block and report work.** A blocked pair never appears to each other, and a safety report reaches Merge.
- **No unbacked trust claims.** Every trust signal shown comes from real data or a check Merge actually did.
- **Release builds never run in prototype mode** on sample data.

## Pilot blockers
- **Custom SMTP** (e.g. Resend or Postmark). Supabase's built-in sender only reaches project team members, so sign-in codes won't reach pilot testers without it.
- **In-app account deletion.** App Store guideline 5.1.1(v) requires it for any app that supports account creation.
- **Legal, insurance and regulatory review** with counsel, covering the free-carpool position, insurance, Terms, minimum age, HOV copy, and privacy and accessibility obligations.
- **Store-review sign-in path.** App Store and Play reviewers need a way to sign in without access to a Merge mailbox, seeing only labeled demo commuters, never real pilot users.
