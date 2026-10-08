# Engineering foundation

## Principles

1. Privacy and safety are release gates, not post-launch improvements.
2. Separate mobile UI, domain logic, data access, and privileged server operations as the product grows.
3. Use database constraints and transactions for seat/cargo capacity; never trust client-only checks.
4. Keep exact origin/destination and personal location data behind authenticated, least-privilege access.
5. Every feature PR should add automated tests for its domain behavior and failure cases.

## CI quality gates

GitHub Actions runs on pull requests and pushes to `main`:

- ESLint with Expo's recommended configuration.
- TypeScript strict-mode checks.
- Node test runner for foundation and subsequent domain tests.
- Expo dependency version compatibility check.
- Repository hygiene check for accidentally tracked environment files.

CI uses read-only GitHub permissions and cancels obsolete runs for the same ref. Dependabot proposes weekly npm and Actions dependency updates.

### Required follow-up before merge

- **Generate `package-lock.json`** using `npm install` in a networked environment and commit it. Switch CI installation to `npm ci` and enable npm caching. Until then installs are not reproducible.
- Verify CI runs green; adjust dependency versions with `npx expo install --fix` if the Expo check reports mismatches.
- In GitHub repository settings, protect `main`, require pull requests and the `quality` and `hygiene` checks, and disable force pushes. These settings are not automatically configured by this PR.
- Add a real Supabase migration test environment before enabling user-facing access. Current tests are structural checks, not database integration tests.
- Add integration tests for invitation authorization, race conditions, seat/cargo atomicity, blocks, and location disclosure before beta.

## Secrets

Use `.env` locally (ignored by git). Only Expo public keys belong in `EXPO_PUBLIC_*`. Server-side Supabase keys, routing credentials, and service-role keys must never be shipped in mobile bundles. Rotate leaked keys immediately.

## Branch strategy

Feature branches → PR → required CI checks → review → `main`. Use focused commits and small PRs. Do not deploy production builds directly from unreviewed branches.
