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
- Supabase Auth with email codes, PostgreSQL, PostGIS, Row Level Security
- MapLibre with Stadia Maps tiles. There's no geocoding or routing provider in the pilot; detour is estimated in PostGIS. See the [map provider research](docs/research/2026-10-08-m01-map-provider.md).

## Getting started

Requires Node.js 22+ and npm.

```bash
npm install
cp apps/mobile/.env.example apps/mobile/.env
npm run start
```

With the Supabase values in `apps/mobile/.env` left empty, the app runs as a click-through prototype with sample data and no sign-in.

### Connecting Supabase

1. `npx supabase login`
2. `npm run db:link` (asks for the project's database password). The script is hard-wired to the project owner's ref. If you use your own Supabase project, run `npx supabase link --project-ref <your-ref>` instead (the ref is the ID in your project's dashboard URL).
3. `npm run db:push` to apply `supabase/migrations/`
4. Copy the Project URL and the publishable key (`sb_publishable_…`) into `apps/mobile/.env` as `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`. The variable keeps its `ANON_KEY` name, but it takes the publishable key or a legacy `anon` key. The project's Connect dialog shows both values, and the keys are also listed under Project Settings → API Keys. Expo reads `apps/mobile/.env`, not a `.env` in the repo root. **Use only the publishable or `anon` key. Never put a secret key (`sb_secret_…`) or the `service_role` key in the app.**
5. In the Supabase dashboard:
   - Authentication → Sign In / Providers → Auth Providers → Email: enabled, with "Confirm email" on. Email OTP Expiration: 600 seconds. Email OTP Length: 6 (the app only accepts 6-digit codes, so check this value).
   - Authentication → Emails → SMTP Settings: turn on custom SMTP before you edit the templates. On the free plan, projects created since June 2026 can't edit email templates while they use Supabase's built-in sender. That sender also only delivers to members of your Supabase team, and only a couple of emails an hour, so testers outside the team need custom SMTP anyway. Resend example: host `smtp.resend.com`, port `465`, username `resend`, password = a Resend API key with sending access. Enter the key in the dashboard only, and never commit it or put it in `.env`. Until you verify a domain in Resend, its `onboarding@resend.dev` sender delivers only to your own Resend account's email.
   - Authentication → Emails → Templates: put `{{ .Token }}` in the body of both the **Confirm sign up** and **Magic link or OTP** templates, and drop the link, so every email contains a 6-digit code. With "Confirm email" on, a brand-new user's first sign-in sends Confirm sign up, and returning users get Magic link or OTP. For example: `<p>Your Merge code is {{ .Token }}</p>`

After changing the schema, don't regenerate `apps/mobile/src/lib/database.types.ts` by hand. CI generates it from `supabase/migrations/`, and [CONTRIBUTING.md](CONTRIBUTING.md) explains how to download and commit it. Use `npm run db:types` only to check the live hosted schema.

In migrations, schema-qualify extension objects (for example `extensions.geography`), because the Supabase CLI applies migrations as a role whose `search_path` is only `"$user", public`.

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
