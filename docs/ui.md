# Merge UI prototype

The mobile app in `apps/mobile` is a clickable UI prototype of the v0.1 flows. When Supabase is configured, sign-in and the profile are real. Everything after that (commute, matches, requests, bookings) uses sample data only (`src/data/mock.ts`), and nothing else is saved.

## Flows

**Sign-in (when Supabase is configured):** Welcome + role → Sign in (email) → Enter code (6 digits, resend after 60 s) → Your name (new accounts only) → Where and when. Returning users open straight to Discover. The account button on Discover shows the signed-in email and Sign out. Without Supabase values in `.env`, sign-in is skipped and the prototype starts at Welcome as before.

**Passenger:** Welcome + role → Where and when → Preferences (optional) → Discover → Match detail → Request First Ride → Booked → Post-ride → Ride Again → Crew.

**Driver:** Trips tab → incoming request for one date ("Mon, Oct 12 · First Ride") → accept or decline → confirm seat and cargo, and set the exact pickup spot → upcoming trips.

The one-date request, Post-ride, Ride Again and Crew screens are still being built. Until they land, the prototype still shows the older recurring request, a "Suggest a change" button, a Women-only chip and discovery switched on by default. The pilot drops all four, per the rules below.

Sending a request in the prototype jumps straight to the booked state, so that screen can be reviewed without a real driver.

## Product rules reflected in the UI

- Pickup and drop-off are approximate areas (about 0.5 mi). Exact pickup instructions unlock only after both sides confirm.
- Discover shows generalized circles on the map and explains why each match fits (detour, departure window, shared days, cargo).
- Requesting is not booking. The driver accepts, then confirms seat and cargo in one step.
- Every request is a First Ride for one date, with no recurring commitment. A Commute Crew never creates rides on its own; each Crew ride is confirmed or skipped individually.
- There's no "Suggest a change" or "Move". The driver sets the exact pickup spot when confirming, inside the passenger's pickup area.
- The UI never reveals who said no, or whether a missing connection means "no" or "not answered". A declined request looks the same as an expired one.
- Post-ride feedback is private. "Decide later" records nothing, and "Report a safety concern" is separate from feedback.
- "Show me in discovery" is off until the person turns it on. Quiet and smoke-free preferences rank matches but never hide one, and there's no women-only option.
- Contact sharing is mutual: neither person sees the other's details until both have offered.
- Trust signals sit at the top of match detail: rides, member since, and one badge for vetted drivers, "License & insurance checked by Merge". There are no ID, work-email or vehicle verification rows. An on-time rate is pending an open decision (D-03) and doesn't ship yet.
- There's no live tracking: others never see your location, during a ride or otherwise. In ride mode, location is used on the device only, during a ride the driver starts, and the server receives only "arrived" and a timestamp.
- There are no payments or carpool lane guarantee in the pilot.

Values in `[brackets]` are open product decisions, such as reliability metrics. The reply and cancellation cutoffs and the cargo limits are decided (see `docs/mvp-backlog.md`, D-02 and D-04), so their brackets are being replaced with the decided values.

## Design tokens

All colors, spacing, radii and type sizes live in `apps/mobile/src/theme.ts` ("Chili spice" palette):

| Token | Hex | Use |
|---|---|---|
| `chili` | `#CD1C18` | Primary buttons, selected states, map pins |
| `ember` | `#9B1313` | Links, icons, destructive outlines |
| `maroon` | `#38000A` | Headers, dark controls |
| `peach` | `#FFA896` | Logo tile, celebratory accents |
| `blush` | `#FFE8E2` | Selected backgrounds, badges |
| `background` | `#F8F4F3` | Screen background |

Icons come from Ionicons, using filled variants through `src/components/Icon.tsx`.

## Not built yet

- The real map (MapLibre with Stadia Maps tiles) replacing the stylized `BayMap`
- React Navigation or Expo Router replacing the minimal stack in `src/navigation.tsx`
- The custom font (Plus Jakarta Sans via `expo-font`); the system font is used for now
- Time and area pickers, messaging, block and report flows, and verification
