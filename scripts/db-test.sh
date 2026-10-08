#!/usr/bin/env bash
# Applies supabase/migrations to a throwaway PostGIS container with a minimal
# Supabase auth shim, then runs every supabase/tests/*_test.sql. Needs Docker.
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE=postgis/postgis:17-3.5
NAME="merge-db-test-$$"

docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
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
