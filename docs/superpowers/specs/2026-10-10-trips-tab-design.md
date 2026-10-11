# Role-aware Trips tab — design (M-23)

**Date:** 2026-10-10
**Task:** M-23
**Status:** Draft for owner review. Ten owner questions are at the end, each with a
recommendation. Nothing is built yet.
**Scope (prototype, mock data):** `src/screens/TripsScreen.tsx` (new),
`src/screens/DriverRequestsScreen.tsx`, `src/components/TabBar.tsx`,
`src/navigation.tsx` and `App.tsx` (a new `trips` route), `src/data/mockTrips.ts`
(new), plus `src/lib/trips.ts` and `src/lib/trips.test.ts` (new, see owner
question 3). All paths are under `apps/mobile/`.
**Builds on:** M-13's one-date requests (`rideDate` + `kind`, `rideKind.ts`), M-08's
date helpers (`dates.ts`, D-02 cutoffs), M-10's safe areas, and M-19's data layer
(`src/lib/data/`, `QueryState`, the 9-step wiring checklist).
**Decisions it relies on (all Decided):** D-01 (completion and post-ride timing),
D-02 (8 PM reply cutoff, 9 PM cancel cutoff, America/Los_Angeles), D-07 (the other
rider sees only "Ride cancelled" after a removal), D-13 (no push for any "no"),
D-16 (driver invites kept; a decline reads like an expiry), D-22 (a decline stays
pending until the reply cutoff, then reads exactly like an expiry).

## Problem

The Trips tab always opens the driver inbox (`TabBar.tsx:12`), whose header says
"Driving · N of M seats open" whatever the person's role, and whose badge is
hard-coded to 2. A passenger has nowhere to see the requests they sent, the invites
drivers sent them, or their upcoming and past rides: Booked is reachable only in the
instant after "Send request". The driver's Upcoming tab is built from two hard-coded
dates (`MON`, `TUE` in `DriverRequestsScreen.tsx`), an unnamed phantom rider on Tue,
and seat math that subtracts that phantom (`seatsOffered - 1`). The default
prototype role is `both`, so most walkthroughs hit all of this.

## Goals

- One Trips screen for every role. A passenger sees what they sent, what they were
  invited to, what's booked and what happened. A driver keeps today's inbox and
  upcoming days. `both` sees both, without flipping a switch to find out whether
  anything needs a reply.
- The privacy invariants hold in the UI types themselves: no request or invite state
  can render as "declined", nothing before confirmation carries an exact spot, and
  cancellations read the same whatever the cause.
- Each later wiring task (M-35, M-36, M-47) swaps one data hook for its
  `src/lib/data/<feature>.ts` hook and touches only the files the backlog already
  gives it. In particular M-36, which may not edit `TripsScreen.tsx`, never needs to.

## Approaches considered

**A. Route the tab by role.** Drivers keep `DriverRequestsScreen`, passengers get a
new `TripsScreen`, and `both` gets `TripsScreen` with a row linking into the inbox.
Smallest change, but "Trips" becomes two different screens, `both` needs an extra
hop to reply, and Upcoming is split across two places.

**B. One screen, role switch on top.** `both` gets a "Driving | Riding" switch, each
side with its own sub-tabs (New/Upcoming and Requests/Upcoming/Past). Two stacked
segmented controls, and a `both` member has to flip sides to see whether someone
is waiting on them.

**C. One screen, time-based segments, role-filtered sections (recommended).** Every
role sees the same three segments: **Requests**, **Upcoming**, **Past**. Inside each,
sections appear for the sides that apply ("Asking you for a ride", "Invites for
you", "Waiting for a reply"; "Driving", "Riding"). The driver sections stay in
`DriverRequestsScreen.tsx` as exported components, so the backlog's file ownership
(M-36: "the New tab and header", M-47: "the Upcoming tab") still lines up with what
each task changes. The badge, the Requests count and the empty states are computed
once, from every section.

C is the only option where a `both` member sees everything that needs a reply in one
place, and where M-36 can wire the inbox without editing `TripsScreen.tsx`.

## Design

### Screen structure

```
┌──────────────────────────────────────────┐
│ Trips              [car] Driving Mon ·   │  header; the pill shows only when
│                    1 of 2 seats open     │  the role drives (from DriverRequestsScreen.tsx)
│ ( Requests · 2 | Upcoming | Past )       │  Segmented
├──────────────────────────────────────────┤
│ ASKING YOU FOR A RIDE          (driving) │  DriverRequestsSection   (M-36 wires)
│ INVITES FOR YOU                (riding)  │  TripsScreen             (M-35 wires)
│ WAITING FOR A REPLY            (both)    │  TripsScreen             (M-35 wires)
├──────────────────────────────────────────┤
│ Discover      Trips (2)      Profile     │  TabBar
└──────────────────────────────────────────┘
```

| Segment | Sections, in order | Owner of the section's code |
| --- | --- | --- |
| **Requests · N** | 1. **Asking you for a ride**: passengers' requests to me as driver. 2. **Invites for you**: drivers' invites to me as passenger. 3. **Waiting for a reply**: my requests as passenger, my invites as driver, and invites I accepted that wait for the driver to confirm the seat. | 1: `DriverRequestsScreen.tsx`. 2, 3: `TripsScreen.tsx` |
| **Upcoming** | 1. **Driving**: my driving days by date, each with its riders. 2. **Riding**: my booked rides as passenger, plus cancelled ones until their date passes. | 1: `DriverRequestsScreen.tsx`. 2: `TripsScreen.tsx` |
| **Past** | One list, newest first, of rides I drove or rode: completed or cancelled. | `TripsScreen.tsx` |

N is the number of items that need **my** reply (owner question 5), and is shown only
when it is above zero.

**Section visibility.** A section renders when it is loading, has an error, or has at
least one item. Role does not hide a non-empty section: in connected mode, someone
who switched from `both` to `passenger` with a confirmed driving day still sees it.
Role decides only three things: which prototype fixtures are seeded, which empty-state
copy shows, and whether the seats pill shows. Section headings always render (as
accessibility headers), even for single-role members, so the structure is the same
for everyone.

**Default segment.** Opening Trips from the tab bar lands on **Requests** when N > 0,
otherwise on **Upcoming** (owner question 8). An explicit `tab` route param wins.

### What each role sees

**Driver** (`role: 'driver'`)

- Requests: "Asking you for a ride" with today's request cards (name, verified flag,
  `rideDateLine`, added detour, pickup time, seats and cargo). The "Reply by [time]"
  badge becomes the decided cutoff: "Reply by Sun 8:00 PM" (D-02), from
  `replyByLabel` in `lib/trips.ts`. Tapping a card opens `driverRequest` as today.
  Under it, the existing note ("Requests expire if you don't reply. Riders only see
  your approximate area until you accept."). Then "Waiting for a reply" with invites
  I sent as a driver.
- Upcoming: "Driving", one card per driving day, sorted by date: date eyebrow,
  "Leave 7:35 AM", each rider (initials, name, pickup time, spot), and the existing
  inert "Message riders" (M-50) and "Can't drive" (M-47) buttons. Every day uses the
  same card, so the dead Tue row with a chevron and no `onPress` goes away. The
  "{first} booked. Pickup details were shared." banner after a confirm stays.
- Past: rides I drove, and any I rode before switching role.

**Passenger** (`role: 'passenger'`)

- Requests:
  - "Invites for you": card per pending driver invite: avatar, "{Name} invited you to
    ride", `rideDateLine`, pickup area label and time, "Reply by Wed 8:00 PM", and two
    buttons, **Accept** and **Decline**. Accept turns it into an accepted invite under
    "Waiting for a reply" ("You accepted. {first} confirms your seat and sets the
    pickup spot."). Decline asks first (see [Confirmations](#confirmations)), then
    removes it.
  - "Waiting for a reply": one row per item I'm waiting on.
    - Pending request: "Request to {Name}", `rideDateLine`, "Waiting for {first} ·
      reply by Mon 8:00 PM", and **Withdraw request** (confirmation, then removed).
    - Unavailable request: the same row with exactly "This ride isn't available
      anymore" and a **Find another ride** button to Discover. There is no
      "Declined" state anywhere (see [Privacy](#privacy-and-safety)).
    - Accepted invite: "{Name}'s invite · accepted", "{first} confirms your seat and
      sets the pickup spot", no action.
- Upcoming: "Riding", one row per booked ride: avatar, "{Name} · {rideDateLine}",
  "Pickup {time}", chevron, opening `booked` with the match id. A cancelled ride
  shows "Ride cancelled" and **Find another ride**, and isn't tappable.
- Past: rides I rode, display-only in this task (M-47 adds the actions).

**Both** (`role: 'both'`, the prototype default): every section above, in the order
in the table. Driving and riding stay in separate sections rather than one merged
timeline, because their code has different owners; each is sorted by date.

### Replacing and absorbing `DriverRequestsScreen`

The file keeps its name (the screen lock table keys on it) but stops being a
full screen. It exports the driving side of Trips:

| Export | What it is | Wired later by |
| --- | --- | --- |
| `useDrivingRequests(): QueryState<IncomingRequest[]>` | prototype: `REQUESTS` minus `commute.acceptedRequests` | M-36 (`inbox.ts`) |
| `useDrivingDays(): QueryState<DrivingDay[]>` | prototype: driving-day fixtures plus accepted requests, merged by `drivingDays()` | M-47 (`rides.ts`) |
| `DrivingSeatsPill` | the header pill, now "Driving Mon · 1 of 2 seats open" for the next driving day, computed by `seatsOpenOn()` with no phantom rider | M-36 (real capacity per date) |
| `DriverRequestsSection({ state })` | the old New tab: request cards plus the footer note | M-36 |
| `DriverUpcomingSection({ state })` | the old Upcoming tab: day cards | M-47 |

`TripsScreen` calls the two hooks, passes each `QueryState` to its section, and uses
the same states for N, the badge-equivalent count and the empty states. The hook
return types are fixed now (owner question 3 covers where the item types live), so
M-36 and M-47 change hook bodies and section internals only.

M-13's `MON` and `TUE` constants and the per-date filter go. Driving days come from
`DRIVING_DAYS` in `mockTrips.ts`; `drivingDays(base, accepted)` puts each accepted
request under its own date, creating a day if the driver had none, and never lists
a request under two dates.

**Routes.**

- Append `| { name: 'trips'; tab?: 'requests' | 'upcoming' | 'past' }` to the
  `Route` union, `case 'trips'` to `renderRoute`, and the `TripsScreen` import to the
  end of App.tsx's import block.
- Keep `driverRequests` in the union, because `DriverConfirmScreen` (M-43's) resets to
  `{ name: 'driverRequests', tab: 'upcoming' }` after a confirm. Its `renderRoute` case
  becomes an alias: `<TripsScreen key={route.tab ?? 'auto'} initialTab={route.tab ===
  'upcoming' ? 'upcoming' : 'requests'} />`. Its params don't change. The
  `DriverRequestsScreen` import in App.tsx goes, since nothing renders it (owner
  question 2).
- `TripsScreen` is keyed on its `tab` param so a reset with a different tab remounts
  it, as `driverRequests` does today.

### Tab bar

- Trips opens `{ name: 'trips' }` (the default segment rule picks the tab).
- The badge is `needsReplyCount(...)` from `lib/trips.ts` over the prototype sources:
  incoming requests not yet accepted (`REQUESTS` minus `commute.acceptedRequests`)
  plus pending invites for me (the session store below), seeded by role. It hides at
  zero. In TabBar this is one small hook, `useTripsBadgeCount()`, defined in
  `TabBar.tsx` itself so TabBar never imports a screen file (TripsScreen renders
  TabBar, so the reverse import would be a cycle).
- Accessibility label: "Trips", "Trips, 1 needs your reply", "Trips, 2 need your
  reply" (`tripsTabLabel(count)`), replacing "Trips, 2 new".
- The `TABS` array keeps its shape and the Profile row is untouched, so M-30's
  one-line Profile change and M-36's badge change rebase cleanly.

### Prototype session state

Withdraw, Accept and Decline must survive a tab switch (`nav.reset` unmounts the
screen), and the tab bar must see them. `state/commute.tsx` is a serialized zone this
task isn't in, and the app-root provider zone excludes it too, so there's no new
provider. Instead:

- `createTripsSession(seed)` in `lib/trips.ts`: a pure store with `getSnapshot()`,
  `subscribe(listener)`, `withdraw(id)`, `acceptInvite(id)` and `declineInvite(id)`.
  Snapshots are immutable and keep the same reference until something changes (what
  `useSyncExternalStore` requires). Unknown ids are a no-op.
- `mockTripsSession` in `mockTrips.ts`: the one prototype instance, seeded from the
  fixtures. It resets on reload, like every other prototype state.
- `TripsScreen` and `TabBar` read it with React's `useSyncExternalStore`, which
  `lib/data/hooks.ts` already uses.
- The driver side keeps using `commute.acceptedRequests`, which `DriverConfirmScreen`
  writes.

This store is a stopgap: M-35 and M-47 replace its readers with data-layer mock
backends seeded from the same read-only fixture arrays (checklist step 9), after
which nothing reads it.

### Confirmations

Withdraw (request or invite) and Decline use an **inline confirmation** in the row,
not `Alert.alert`, which is a no-op for multi-button alerts on the web build:

- The action buttons are replaced by one sentence and two buttons, for example
  "Withdraw your request to Marcus for Wed, Oct 14?" with **Keep request** and
  **Withdraw** (destructive). For Decline: "Decline Lena's invite for Thu, Oct 15?
  Lena sees it the same way as an invite nobody answered." with **Keep invite** and
  **Decline**.
- The confirmation is an `accessibilityLiveRegion="polite"` region, and on confirm the
  app announces "Request withdrawn" or "Invite declined"
  (`AccessibilityInfo.announceForAccessibility`).
- Only one row can be confirming at a time; opening another cancels the first.

### Empty states

Shown per segment when every section in it is empty (and none is loading or failed).
Copy never says or implies that someone said no.

| Segment | Driver | Passenger | Both |
| --- | --- | --- | --- |
| Requests | "No requests right now. When someone asks to ride with you, it shows up here." | "Nothing waiting. Find a driver going your way and request a First Ride." **Find a ride** | "Nothing waiting. Requests you send and receive show up here." **Open Discover** |
| Upcoming | "No rides booked yet. Riders you confirm show up here by date." | "No rides booked yet." **Find a ride** | "No rides booked yet. Rides you drive and ride show up here by date." |
| Past | "Your past rides show up here after each ride." (all roles) | | |

The buttons reset to `discover`. An unavailable request isn't "empty": it shows,
with its own **Find another ride** button.

### Loading and errors

The sections take `QueryState` (M-19's `src/lib/data/types.ts`) from day one. The
prototype hooks wrap fixtures with `fromItems(items)`, which gives `empty` or
`success`, so the prototype never shows loading or errors. The rules, so wiring tasks
add no layout:

- `idle` / `loading`: a quiet one-line placeholder in that section, no spinner.
- `error`: `error.message` (never a raw server message) with **Retry** calling
  `refetch`. The segment's empty state doesn't show while any section has failed.
- A failed section doesn't add to N or the badge.

### Prototype data: `src/data/mockTrips.ts`

Fictional people in "First L." form and generalized area labels only. Nothing
before confirmation carries a spot field: the pre-confirmation types have
`pickupArea` and no `spot`, so a spot can't be added to a fixture by accident.
Driving-day riders (confirmed) keep today's "[Pickup spot]" placeholder. Fixtures
are read-only arrays; the session store copies them.

**Prototype clock.** `MOCK_TRIPS_TODAY = '2026-10-10'` (Sat) and
`MOCK_TRIPS_NOW_MINUTES = 14 * 60` (2:00 PM LA), consistent with
`PROTOTYPE_RIDE_DATE = '2026-10-12'`, so screenshots are stable and every pending
item is still before its cutoff (owner question 9). `dates.ts` stays clock-free.

| Fixture | Side | Contents |
| --- | --- | --- |
| incoming requests | driving | `REQUESTS` from `mock.ts`, unchanged (Jordan T. Mon Oct 12, Alex K. Tue Oct 13) |
| `DRIVING_DAYS` | driving | Mon Oct 12: leave 7:35 AM, Sam R. 7:38 AM. Tue Oct 13: leave 7:35 AM, Morgan D. 7:40 AM (names the old phantom rider) |
| `SENT_INVITES` | driving | to Riley P., Tue Oct 13, "Lincoln Park area, Alameda", 7:45 AM, pending |
| `RECEIVED_INVITES` | riding | from Lena M., Thu Oct 15, First Ride, "Park St area, Alameda", 7:40 AM, pending |
| `SENT_REQUESTS` | riding | to Marcus L. (match `marcus`), Wed Oct 14, pending; to Dana W., Thu Oct 15, unavailable (for example Dana's seats filled for that date, D-02; the UI type can't say why) |
| `RIDING_RIDES` | riding | Kai O., Fri Oct 16, cancelled. Plus, at runtime, the session booking from `commute.bookedMatchId` on `PROTOTYPE_RIDE_DATE`, so the ride booked through Discover → Request → Booked shows under Upcoming and opens Booked again |
| `PAST_RIDES` | both | drove Taylor B. Thu Oct 8, completed; rode Avery J. Wed Oct 7, completed; rode Noor A. Tue Oct 6, cancelled |

Fixtures are seeded by side: `role: 'driver'` gets the driving rows and the past rides
where I drove, `passenger` the riding rows and past rides where I rode, `both`
everything. Riding fixtures sit on Wed–Fri so a `both` member isn't driving and
riding on the same date. (The prototype's own request flow books Mon, a driving day;
that comes from `mock.ts`, which this task doesn't change.)

### Pure logic: `src/lib/trips.ts`

No react-native, expo, `src/state/*` or `src/lib/supabase.ts` imports; types from
`lib/data/types.ts`, `state/commute.tsx` (`Role`) and `data/mock.ts` are
`import type` only.

- **UI types.** `TripPerson` (`name`, `initials`, `verified`), `IncomingRequest`
  (the fields the request card shows; no spot), `SentItem` (`id`, `direction:
  'request' | 'invite'`, `person`, `rideDate`, `kind`, `pickupArea`, `pickupTime`,
  `status: SentStatus`), `SentStatus = 'pending' | 'unavailable' | 'accepted'`,
  `ReceivedInvite` (`status: 'pending'`), `DrivingDay` (`date`, `leaveTime`,
  `riders[]`), `RidingRide` and `PastRide` (`role: 'drove' | 'rode'`, `status:
  'confirmed' | 'completed' | 'cancelled'`), `TripsSegment`.
- `sidesFor(role)` → `{ driving, riding }`.
- `showSection(state)`: loading, error, or non-empty.
- `needsReplyCount({ incoming, invites })`: pending incoming requests plus pending
  invites for me, counting only `success` states.
- `tripsTabLabel(count)` and `segmentLabel(count)` ("Requests · 2", or "Requests").
- `defaultSegment(count, param?)`.
- `replyByLabel(rideDate, 'short' | 'long')`: the evening before at
  `REPLY_CUTOFF_MINUTES`, built only from `addDays`, `formatRideDate` and
  `formatTime` ("Sun 8:00 PM", "Sun, Oct 11, 8:00 PM").
- `sentStatusCopy(item)`: the only place request-state copy lives.
- `visibleSent(items, today)`: drops rows whose ride date is before today. It never
  derives a status from the clock: whether a request is pending or unavailable is the
  server's answer (D-22, M-27), and the app renders it as given.
- `drivingDays(base, accepted)` and `seatsOpenOn(day, seatsOffered)` (never below 0).
- `splitRides(rides, today)`: confirmed or cancelled with a date on or after today →
  Upcoming (ascending); completed, or any date before today → Past (descending).
- `withSessionBooking(rides, bookedMatchId, rideDate)`: adds the prototype booking
  once.
- `fromItems(items)` → `QueryState`.
- `createTripsSession(seed)`: the store above.
- Accessibility label builders: `sentItemLabel`, `inviteLabel`, `rideLabel`.

## How later wiring plugs in (M-19's data layer)

Each wiring task follows the 9-step checklist in
`2026-10-10-data-layer-design.md`. The seams this design leaves:

| Task | Adds | Replaces | Files it already owns |
| --- | --- | --- | --- |
| **M-35** | `lib/data/invitations.ts` (+ `.api/.map/.mock/.supabase/.test`): `useSentInvitations()`, `useInvitesForMe()`, `useInvitationActions()` (`withdraw`, `accept`, `decline`) | TripsScreen's prototype hooks for "Invites for you" and "Waiting for a reply"; the session store's `withdraw`/`acceptInvite`/`declineInvite` | `TripsScreen.tsx` (sent-requests and invites sections) |
| **M-36** | `lib/data/inbox.ts`: `useInboxRequests()` | `useDrivingRequests()` body, `DrivingSeatsPill` math, `DriverRequestsSection` internals (blocked filter, "Accepted, confirm seat" rows), the TabBar badge source | `DriverRequestsScreen.tsx`, `TabBar.tsx` (badge only) |
| **M-47** | `lib/data/rides.ts` (after M-43): `useMyRides()` | `useDrivingDays()` body and `DriverUpcomingSection` (Can't drive); TripsScreen's Riding and Past hooks; adds post-ride entry, "This ride didn't happen", Ride Again and the Block/Report menu to Past rows | `DriverRequestsScreen.tsx` (Upcoming), `TripsScreen.tsx` (upcoming and past) |

What they keep:

- **Hook return types.** Each hook returns `QueryState<T>` of the `lib/trips.ts`
  types. A data-layer `x.api.ts` reuses those types with `import type` rather than
  defining parallel ones; mappers turn rows into them.
- **No "declined" value.** M-35's mapper maps every server status to `pending`,
  `unavailable` or `accepted`. Declined, expired, withdrawn-by-the-other-side and a
  driver who became full all become `unavailable`, at the time the server says (D-22).
- **The badge sums both sides.** M-36's live badge is inbox pending + "Accepted,
  confirm seat" + M-35's pending invites for me (`needsReplyCount`). M-36's card names
  only the first two; owner question 5 covers the backlog note.
- **Mock never in connected mode.** Once a section is wired, its hook reads through
  `defineBackends`, so fixtures show only in prototype mode. The data-layer mock
  backends seed from `mockTrips.ts`'s read-only arrays with `findById`.
- **Real clock.** Connected mode needs "today" and LA minutes from the device clock
  for `visibleSent` and `splitRides`; the first wiring task that needs it adds a small
  binding for that. `dates.ts` stays clock-free.

## Privacy and safety

- **No "no".** `SentStatus` has no declined member, so it can't render. Declined and
  expired requests and invites show exactly "This ride isn't available anymore". The
  decline confirmation tells the passenger the driver sees a decline like an
  unanswered invite. The badge never counts or announces a "no", and nothing changes
  when one happens except, at the cutoff, the neutral state (D-13, D-22).
- **Cancellations read alike.** A cancelled ride shows "Ride cancelled" whatever the
  cause: Can't drive, a rider's cancel, or a removal under D-07. Naming one cause
  ("{first} can't drive") would let the others be told apart, including a suspension
  (owner question 6).
- **No exact points before confirmation.** Requests, invites and their fixtures carry
  an area label and a time only. Driving-day riders and Booked are post-confirmation.
- **Blocked and suspended people.** In prototype mode there are none. In connected
  mode they never appear, because the server filters them (M-27, M-36's
  `useBlockedIds()`); the UI adds nothing that could reveal one.
- **Sample data in connected mode.** Until M-35, M-36 and M-47 land, Trips shows
  fixtures in connected mode too, like every other unwired screen today. No tester
  sees it before those tasks and M-54a's content gate.

## Accessibility

- Section titles are `accessibilityRole="header"`; the screen title stays a header.
- Each row is one accessible element with a composed label, for example "Request to
  Marcus L., Wed, Oct 14, First Ride. Waiting for Marcus, reply by Tue, Oct 13,
  8:00 PM." Buttons inside a row are separate focus stops with their own labels
  ("Withdraw request to Marcus L.").
- Status is always text, never color alone ("This ride isn't available anymore",
  "Ride cancelled", "Accepted").
- Touch targets are at least 44 pt, matching the existing 44-high small buttons.
- Inline confirmations are live regions, and completed actions are announced.
- The tab bar label carries the count ("Trips, 2 need your reply"); the Requests
  segment label does too ("Requests, 2 need your reply" as its accessibility label).
- No fixed heights on text, so larger text sizes wrap instead of clipping.
- Known gap left to M-51: `Segmented` (in `primitives.tsx`) exposes its options as
  buttons with `selected`, not as a tab list. M-51 owns shared components.

## Test plan (pure logic, `src/lib/trips.test.ts`)

`node:test` with `node:assert/strict` via `tsx`, importing only `lib/trips.ts`,
`lib/dates.ts` and `data/mockTrips.ts`.

| Area | Cases |
| --- | --- |
| Roles | `sidesFor` for `driver`, `passenger`, `both`; fixture seeding by side gives only that side's rows (and past rides by `drove`/`rode`) |
| Visibility | `showSection` true for loading, error, non-empty; false for empty and idle; a non-empty driving section shows for `passenger` |
| Counts | `needsReplyCount` counts pending incoming plus pending invites for me; ignores sent, accepted, unavailable and failed or loading sections |
| Labels | `tripsTabLabel(0/1/2)` → "Trips" / "Trips, 1 needs your reply" / "Trips, 2 need your reply"; `segmentLabel(0)` has no count |
| Default segment | count > 0 → `requests`; 0 → `upcoming`; an explicit param wins |
| Cutoffs | `replyByLabel('2026-10-12', 'short' \| 'long')` → "Sun 8:00 PM" / "Sun, Oct 11, 8:00 PM"; across a month boundary ('2026-11-02' → Sun, Nov 1); built from `REPLY_CUTOFF_MINUTES` |
| No "no" | for every `SentStatus`, `sentStatusCopy` never contains "declin", "reject" or "no longer interested"; `unavailable` is exactly "This ride isn't available anymore" |
| Sent rows | `visibleSent` drops rows dated before today, keeps today's, and returns the status it was given (it never turns `pending` into `unavailable` from the clock) |
| Driving days | accepted requests land under their own date only (the M-13 bug); a request on a date with no driving day creates one; days sorted; `seatsOpenOn` = offered − booked seats, floored at 0, with no phantom rider |
| Rides | `splitRides`: confirmed and cancelled today or later → Upcoming ascending; completed or earlier → Past descending; `withSessionBooking` adds the booking once and is a no-op without one |
| Session store | `withdraw` removes only that id; `acceptInvite` moves the invite to sent with `accepted`; `declineInvite` removes it; unknown ids are a no-op; listeners fire on change only; `getSnapshot` keeps its reference until a change; two stores don't share state |
| Fixture privacy | no pre-confirmation fixture has a key matching `/spot|lat|lng|coord|address/i`; every name matches "First L."; every date parses with `formatRideDate` |
| A11y labels | `sentItemLabel`, `inviteLabel` and `rideLabel` include name, date and status text |

Plus `npm run typecheck`, `npm test` and `npm run lint`, and a web walkthrough
(`npm run web`) with screenshots: each role (set on the Role screen) through all three
segments; withdraw, accept and decline with their confirmations; badge going 2 → 1 →
0; the driver path Trips → request → confirm landing on Upcoming with the rider under
the right date; Discover → Request → Booked, then Trips → Upcoming → Booked; every
empty state (passenger after withdrawing and declining everything). Check the console
for errors.

## Out of scope

- Supabase wiring of any section (M-35, M-36, M-47), push (M-38, M-45) and messages
  (M-50).
- Can't drive, Cancel ride, post-ride entry, "This ride didn't happen", Ride Again and
  the Block/Report menu on Past rows (M-47), and ride-in-progress (D-01, M-47).
- `BookedScreen.tsx` (M-20 in flight; its close button still resets to Discover even
  when opened from Trips, a follow-up for M-43 or M-47), `DriverRequestScreen.tsx`
  (M-24 in flight), `DriverConfirmScreen.tsx` (M-43), `RequestRideScreen.tsx` (its
  prototype auto-accept and the `rideDate` param are M-35's), `src/data/mock.ts`,
  `state/commute.tsx`.
- Crew rides as a separate list. A Crew ride is a dated invitation (First Ride spec),
  so it shows as an invite with `kind: 'crew'`; Crew screens are M-28 and M-48.
- Moving `driverRequests` callers to `trips`, and changes to `Segmented` or the
  theme's deprecated color names (M-51).
- Changes to `docs/mvp-backlog.md`, `docs/ui.md` (M-54a's zone) or approved specs.

## Owner questions

1. **Structure.** One Trips screen with Requests / Upcoming / Past for every role,
   role-filtered sections inside, and the driver sections kept in
   `DriverRequestsScreen.tsx` as exported components (approach C).
   *Recommended: approve.* It keeps every later task inside the files the backlog
   gives it.
2. **`driverRequests` becomes an alias.** Its `renderRoute` case renders
   `TripsScreen` (Requests or Upcoming from its `tab` param) and App.tsx stops
   importing `DriverRequestsScreen`. The route and its params stay, because
   `DriverConfirmScreen` resets to it. This edits one existing `renderRoute` case,
   beyond the card's "append a `trips` route".
   *Recommended: approve;* M-43 or M-54a can move callers to `trips` later.
3. **Two new files, and their zone.** Add `src/lib/trips.ts` and
   `src/lib/trips.test.ts` (pure logic and tests; not in the card's file list).
   Treat `lib/trips.ts` like the data-layer index: M-35, M-36 and M-47 may append
   types, fields and functions, keeping both sides on a rebase conflict.
   *Recommended: approve, and add both to the backlog's zone table.*
4. **Invites in this task.** Build "Invites for you" (Accept / Decline) and driver-sent
   invites under "Waiting for a reply" in the prototype now. The card mentions only
   requests sent, but M-35's card edits "the sent-requests and invites sections" of
   TripsScreen and D-16 keeps driver invites.
   *Recommended: yes.*
5. **What the badge counts.** Only items that need my reply: requests to me, invites
   to me, and (from M-36) accepted invites awaiting my seat confirmation. Not my own
   pending sends. M-36, the TabBar badge owner, sums its inbox count with M-35's
   invite count.
   *Recommended: yes, and note the sum on M-36's card.*
6. **Cancellation copy.** Trips says "Ride cancelled" for every cause, with no "{first}
   can't drive" attribution, so a D-07 removal can't be told apart from a Can't drive.
   (BookedScreen's existing "If {first} can't drive, you're notified right away" is a
   promise about notification, not attribution, and is M-47's to word.)
   *Recommended: neutral copy for every cause.*
7. **Unavailable requests.** They stay under "Waiting for a reply" until their ride date
   passes, with **Find another ride** and no dismiss; the app never works out a
   status from the clock.
   *Recommended: approve.*
8. **Default segment.** Requests when something needs my reply, otherwise Upcoming.
   *Recommended: approve.* The alternative, always Requests, is more predictable but
   opens on an empty list for most visits.
9. **Fixed prototype clock.** Sat Oct 10, 2026, 2:00 PM LA in `mockTrips.ts`, matching
   `PROTOTYPE_RIDE_DATE`.
   *Recommended: approve,* so fixtures don't age into the past and screenshots stay
   stable.
10. **One PR.** Spec, plan and code ship together as "M-23: Role-aware Trips tab" on
    this branch.
    *Recommended: yes,* per the card's default.
