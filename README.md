# merge.

**Find your way together.**

Merge is an open-source commuter carpooling app, initially focused on East Bay → San Francisco trips across the Bay Bridge. It helps drivers and passengers discover overlapping routes, coordinate recurring rides, and use HOV opportunities when occupancy qualifies.

> **Status:** MVP scaffold. The app currently displays a starter screen. Authentication, route maps, matching, and bookings are planned but not implemented. Merge is a working name.

## MVP features

- Driver and passenger commute profiles with recurring schedules.
- Route discovery with a default maximum **5-minute driver detour** and **±15-minute departure flexibility**.
- Opt-in discovery of drivers and passengers, using privacy-safe approximate locations.
- Quiet-ride, smoke-free, and women-only ride preferences (subject to policy and safety review).
- Vehicle profiles, seats, and cargo compatibility including medium foldable scooters.
- Invitations, confirmations, and reserved seats/cargo.

## Tech stack

- Expo + React Native + TypeScript
- Supabase Auth, PostgreSQL, PostGIS, Row Level Security (planned backend)
- Routing API (to be selected)

## Getting started

Requires Node.js 20+ and npm.

```bash
npm install
cp apps/mobile/.env.example apps/mobile/.env
npm run start
```

The starter screen works without a configured Supabase project. Later, add `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` to the mobile app's local environment file. **Never put a service-role key in the app.**

Run `npm run typecheck` for the initial TypeScript check.

## Structure

```text
apps/mobile/           Expo mobile app
supabase/migrations/   Initial database model and RLS (default deny)
docs/mvp.md            MVP product requirements
.github/               CI and PR template
CONTRIBUTING.md        Contribution guidelines
```

## Roadmap

1. Starter app and repo setup
2. Authentication and saved commutes
3. Privacy-safe map discovery and matching
4. Invitations and seat/cargo reservations
5. Closed pilot after safety, insurance, and regulatory review

See [MVP scope](docs/mvp.md) and [contributing guidelines](CONTRIBUTING.md).

## Safety and privacy

Exact home/work coordinates and personal movement data must not be publicly exposed. Route discovery must be opt-in, server-filtered, and based on generalized map markers. Production use requires verification of insurance, HOV requirements, privacy protections, and applicable transportation regulations.

## License

See the existing [LICENSE](LICENSE) file.
