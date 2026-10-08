#!/usr/bin/env bash
# Usage: scripts/check-migration-order.sh <base-ref>   (CI: origin/<base branch>)
#
# Keeps supabase/migrations in the order the owner pushes them to the hosted
# project. Fails when this branch:
# - adds a migration whose number isn't above every migration on <base-ref>
#   (gaps are fine: 0006 and 0007 are unused),
# - adds two migrations with the same number, or one without a number, or
# - edits, renames or deletes a migration that already exists.
# "This branch" means the commits since its merge base with <base-ref>; on a
# pull_request run, HEAD is GitHub's merge commit, so that's the PR's change.
set -euo pipefail
cd "$(dirname "$0")/.."

DIR=supabase/migrations

if [ $# -ne 1 ]; then
  echo "usage: $0 <base-ref>" >&2
  exit 2
fi
base_ref=$1
if ! git rev-parse --verify --quiet "$base_ref^{commit}" >/dev/null; then
  echo "check-migration-order: unknown base ref '$base_ref' (fetch it first)" >&2
  exit 2
fi
fork=$(git merge-base "$base_ref" HEAD)

# Prints the leading number of a migration file name, or nothing.
number_of() { sed -n 's/^\([0-9][0-9]*\)_.*\.sql$/\1/p' <<<"$1"; }

highest=0
highest_name="(none)"
while IFS= read -r path; do
  name=${path##*/}
  n=$(number_of "$name")
  [ -n "$n" ] || continue
  if ((10#$n > 10#$highest)); then highest=$n; highest_name=$name; fi
done < <(git ls-tree --name-only "$base_ref" -- "$DIR/" | grep '\.sql$' || true)
next=$(printf '%04d' $((10#$highest + 1)))

errors=()
seen=" "
while IFS=$'\t' read -r status path; do
  [ -n "$status" ] || continue
  name=${path##*/}
  if [ "$status" != A ]; then
    errors+=("$name already exists on $base_ref and this branch edits, renames or deletes it (git status $status). Merged migrations never change: restore it and put the change in a new migration numbered $next or above.")
    continue
  fi
  n=$(number_of "$name")
  if [ -z "$n" ]; then
    errors+=("$name has no number. Name it NNNN_description.sql, numbered $next or above.")
  elif ((10#$n <= 10#$highest)); then
    errors+=("$name isn't numbered above $highest_name, the highest migration on $base_ref. Rename it to ${next}_${name#*_} (or higher).")
  elif [[ $seen == *" $((10#$n)) "* ]]; then
    errors+=("$name shares its number with another new migration in this branch. Give each one its own number.")
  else
    seen+="$((10#$n)) "
  fi
done < <(git diff --no-renames --name-status "$fork" HEAD -- "$DIR/" | grep '\.sql$' || true)

if [ ${#errors[@]} -gt 0 ]; then
  echo "Migration order check failed against $base_ref (highest there: $highest_name):" >&2
  for e in "${errors[@]}"; do echo "  - $e" >&2; done
  echo "See CONTRIBUTING.md, \"Database changes\"." >&2
  exit 1
fi
echo "Migration order OK (highest on $base_ref: $highest_name)."
