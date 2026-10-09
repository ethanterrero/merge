#!/usr/bin/env bash
# Applies supabase/migrations to a throwaway PostGIS container with a minimal
# Supabase auth shim, then runs every supabase/tests/*_test.sql. Needs Docker.
#
# With DB_TYPES_OUT=<path>, it also writes the TypeScript types generated from
# the migrated schema to that path (see scripts/db-types.sh). CI uses this to
# produce the `database-types` artifact.
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE=postgis/postgis:17-3.5
NAME="merge-db-test-$$"

# Publish the port on a random loopback port: `supabase gen types` connects
# from the host (it generates in-process and can't join a Docker network).
docker run -d --rm --name "$NAME" -p 127.0.0.1::5432 -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

# TCP only answers once the image's init scripts finish and the real server starts.
until docker exec "$NAME" pg_isready -h 127.0.0.1 -U postgres -q; do sleep 1; done

run_sql() {
  docker exec -i -e PGPASSWORD=postgres "$NAME" \
    psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X
}

run_sql < scripts/db-test/auth-shim.sql
for f in supabase/migrations/*.sql; do
  echo "migrate $(basename "$f")"
  run_sql < "$f"
done

# Generate types before the tests run, so nothing a test leaves behind leaks in.
if [ -n "${DB_TYPES_OUT:-}" ]; then
  echo "generate types -> $DB_TYPES_OUT"
  port=$(docker port "$NAME" 5432/tcp | sed -n 's/^127\.0\.0\.1://p' | head -n 1)
  # The container's Postgres has no TLS, and the CLI tries TLS unless told not to.
  scripts/db-types.sh "postgresql://postgres:postgres@127.0.0.1:$port/postgres?sslmode=disable" > "$DB_TYPES_OUT"
fi

status=0
for f in supabase/tests/*_test.sql; do
  if run_sql < "$f"; then
    echo "PASS $(basename "$f")"
  else
    echo "FAIL $(basename "$f")"
    status=1
  fi
done
exit "$status"
