#!/usr/bin/env bash
# Prints the TypeScript types for the public schema of the Postgres database at
# the URL in $1, in the canonical form committed as
# apps/mobile/src/lib/database.types.ts. scripts/db-test.sh calls this after it
# applies supabase/migrations (DB_TYPES_OUT=<path>); CI publishes the result as
# the `database-types` artifact.
#
# Normalisation, so the output only changes when the schema does:
# - The Supabase CLI (pinned by package-lock.json) prints unformatted
#   TypeScript; Prettier (also pinned) formats it the way the hosted generator
#   does.
# - A bare Postgres has no PostgREST, so the CLI leaves out the
#   __InternalSupabase block that `npm run db:types` (hosted) includes. We add
#   it with the hosted project's PostgREST version so supabase-js types queries
#   the same way. Update POSTGREST_VERSION when the hosted project upgrades.
set -euo pipefail
cd "$(dirname "$0")/.."

POSTGREST_VERSION="14.18"

if [ $# -ne 1 ]; then
  echo "usage: $0 <postgres-url>" >&2
  exit 2
fi

raw=$(npx --no-install supabase gen types typescript --db-url "$1" --schema public)

formatted=$(printf '%s\n' "$raw" |
  npx --no-install prettier --no-config --no-semi --parser typescript)

anchor='export type Database = {'
if [ "$(printf '%s\n' "$formatted" | grep -cxF "$anchor")" -ne 1 ]; then
  echo "db-types: expected exactly one '$anchor' line in the generated types" >&2
  exit 1
fi

printf '%s\n' "$formatted" | awk -v anchor="$anchor" -v version="$POSTGREST_VERSION" '
  { print }
  $0 == anchor {
    print "  // Allows to automatically instantiate createClient with right options"
    print "  // instead of createClient<Database, { PostgrestVersion: '\''XX'\'' }>(URL, KEY)"
    print "  __InternalSupabase: {"
    print "    PostgrestVersion: \"" version "\""
    print "  }"
  }
'
