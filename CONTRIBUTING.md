# Contributing to Merge

Thanks for helping improve commuter coordination.

1. Open an issue describing a bug or scoped feature before large changes.
2. Fork the repository and create a focused branch.
3. Run `npm ci` to install exactly what `package-lock.json` pins. Use `npm install <pkg>` only when you add or change a dependency, and commit the updated lockfile with it.
4. Run the checks below before opening a pull request.
5. Explain what changed, how it was tested, and any privacy/safety implications. The pull request template has the checklist.
6. Never commit credentials, production user data, exact home/work coordinates, or real identity records.

All contributions are reviewed. Report security issues privately as described in [SECURITY.md](SECURITY.md), never in a public issue.

## Checks

Run these locally. CI runs them on every push and pull request.

| Command | What it checks | CI job |
| --- | --- | --- |
| `npm run typecheck` | TypeScript (strict) | `typecheck` |
| `npm test` | Unit tests | `typecheck` |
| `npm run lint` | ESLint via `expo lint` (eslint-config-expo, including the React hooks rules) | `lint` |
| `npm run db:test` | Applies `supabase/migrations/` to a throwaway PostGIS container and runs `supabase/tests/` | `database` |
| (pull requests only) | `scripts/check-migration-order.sh`: the migration-number rule below | `migration-order` |

`npm run db:test` needs Docker. If you don't have it, push and let CI's `database` job run it for you. The `database` job also generates `database.types.ts` from the migrations and fails if the committed file differs (see below).

Lint warnings don't fail CI; errors do. `react/no-unescaped-entities` is a warning because React Native renders plain apostrophes and quotes in `<Text>` literally.

## Database changes

### Migration numbers

Migrations in `supabase/migrations/` are named `NNNN_description.sql` and applied in number order, both in CI and when the project owner pushes to the hosted project. To keep those two orders the same:

- A new migration's number must be above every migration on `main`. Gaps are fine (0006 and 0007 are unused). Pick a number when you start. On your last rebase before merge, if `main` now has a migration numbered at or above yours, rename your file to one above the highest on `main`.
- Never edit, rename or delete a migration that's on `main`. Put the change in a new migration.
- Each PR adds only its own migration files. Schema-qualify extension objects (`extensions.geography`, `extensions.st_*`), because the Supabase CLI applies migrations with `search_path` set to `"$user", public`.

CI's `migration-order` job enforces the first two rules on pull requests. To run it locally: `git fetch origin && scripts/check-migration-order.sh origin/main`.

### Updating `database.types.ts`

CI generates `apps/mobile/src/lib/database.types.ts` from the migrations, so you don't need access to the hosted project. After you change a migration:

1. Push your branch. The `database` job fails with a diff of the types and uploads the generated file as the `database-types` artifact.
2. Download it from your branch's latest run and commit it:

   ```bash
   gh run list --branch <your-branch> --workflow Checks --limit 1   # note the run ID
   gh run download <run-id> -n database-types -D /tmp/database-types
   cp /tmp/database-types/database.types.ts apps/mobile/src/lib/database.types.ts
   git add apps/mobile/src/lib/database.types.ts
   git commit -m "chore(db): regenerate database types"
   git push
   ```

   You can also download `database-types` from the run's Summary page on GitHub. Never edit the file by hand.

3. With Docker, `DB_TYPES_OUT=apps/mobile/src/lib/database.types.ts npm run db:test` writes the same file locally.

`npm run db:types` generates types from the hosted project instead. Use it only to check the live schema, and don't commit its output. CI's file is canonical. It differs from the hosted output only in generator details: each table has `ComputedFields: never`, a function with no arguments has `Args: Record<PropertyKey, never>` instead of `Args: never`, and a few generic type parameters lose their parentheses. A bare Postgres has no PostgREST, so `scripts/db-types.sh` adds the `__InternalSupabase` block with the hosted project's PostgREST version, and supabase-js types queries the same way. Update `POSTGREST_VERSION` in that script when the hosted project upgrades.

## Privacy checklist

Every pull request description covers its privacy and safety impact. Check that:

- Exact origins, destinations and pickup points never reach another member's client.
- Before a ride is confirmed, other members see only first name and last initial, role, approximate (~0.5 mi) areas, ride preferences and verification flags.
- The UI never reveals who said "no", and never tells "no" apart from "not answered".
- Blocked pairs and suspended members never appear to each other.
- New tables have row-level security enabled, with policies covered by SQL tests in `supabase/tests/`.
- No service-role key, API key, token or real personal data is in the app or the repo.
