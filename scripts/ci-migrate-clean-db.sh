#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

KNOWN_EXTERNAL_MIGRATION="20260820095500_vehicle_registry_color"
LOG_FILE="$(mktemp)"
trap 'rm -f "$LOG_FILE"' EXIT

# Prisma must start against a truly empty schema. The first pass is therefore
# expected to stop only when the historical migration reaches the external MVS
# registry table. At that point all earlier Prisma migrations have already been
# replayed and Prisma's migration metadata exists.
set +e
npx prisma migrate deploy 2>&1 | tee "$LOG_FILE"
FIRST_STATUS=${PIPESTATUS[0]}
set -e

if [[ "$FIRST_STATUS" -eq 0 ]]; then
  echo "Clean migration replay completed without needing an external fixture."
  exit 0
fi

if ! grep -q "$KNOWN_EXTERNAL_MIGRATION" "$LOG_FILE" || ! grep -q 'VehicleRegistryCompact' "$LOG_FILE"; then
  echo "Migration replay failed for an unexpected reason; refusing to baseline it." >&2
  exit "$FIRST_STATUS"
fi

echo "Known external MVS dependency reached; attaching empty CI contract."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/ci-external-schema.sql

# The failed migration transaction was rolled back by PostgreSQL. Mark that
# single known attempt as rolled back, then replay it against the fixture.
npx prisma migrate resolve --rolled-back "$KNOWN_EXTERNAL_MIGRATION"
npx prisma migrate deploy

echo "Clean migration replay with external-data contract: OK"
