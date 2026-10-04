import assert from "node:assert/strict";
import fs from "node:fs";

const image = fs.readFileSync("src/services/vehicle-images/openai-library.service.ts","utf8");
const db = fs.readFileSync("src/services/database-observability.service.ts","utf8");
const api = fs.readFileSync("app/api/settings/database-observability/route.ts","utf8");
const cron = fs.readFileSync("app/api/internal/database-observability-snapshot/route.ts","utf8");
const policy = fs.readFileSync("src/security/api-policy.ts","utf8");
const migration = fs.readFileSync("prisma/migrations/20261004143000_database_query_observability/migration.sql","utf8");
const vercel = JSON.parse(fs.readFileSync("vercel.json","utf8"));

assert.match(image,/findAssetByIdentity/);
assert.match(image,/vehicle-image-template:/);
assert.match(image,/pg_advisory_xact_lock/);
assert.match(image,/ON CONFLICT DO NOTHING/);
assert.match(image,/asset\.libraryKey/,"queue jobs must use the canonical library key after template/variant deduplication");
assert.match(image,/"templateKey"=\$2 AND "variantKey"=\$3/);
assert.equal(
  /enqueueVehicleImageGeneration[\s\S]*ON CONFLICT \("libraryKey"\)/.test(image),
  false,
  "queue registration must not rely only on libraryKey conflict handling",
);

assert.match(migration,/CREATE EXTENSION IF NOT EXISTS pg_stat_statements/);
assert.match(migration,/CREATE TABLE IF NOT EXISTS "DatabaseQueryStatSnapshot"/);
assert.match(db,/pg_stat_statements/);
assert.match(db,/pg_stat_statements_info/);
assert.match(db,/DatabaseQueryStatSnapshot/);
assert.match(db,/SNAPSHOT_RETENTION_DAYS = 35/);
assert.match(db,/query NOT ILIKE '%DatabaseQueryStatSnapshot%'/);

assert.match(api,/PERMISSIONS\.SETTINGS_INTEGRATIONS/);
assert.match(api,/minimumScope: "ALL"/);
assert.match(api,/strict: true/);

assert.match(cron,/CRON_SECRET/);
assert.match(cron,/vercel-cron\//);
assert.match(policy,/database-observability-snapshot/);
assert.match(policy,/database-observability/);

const scheduled = vercel.crons.find((item) => item.path === "/api/internal/database-observability-snapshot");
assert.ok(scheduled,"database observability snapshot cron is required");
assert.equal(scheduled.schedule,"17 2 * * *");

console.log("[db-observability] image deduplication, pg_stat_statements, snapshots, RBAC and cron contracts OK.");
