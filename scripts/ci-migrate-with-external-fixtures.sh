#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

# Prisma expects an empty schema when it initializes migration history. The MVS
# registry table is external to Prisma, so attach its empty CI fixture only after
# Prisma has created _prisma_migrations, but before the historical migration that
# alters VehicleRegistryCompact is reached.

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
