# Merge UI prototype

The mobile app in `apps/mobile` is a clickable UI prototype of the v0.1 flows. When Supabase is configured, sign-in and the profile are real. Everything after that (commute, matches, requests, bookings) uses sample data only (`src/data/mock.ts`), and nothing else is saved.

## Flows

**Sign-in (when Supabase is configured):** Welcome + role → Sign in (email) → Enter code (6 digits, resend after 60 s) → Your name (new accounts only) → Where and when. Returning users open straight to Discover. The account button on Discover shows the signed-in email and Sign out. Without Supabase values in `.env`, sign-in is skipped and the prototype starts at Welcome as before.

**Passenger:** Welcome + role → Where and when → Preferences (optional) → Discover → Match detail → Request a ride → Booked.

**Driver:** Trips tab → incoming request → accept, suggest a change or decline → confirm seat and cargo → upcoming trips.

Sending a request in the prototype jumps straight to the booked state, so that screen can be reviewed without a real driver.

## Product rules reflected in the UI

- Pickup and drop-off are approximate areas (about 0.5 mi). Exact pickup instructions unlock only after both sides confirm.
- Discover shows generalized circles on the map and explains why each match fits (detour, departure window, shared days, cargo).
- Requesting is not booking. The driver accepts, then confirms seat and cargo in one step.
- Trust signals sit at the top of match detail: rides, on-time rate, member since, and ID / work email / vehicle verification.
- There's no live tracking, payments, or carpool lane guarantee in the pilot.

Values in `[brackets]` are open product decisions, such as reply and cancellation cutoffs, reliability metrics, and cargo size limits.

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

- The real map (react-native-maps or Mapbox) replacing the stylized `BayMap`
- React Navigation or Expo Router replacing the minimal stack in `src/navigation.tsx`
- The custom font (Plus Jakarta Sans via `expo-font`); the system font is used for now
- Time and area pickers, messaging, block and report flows, and verification
