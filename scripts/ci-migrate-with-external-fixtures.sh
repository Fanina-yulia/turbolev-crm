#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

# Prisma requires a truly empty schema on first deploy. VehicleRegistryCompact is
# not Prisma-managed, but one historical migration augments it. Start Prisma first,
# then attach the empty external fixture immediately after Prisma creates its own
# migration metadata table. This keeps the clean-database invariant intact while
# reproducing the production dependency on the MVS import pipeline.

npx prisma migrate deploy &
MIGRATE_PID=$!

cleanup_process() {
  if kill -0 "$MIGRATE_PID" 2>/dev/null; then
    kill "$MIGRATE_PID" 2>/dev/null || true
  fi
}
trap cleanup_process EXIT

fixture_loaded=0
for _ in $(seq 1 400); do
  if ! kill -0 "$MIGRATE_PID" 2>/dev/null; then
    break
  fi

  ready=$(psql "$DATABASE_URL" -tAc "SELECT CASE WHEN to_regclass('public._prisma_migrations') IS NULL THEN '0' ELSE '1' END" 2>/dev/null || echo 0)
  if [[ "${ready//[[:space:]]/}" == "1" ]]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/ci-bootstrap-external-tables.sql
    fixture_loaded=1
    break
  fi
  sleep 0.05
done

set +e
wait "$MIGRATE_PID"
status=$?
set -e
trap - EXIT

if [[ "$fixture_loaded" -ne 1 ]]; then
  echo "External CI fixture was not attached before Prisma migration replay finished." >&2
  exit 1
fi

exit "$status"
