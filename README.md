# merge

**Find your way together.**

Merge is an open-source commuter carpooling app, initially focused on East Bay → San Francisco trips across the Bay Bridge. It helps drivers and passengers discover overlapping routes, coordinate recurring rides, and use HOV opportunities when occupancy qualifies.

> **Status:** MVP prototype. Email sign-in and profiles work against Supabase when it's configured. Without it, the app runs as a click-through prototype on sample data. Route maps, matching, and bookings are planned but not implemented. Merge is a working name.

## MVP features

- Driver and passenger commute profiles with recurring schedules.
- Route discovery with a default maximum **5-minute driver detour** and **±15-minute departure flexibility**.
- Opt-in discovery of drivers and passengers, using privacy-safe approximate locations.
- Quiet-ride, smoke-free, and women-only ride preferences (subject to policy and safety review).
- Vehicle profiles, seats, and cargo compatibility including medium foldable scooters.
- Invitations, confirmations, and reserved seats/cargo.

## Tech stack

- Expo + React Native + TypeScript
- Supabase Auth with email codes, PostgreSQL, PostGIS, Row Level Security
- Routing API (to be selected)

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

After pushing schema changes with `npm run db:push`, run `npm run db:types` to regenerate `apps/mobile/src/lib/database.types.ts`. It reads the linked (hosted) schema, so it won't include migrations you haven't pushed.

In migrations, schema-qualify extension objects (for example `extensions.geography`), because the Supabase CLI applies migrations as a role whose `search_path` is only `"$user", public`.

### Checks

```bash
npm run typecheck
npm test
npm run db:test
```

`db:test` runs the migrations and `supabase/tests/` in a throwaway PostGIS container, so it needs Docker.

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
4. Invitations and seat/cargo reservations
5. Closed pilot after safety, insurance, and regulatory review

See [MVP scope](docs/mvp.md) and [contributing guidelines](CONTRIBUTING.md).

## Safety and privacy

Exact home/work coordinates and personal movement data must not be publicly exposed. Route discovery must be opt-in, server-filtered, and based on generalized map markers. Production use requires verification of insurance, HOV requirements, privacy protections, and applicable transportation regulations.

## License

See the existing [LICENSE](LICENSE) file.
