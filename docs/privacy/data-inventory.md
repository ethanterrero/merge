# Data inventory and processor map

**Date:** 2026-10-08
**Task:** M-11
**Status:** Draft. This is an engineering inventory, not legal text.
**Used for:** the pilot privacy policy, the Apple App Privacy labels, the Google Play Data safety form, and the account-deletion policy.

Sources: `supabase/migrations/0001_initial.sql` and `0002_profiles_rls.sql`, the First Ride and Supabase auth specs (`docs/superpowers/specs/2026-10-08-*`), `README.md`, `docs/mvp.md`, `docs/ui.md`, the M01 map-provider research (`docs/research/2026-10-08-m01-map-provider.md` on `main`), and owner decisions D-01 to D-19 from 2026-10-08.

## How to read this

**Status**

- **current**: exists in a migration on this branch, or is collected today by Supabase Auth or the app.
- **planned**: decided, not built yet. Column and table names are working names.
- **proposed**: a default that the owner hasn't decided yet.

**Who can see it**

| Label | Meaning |
| --- | --- |
| Self | The person the data belongs to |
| Candidates | Other users who opted into discovery and match the person's commute, before any ride is confirmed. They see only first name + last initial, role, approximate (~0.5 mi) areas, ride preferences and verification flags. |
| Matched rider | The other person on a confirmed ride |
| Connection | The other person in a Ride Again connection or Commute Crew |
| Mutual contacts | The other person, once the D-19 reveal rules are met (section 5) |
| Staff | Merge staff (today: the project owner), through the Supabase dashboard or the service-role key |

**Current exposure.** On this branch only `profiles` has RLS policies, and they allow a user to read and edit their own row. `vehicles`, `commutes` and `invitations` are default-deny, so today only Staff can read them. The "Who can see" columns describe the intended design. Real exposure is never wider than that.

**Fixed rules.** Exact coordinates are never shown to other users. Discovery is opt-in and off by default (D-14). There's no geocoding or routing vendor: people place pins on the map, and detour is estimated in PostGIS (D-08).

## 1. Account and profile

| Element | Purpose | Stored in | Who can see | Retention | On account deletion | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Email address | Sign-in with a 6-digit code, account emails | `auth.users.email`, `auth.identities` (Supabase Auth) | Self, Staff. Never other users. | Life of the account | Deleted with `auth.users` | current |
| Email sign-in code | Prove control of the email | `auth.one_time_tokens` (hashed); sent in an email through the SMTP sender | Self (in their inbox) | Expires after 600 s | Deleted with `auth.users` | current |
| Email confirmed / sign-in times | Account state, security | `auth.users` (`email_confirmed_at`, `last_sign_in_at`, `created_at`, `updated_at`) | Staff | Life of the account | Deleted | current |
| User ID (UUID) | Links every record to the account | `auth.users.id` = `profiles.id` | Staff. Other users never see raw IDs in the UI, but RLS-filtered rows carry them. | Life of the account | Deleted. Shared records keep no link (section 9). | current |
| Display name | What other riders call you. Hint: "First name and last initial, like Priya S." | `profiles.display_name` (2–40 characters) | Self, Staff. Candidates and Matched riders see first name + last initial. | Life of the account | Deleted. Shared rides show "Former member". | current |
| Role | Driver, passenger or both | `profiles.role` | Self, Candidates, Matched rider, Staff | Life of the account | Deleted | current |
| Discovery opt-in | Whether the person appears in discovery. Default off (D-14). | `profiles.discovery_opt_in` | Self, Staff (used server-side to filter discovery) | Life of the account | Deleted | current |
| Profile created date | Record keeping. The prototype shows "member since" on match cards. | `profiles.created_at` | Self, Staff. Candidates only if "member since" ships (owner question Q6). | Life of the account | Deleted | current |
| Ride preferences (quiet ride, smoke-free, women-only) | Hard filters in matching | Not in a migration yet | Self, Candidates, Matched rider, Staff | Life of the account | Deleted | planned |
| Vetted flag | Driver vetted by the owner after seeing licence and insurance in person or on video (D-06). Set server-side only; clients can't write it. | Server-only column, e.g. `profiles.vetted` (+ `vetted_at`) | Self, Staff. Candidates and Matched riders see it as a verification badge. | Life of the account | Deleted | planned |
| Licence and insurance documents | Vetting (D-06) | **Not stored by Merge.** Viewed in person or on a live video call; nothing kept. | n/a | n/a | n/a | not collected (confirm, Q5) |

## 2. Commute

| Element | Purpose | Stored in | Who can see | Retention | On account deletion | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Exact origin and destination points | Matching and detour estimate. Set by the person placing a pin on the map; no geocoding. | `commutes.origin`, `commutes.destination` (PostGIS `geography(point)`) | Self, Staff. **Never other users.** | Until the person edits or deletes the commute | Deleted (`on delete cascade`) | current |
| Approximate areas (~0.5 mi zone centres) | What Candidates see on the map | Derived server-side from the exact points (snapped/jittered). Not stored, or cached server-side only. | Self, Candidates, Matched rider | Recomputed on demand | Gone with the points | planned |
| Schedule: weekdays, departure time, time zone | Matching | `commutes.weekdays`, `commutes.departure_time`, `commutes.timezone` | Self, Staff. Candidates see the shared days and time window (Q6). | Until edited or deleted | Deleted | current |
| Flexibility: departure window, max detour | Matching (defaults ±15 min, 5 min detour) | `commutes.departure_flex_minutes`, `commutes.max_detour_minutes` | Self, Staff | Until edited or deleted | Deleted | current |
| Commute role and vehicle link | Which direction of matching, and which car | `commutes.role`, `commutes.vehicle_id` | Self, Staff | Until edited or deleted | Deleted | current |
| Commute IDs and dates | Keys, record keeping | `commutes.id`, `commutes.owner_id`, `commutes.created_at` | Staff | Until deleted | Deleted | current |
| Agreed pickup point and instructions | Where to meet. Revealed only after confirmation. | Not in a migration yet | Self, Matched rider, Staff | With the ride (section 4) | Kept with the shared ride for the other rider (proposed) | planned |

## 3. Vehicle

| Element | Purpose | Stored in | Who can see | Retention | On account deletion | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Make, model, year, colour | Recognise the car at pickup | `vehicles.make`, `vehicles.model`, `vehicles.model_year`, `vehicles.color` | Self, Staff. Matched rider after confirmation. | Until the person deletes the vehicle | Deleted (`on delete cascade`) | current |
| Seats and scooter acceptance | Matching filters (seats, cargo) | `vehicles.passenger_seats`, `vehicles.accepts_foldable_scooters` | Self, Staff. Candidates see fit, not the raw values (proposed). | Until deleted | Deleted | current |
| Vehicle IDs and dates | Keys, record keeping | `vehicles.id`, `vehicles.owner_id`, `vehicles.created_at` | Staff | Until deleted | Deleted | current |
| Licence plate | Recognise the car at pickup | Not in a migration yet | Self, Staff. Matched rider after confirmation only. | Until deleted | Deleted | planned |
| Passenger cargo details (scooter size, weight) | Cargo compatibility (`docs/mvp.md`) | Not in a migration yet | Self, Matched driver, Staff | With the request | Deleted | planned |

## 4. Invitations, rides and relationships

| Element | Purpose | Stored in | Who can see | Retention | On account deletion | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Invitations (sender, recipient, commute, status, created date) | Ride requests | `invitations.id`, `sender_id`, `recipient_id`, `commute_id`, `status`, `created_at` | Sender, recipient, Staff | Proposed: pending ones expire; others kept with the ride | Proposed: pending invitations cancelled and deleted; ones tied to a ride kept for the other rider as "Former member". **Current schema blocks deletion** (section 9). | current |
| Invitation date and Crew link | One ride per date; trace Crew-originated invitations | `invitations.ride_date`, `invitations.crew_id` (`0003_first_ride.sql`) | Sender, recipient, Staff | As above | As above | planned |
| Rides (driver, passenger, date, pickup time, status, kind, created/completed times) | The confirmed trip | `rides` (`0003_first_ride.sql`) | Both riders, Staff | Proposed: until pilot end | Proposed (D-15): kept for the other rider, who sees "Former member" | planned |
| Picked-up time | Ride mode: the driver taps "Picked up" (D-01) | `rides.picked_up_at` | Both riders, Staff | With the ride | Kept with the ride, reference cleared | planned |
| Arrived event and time | Ride mode: the device checks arrival **on-device** and sends only an `arrived` event and timestamp, never coordinates (D-01) | `rides.arrived_at` | Both riders, Staff | With the ride | Kept with the ride, reference cleared | planned |
| "Didn't happen" mark | Either rider can mark a ride as not having happened, within 24 h (D-01) | e.g. `rides.disputed_by`, `rides.disputed_at` | Both riders, Staff | With the ride | Kept with the ride, reference cleared | planned |
| Late cancellation record | Recorded privately, no penalty in the pilot (D-02) | e.g. `rides.cancelled_by`, `rides.cancelled_at`, `rides.late_cancel` | Staff. The other rider sees only that the ride was cancelled. | With the ride | Kept with the ride, reference cleared | planned |
| Ride feedback (experience, ride-again answer, "decide later") | Private quality signal; drives Ride Again | `ride_feedback` (`0003_first_ride.sql`) | Author and Staff only. Never the other rider. | Proposed: until pilot end | Deleted (owned by the author) | planned |
| Connections (Ride Again pair, crew eligibility) | Lets the pair invite each other again | `connections` (`0003_first_ride.sql`), maintained by a trigger | Both members, Staff | While both answers stay yes/individual | Deleted | planned |
| Commute Crews (pair, proposer, days, time, status, dates) | Agreed recurring days | `commute_crews` (`0003_first_ride.sql`) | Both members, Staff | Until ended; ended rows kept until pilot end (proposed) | Proposed (D-15): open Crews set to `ended`; the other member sees "Former member" | planned |
| Derived trust stats (rides count, on-time rate) | Trust signals shown in the prototype's match detail | Computed from `rides` | Candidates, if shipped (Q6) | Not stored | n/a | planned (undecided) |

## 5. Messages, contact sharing and notifications

| Element | Purpose | Stored in | Who can see | Retention | On account deletion | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Ride messages (text, sender, ride, time) | Coordinate a confirmed ride. Only after confirmation (D-13). | New table, e.g. `ride_messages` | Both riders, Staff | Proposed: 30 days after the ride ends, unless attached to a safety report (Q8) | Proposed: the person's messages deleted; the other rider sees "Message removed" (Q8) | planned |
| Shared contact details: phone and/or email typed by the person | Let riders reach each other off-app (D-19). **Phone numbers are not verified.** | Owner-only table, e.g. `contact_details`; only the owner can read their row | Self, Staff. Mutual contacts only when all reveal rules hold (below). | Until the person removes them | Deleted; the reveal stops immediately | planned |
| Contact-sharing offers (who offered to whom, when) | Track the "both offered" rule | e.g. `contact_offers` | Both people (each sees whether they offered), Staff | Until withdrawn, or the pair no longer qualifies | Deleted | planned |
| Push tokens (Expo push token, platform) | Push notifications (D-13) | e.g. `push_tokens` | Self, Staff | Until sign-out, or until Expo reports the token invalid | Deleted | planned |
| Notification content | Tell people about requests, confirmations and messages | Not stored by Merge; passes through Expo, then APNs or FCM | Self (on device), the push services in transit | Push services' own short retention | n/a | planned |

**D-19 reveal rules.** Contact details are shown to the other person only when all of these hold:

1. Both people have offered to share.
2. They have a confirmed ride (until 24 h after it completes) **or** a Ride Again connection.
3. Neither has blocked the other.

The check runs server-side on every read, so a block or a lapsed ride hides the details immediately.

## 6. Safety

| Element | Purpose | Stored in | Who can see | Retention | On account deletion | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Blocks (blocker, blocked, time) | Hide each person from the other everywhere | New table, e.g. `blocks` | Blocker, Staff. The blocked person isn't told. | Until unblocked | Deleted (Q9) | planned |
| Safety reports (reporter, reported person, ride, category, description, time, staff notes) | Safety follow-up. Stored separately from ride feedback. | New table, e.g. `safety_reports` | Reporter (their own reports), Staff. Never the reported person. | Proposed (D-15): 12 months | Proposed (D-15): kept 12 months with the deleted person's reference cleared (Q9) | planned |
| Invitation rate limits | Stop spam requests (`docs/mvp.md`) | Counters derived from `invitations` | Staff | With invitations | With invitations | planned |

## 7. Technical and device data

| Element | Purpose | Stored in | Who can see | Retention | On account deletion | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Supabase API and Auth request logs: IP address, user agent, path, status, time, user ID from the token | Operations, debugging, abuse detection | Supabase platform logs | Staff, Supabase | Supabase plan log retention (Free 1 day, Pro 7 days at time of writing; verify) | Not deleted early; ages out | current |
| Auth audit log: action, user ID, email, IP address | Security trail of sign-ins | `auth.audit_log_entries` (Supabase Auth, inside our database) | Staff | Kept indefinitely by default. Proposed: purge after 90 days. | **Not removed by the cascade** (no foreign key). The deletion job must purge it (verify). | current |
| Auth sessions and refresh tokens (may include IP and user agent) | Keep the person signed in | `auth.sessions`, `auth.refresh_tokens` | Staff | Until sign-out or expiry | Deleted with `auth.users` | current |
| Session tokens on the device | Stay signed in across launches | SQLite-backed `localStorage` on the device (`expo-sqlite`) | Self (on device only) | Until sign-out or uninstall | Server-side tokens are revoked; the access token works until it expires (about 1 h) | current |
| Device location during a ride | On-device arrival check only (D-01). Foreground only, only during a ride the driver started. | **Never stored or sent.** Read on the device; only the `arrived` event leaves it. | Nobody but the device | Not kept | n/a | planned |
| Map tile requests: IP, viewport (tile coordinates), user agent, API key | Draw the map | Stadia Maps server logs (not Merge) | Stadia | About 7–14 days per Stadia's privacy policy | n/a | planned |
| Crash diagnostics: stack trace, device model, OS, app version (IP and user ID off by default) | Fix crashes (D-17, if Sentry is adopted) | Sentry | Staff, Sentry | Sentry plan retention (Q4) | Unlinked if no user ID is sent; otherwise deleted through Sentry's API | planned (undecided) |

**Logging hygiene.** Send emails and coordinates in request bodies (POST, RPC), never in query strings, so they don't land in request logs.

## 8. Not collected

Merge doesn't collect these in the pilot:

- Profile photo, bio, employer, interests (richer profiles are deferred).
- Payment or financial data, since the pilot is free.
- Device location history or live tracking. Location is used on-device during a ride only.
- Address search history (no geocoding vendor), and street addresses.
- Contacts, photos, calendar, microphone, health data.
- Advertising IDs, analytics or ad SDKs, and cross-app tracking.
- Copies of licences, insurance, or other ID documents (D-06).
- Work email, government ID verification. The prototype shows these as badges (Q6).
- Gender. A women-only preference may need it (Q7).
- Phone sign-in or SMS. Sign-in is email only.

## 9. Account deletion

**Proposed default (D-15, not decided).**

- Delete everything the person owns: profile, commutes, vehicles, feedback, contact details and offers, push tokens, blocks they made, connections, and their pending invitations.
- Keep shared rides for the other rider, shown as "Former member". The deleted person's ID is cleared from the row.
- Set open Crews to `ended`.
- Keep safety reports for 12 months with the deleted person's reference cleared.
- Purge `auth.audit_log_entries` rows for the person.
- Delete their Sentry user data, if Sentry is adopted and user IDs are sent.

**Gaps in the current schema** (for the deletion implementation, not fixed here):

- `invitations.sender_id`, `recipient_id` and `commute_id` have no `on delete` action. Deleting `auth.users` cascades to `profiles` and `commutes`, then fails on any invitation that references them. The cascade can't succeed for anyone who has sent or received an invitation.
- Keeping rides as "Former member" needs nullable participant columns (or a tombstone profile) in `0003_first_ride.sql`.
- In-app deletion is a pilot blocker: Apple guideline 5.1.1(v). Google Play also needs a **web link** where people can request deletion without the app.

## 10. Schema coverage (migrations 0001 and 0002)

Every table and column on this branch, and where it's covered above.

| Table | Columns | Section |
| --- | --- | --- |
| `profiles` | `id`, `display_name` (2–40 char check), `role`, `discovery_opt_in`, `created_at` | 1 |
| `vehicles` | `id`, `owner_id`, `make`, `model`, `model_year`, `color`, `passenger_seats`, `accepts_foldable_scooters`, `created_at` | 3 |
| `commutes` | `id`, `owner_id`, `role`, `origin`, `destination`, `departure_time`, `timezone`, `weekdays`, `max_detour_minutes`, `departure_flex_minutes`, `vehicle_id`, `created_at` | 2 |
| `invitations` | `id`, `sender_id`, `recipient_id`, `commute_id`, `status`, `created_at` | 4 |
| `auth.*` (Supabase-managed, not in our migrations) | `users`, `identities`, `sessions`, `refresh_tokens`, `one_time_tokens`, `audit_log_entries` | 1, 7 |

## 11. Processors

| Processor | Role | Data it receives | Region | Terms | Status |
| --- | --- | --- | --- | --- | --- |
| Supabase | Database, Auth, API, logs. Project `aeycmdjoplppvizvwhgs`. | Everything in sections 1–7 that's stored server-side, plus request IPs | **TBD (Q1)** | Supabase DPA (to sign) | current |
| Supabase built-in email sender | Sends sign-in codes today. Delivers only to project team members; development only. | Email address, code | Supabase | Covered by Supabase | current (to be replaced) |
| SMTP provider: Resend or Postmark | Sends sign-in codes and account emails to testers | Email address, code, message content, delivery logs | **TBD (Q2)** | Provider DPA | planned |
| Expo push service | Routes push notifications | Expo push token, notification content | US (verify) | Expo terms / DPA (verify) | planned |
| Apple Push Notification service | Delivers to iOS | Device token, notification content | Apple | Apple Developer terms | planned |
| Firebase Cloud Messaging | Delivers to Android | FCM token, notification content | Google | Firebase data processing terms. Don't enable Firebase Analytics. | planned |
| Stadia Maps | Map **tiles only** (D-08) | IP address, viewport, user agent, API key | Not stated in M01 (verify) | DPA available; logs about 7–14 days | planned |
| Sentry | Crash diagnostics (D-17) | Crash data; IP and user ID off unless enabled | US or EU (Q4) | Sentry DPA | planned (undecided) |

**No geocoding or routing vendor.** People place their own pins, and detour is estimated in PostGIS. If address search or real routing is added later, the new vendor goes on this list.

**Not processors.** Apple (TestFlight) and Google (Play testing tracks) hold tester emails as their own data. GitHub holds code only; no real user data is committed.

**Keep push content short.** Expo, Apple and Google all see the notification text. Proposed: say "New message from Priya S." rather than including the message body (Q8).

## 12. Apple App Privacy (draft)

Apple counts data as **collected** when it's sent off the device and kept longer than needed to serve the request in real time. Data processed only on the device isn't collected.

Tracking: **none.** No ads, no data brokers, no cross-app linking. App Tracking Transparency isn't needed.

| Apple data type | Collected | Linked to the user | Purposes | Source in this inventory |
| --- | --- | --- | --- | --- |
| Contact Info → Email Address | Yes | Yes | App Functionality | Sign-in email; optional shared email (D-19) |
| Contact Info → Name | Yes | Yes | App Functionality | Display name |
| Contact Info → Phone Number | Yes (optional, once D-19 ships) | Yes | App Functionality | Shared phone |
| Location → Precise Location | Yes | Yes | App Functionality | Pinned origin and destination |
| Location → Coarse Location | Yes (see note 3) | Yes | App Functionality | Approximate areas; tile viewports seen by Stadia |
| User Content → Emails or Text Messages | Yes (once D-13 ships) | Yes | App Functionality | Ride messages |
| User Content → Other User Content | Yes | Yes | App Functionality | Ride feedback, safety reports, schedule, vehicle and plate |
| Identifiers → User ID | Yes | Yes | App Functionality | Supabase user ID |
| Identifiers → Device ID | Yes (see note 4) | Yes | App Functionality | Push token |
| Diagnostics → Crash Data, Performance Data | Only if Sentry is adopted | No, if no user ID is sent | App Functionality | Sentry |

Notes and uncertainty:

1. **Pinned points versus device location.** The pinned origin and destination are user-placed latitude/longitude points for home and work. That is Precise Location under Apple's definition (lat/long to three or more decimals), even though no GPS is used. The device location used during a ride stays on the device and isn't collected.
2. **The `arrived` event.** It carries no coordinates, but combined with the stored destination it shows that the person reached a known point at a known time. We already declare Precise Location for App Functionality, so the label covers it either way. The permission prompt (`NSLocationWhenInUseUsageDescription`) should say that location stays on the device.
3. **Coarse Location is a judgement call.** Approximate areas are derived from the pinned points, which are already declared. Stadia logs tile viewports for 7–14 days, which is longer than "real time". Declaring Coarse Location is the cautious answer; leaving it out is defensible because it adds nothing beyond Precise.
4. **Push tokens.** Apple's Device ID examples are advertising IDs. Many apps declare push tokens as Device ID to be safe. Unsure.
5. **Schedule, vehicle and plate.** Apple has no exact category. "Other User Content" fits better than "Other Data Types". Unsure.
6. **IP addresses** in Supabase logs are used only for security and operations, never to locate people. Apple asks for Coarse Location only when an IP is used for location, so they aren't declared separately.
7. **Gender.** Apple's Sensitive Info list doesn't include gender. If the women-only preference collects gender, declare it under Other Data Types (Q7).

## 13. Google Play Data safety (draft)

Google counts data as **collected** when it's sent off the device. Data accessed and processed only on the device doesn't need to be declared. Sending data to a service provider (processor) isn't **sharing**. Neither is a transfer the user starts and reasonably expects, such as contact details revealed to the other rider.

- Data shared with third parties: **none.**
- Encrypted in transit: **yes** (HTTPS to Supabase, Stadia, Expo, Sentry).
- Users can request deletion: **yes**, in the app and by a web link. Both are pilot blockers.

| Play category → type | Collected | Shared | Required or optional | Purposes | Source |
| --- | --- | --- | --- | --- | --- |
| Location → Precise location | Yes | No | Required | App functionality | Pinned points (an area under 3 km²) |
| Location → Approximate location | Yes (see note 3) | No | Required | App functionality | Approximate areas, tile viewports |
| Personal info → Name | Yes | No | Required | App functionality, Account management | Display name |
| Personal info → Email address | Yes | No | Required (sign-in); optional (D-19) | Account management, App functionality | Sign-in email; shared email |
| Personal info → User IDs | Yes | No | Required | Account management | Supabase user ID |
| Personal info → Phone number | Yes (once D-19 ships) | No | Optional | App functionality | Shared phone |
| Personal info → Other info | Yes | No | Required for drivers | App functionality | Vehicle and plate; gender if the women-only preference needs it (Q7) |
| Messages → Other in-app messages | Yes (once D-13 ships) | No | Optional | App functionality | Ride messages |
| App activity → Other user-generated content | Yes | No | Optional | App functionality, Fraud prevention/security | Feedback, safety reports |
| App activity → Other actions | Yes | No | Required | App functionality | Invitations, rides, picked-up and arrived times, cancellations |
| Device or other IDs | Yes | No | Optional (push) | App functionality | Push token |
| App info and performance → Crash logs, Diagnostics | Only if Sentry is adopted | No | Required (or opt-out) | Analytics (Google's term for crash monitoring) | Sentry |

Notes and uncertainty:

1. **Device location during a ride** is on-device only, so it isn't declared. Like Apple, the `arrived` event is derived from location; the Precise location declaration already covers it.
2. **Permissions.** Ride mode needs foreground location only (`ACCESS_FINE_LOCATION`), and no `ACCESS_BACKGROUND_LOCATION`. If updates must continue while the screen is off, Android needs a foreground service of type `location`, and Play requires a foreground-service declaration. Confirm while building D-01.
3. **Approximate location** is the cautious answer, as for Apple.
4. **Schedule and vehicle.** "Other user-generated content" versus "Other info" is a judgement call. Plate is placed under Other info because it identifies a person.
5. **IP addresses** aren't a listed Play type unless used for location. Not declared.
6. **Purposes.** Supabase logs and safety reports support "Fraud prevention, security, and compliance". Adding it to the relevant rows is cautious and harmless.

## 14. End-of-pilot deletion plan

Pilot end date: TBD.

1. **30 days before:** email testers that the pilot is ending, what will be deleted and when, and how to delete their account early.
2. **Before deleting:** export only aggregate counts (rides completed, matches, feedback mix). No IDs, names, coordinates or message text.
3. **Delete user data:**
   - Delete every `auth.users` row; the cascade removes profiles, commutes and vehicles once the invitation gap (section 9) is fixed.
   - Truncate the remaining public tables and purge `auth.audit_log_entries`.
   - Keep safety reports only if D-15's 12-month rule applies, de-identified (Q10).
4. **Vendors:**
   - Revoke the Stadia and Expo push credentials, and delete push tokens.
   - Delete the Sentry project, if any.
   - Let the SMTP provider's message logs expire, or delete them through its dashboard.
5. **Supabase:** either pause and delete the project, or keep it empty for a next phase with fresh consent. Platform logs age out per plan. Backups age out after the plan's backup window (Pro: 7 days; verify).
6. **Devices:** ask testers to uninstall. Session tokens stop working once the accounts are gone.
7. **Record** the deletion date and steps in this file.

## 15. Owner questions

| # | Question |
| --- | --- |
| Q1 | Which region is Supabase project `aeycmdjoplppvizvwhgs` in? Has the Supabase DPA been signed? |
| Q2 | SMTP provider: Resend or Postmark, and which region? How long are message logs kept? |
| Q3 | Expo push: confirm Expo's data terms. Will notifications include message text (proposed: no)? |
| Q4 | D-17: adopt Sentry? If so, US or EU region, retention, and confirm no IP or user ID is sent. |
| Q5 | D-06: confirm no licence or insurance copies are kept anywhere (photos, screenshots, emails, call recordings). Is `vetted_at` recorded? Does the badge show to Candidates? |
| Q6 | Before confirmation, Candidates see only name initial, role, areas, preferences and verification flags. The prototype also shows shared days and time, rides count, on-time rate, "member since", and ID / work-email / vehicle badges. Which of these ship? |
| Q7 | The women-only preference: does it mean collecting gender? How is it verified? |
| Q8 | Messages: retention (proposed 30 days after the ride), what happens on deletion, and whether messages are kept for safety reports. |
| Q9 | Safety reports: if the *reported* person deletes their account, clearing their reference stops staff from spotting a re-registration. Keep a hashed email for 12 months? Should blocks survive the blocker's deletion? |
| Q10 | D-15 is still proposed. Approve it, and confirm how it combines with the end-of-pilot plan. |
| Q11 | Minimum age for testers (proposed: 18+), for the store age rating and privacy policy. |
| Q12 | Retention values marked "proposed" in this file: approve or change. |
