# merge

**Find your way together.**

Merge is an open-source commuter carpooling app, initially focused on East Bay → San Francisco trips across the Bay Bridge. It helps drivers and passengers discover overlapping routes, start with one ride and keep commuting together only if you both want to, and use HOV opportunities when occupancy qualifies.

> **Status:** MVP prototype. Email sign-in and profiles work against Supabase when it's configured. Without it, the app runs as a click-through prototype on sample data. Route maps, matching, and bookings are planned but not implemented. Merge is a working name.

## MVP features

- Driver and passenger commute profiles with recurring schedules.
- Route discovery with a default maximum **5-minute driver detour** and **±15-minute departure flexibility**.
- Opt-in discovery of drivers and passengers, using privacy-safe approximate locations. Discovery is off until you turn it on.
- Quiet-ride and smoke-free ride preferences. They rank matches but never hide one.
- Vehicle profiles, seats, and cargo compatibility including medium foldable scooters.
- Invitations, confirmations, and reserved seats/cargo.
- **First Ride:** every new match starts with one confirmed ride on one date, with no recurring commitment.
- **Ride Again:** after private post-ride feedback, two people who both want to ride again can invite each other, one ride at a time.
- **Commute Crew:** if both said yes, either can propose shared days. Each Crew ride is still a separate invitation, and either person can pause or end the Crew anytime.
- Ride messages after a ride is confirmed, and mutual contact sharing: neither person sees the other's details until both have offered.

## Tech stack

- Expo + React Native + TypeScript
- Supabase Auth, PostgreSQL, PostGIS, Row Level Security (planned backend)
- MapLibre with Stadia Maps tiles. There's no geocoding or routing provider in the pilot; detour is estimated in PostGIS. See the [map provider research](docs/research/2026-10-08-m01-map-provider.md).

## Getting started

Requires Node.js 20+ and npm.

```bash
npm install
cp apps/mobile/.env.example apps/mobile/.env
npm run start
```

With the Supabase values in `apps/mobile/.env` left empty, the app runs as a click-through prototype with sample data and no sign-in.

### Connecting Supabase

1. `npx supabase login`
2. `npm run db:link` (asks for the project's database password)
3. `npm run db:push` to apply `supabase/migrations/`
4. Copy the Project URL and `anon` public key (Project Settings → API) into `apps/mobile/.env` as `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`. **Never put a service-role key in the app.**
5. In the Supabase dashboard:
   - Authentication → Providers → Email: enabled, with "Confirm email" on. Email OTP Expiration: 600 seconds.
   - Authentication → Email Templates → Magic Link: include `{{ .Token }}` in the body so the email contains a 6-digit code.

After changing the schema, don't regenerate `apps/mobile/src/lib/database.types.ts` by hand. CI generates it from `supabase/migrations/`, and [CONTRIBUTING.md](CONTRIBUTING.md) explains how to download and commit it. Use `npm run db:types` only to check the live hosted schema.

In migrations, schema-qualify extension objects (for example `extensions.geography`), because the Supabase CLI applies migrations as a role whose `search_path` is only `"$user", public`.

Supabase's built-in email sender only delivers to members of your Supabase team, and only a few emails an hour. Testers outside the team need a custom SMTP provider.

### Checks

```bash
npm run typecheck
npm test
npm run lint
```

`npm run db:test` runs the migrations and `supabase/tests/` in a throwaway PostGIS container. It needs Docker, so it's optional locally; CI runs it on every pull request, along with the generated-types and migration-order checks. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full list of checks and for how a database change updates the types.

## Structure

```text
apps/mobile/           Expo mobile app
supabase/migrations/   Database model and RLS (default deny)
supabase/tests/        SQL tests for RLS and database rules
scripts/               Database test runner
docs/mvp.md            MVP product requirements
.github/               CI and PR template
CONTRIBUTING.md        Contribution guidelines
```

## Roadmap

1. Starter app and repo setup
2. Authentication and saved commutes
3. Privacy-safe map discovery and matching
4. First Ride requests for one date, with seat/cargo reservations, then Ride Again and Commute Crew
5. Closed pilot after safety, insurance, and regulatory review

See [MVP scope](docs/mvp.md) and [contributing guidelines](CONTRIBUTING.md).

## Safety and privacy

Exact home/work coordinates and personal movement data must not be publicly exposed. Route discovery must be opt-in, server-filtered, and based on generalized map markers. Others never see your location, during a ride or otherwise: ride mode uses location on the device only, during a ride the driver starts, and the server receives only "arrived" and a timestamp. Production use requires verification of insurance, HOV requirements, privacy protections, and applicable transportation regulations.

## License

See the existing [LICENSE](LICENSE) file.
