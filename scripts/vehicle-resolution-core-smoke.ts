import assert from "node:assert/strict";
import { Pool, type PoolClient } from "pg";

function requiredDatabaseUrl() {
  const value = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required");
  return value;
}

async function expectCheckViolation(client: PoolClient, sql: string, params: unknown[]) {
  await client.query("SAVEPOINT invalid_case");
  try {
    await client.query(sql, params);
    assert.fail("Expected PostgreSQL CHECK violation");
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
    assert.equal(code, "23514", `Expected CHECK violation 23514, got ${code || "unknown"}`);
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT invalid_case");
    await client.query("RELEASE SAVEPOINT invalid_case");
  }
}

const pool = new Pool({ connectionString: requiredDatabaseUrl(), max: 1 });
const client = await pool.connect();

try {
  await client.query("BEGIN");

  const enumValues = await client.query<{ enumlabel: string }>(`
    SELECT e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'VehicleResolutionInputType'
    ORDER BY e.enumsortorder
  `);
  assert.deepEqual(enumValues.rows.map((row) => row.enumlabel), ["VIN", "PLATE", "MANUAL", "CRM_VEHICLE", "REGISTRY"]);

  const resolutionColumns = await client.query<{ column_name: string }>(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'VehicleResolution'
  `);
  const columnNames = new Set(resolutionColumns.rows.map((row) => row.column_name.toLowerCase()));
  assert.equal(columnNames.has("vin"), false, "VehicleResolution must not have a raw VIN column");
  assert.equal(columnNames.has("plate"), false, "VehicleResolution must not have a raw plate column");
  assert.equal(columnNames.has("platenumber"), false, "VehicleResolution must not have a raw plateNumber column");
  assert.equal(columnNames.has("requestfingerprint"), true, "VehicleResolution requires a fingerprint column");

  const now = new Date();
  const expiry = new Date(now.getTime() + 10 * 60 * 1000);

  await client.query(
    `INSERT INTO "VehicleReference" (
      "id", "fitmentKey", "make", "makeNormalized", "model", "modelNormalized",
      "productionStartYear", "productionEndYear", "confidence", "createdAt", "updatedAt"
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
    ["vr_smoke_1", "fitment-smoke-1", "Volkswagen", "VOLKSWAGEN", "Passat", "PASSAT", 2018, 2023, 94, now],
  );

  await client.query(
    `INSERT INTO "VehicleReferenceExternalId" (
      "id", "vehicleReferenceId", "provider", "externalType", "externalId", "isPrimary"
    ) VALUES ($1,$2,$3,$4,$5,true)`,
    ["vre_smoke_1", "vr_smoke_1", "SMOKE", "CATALOG_ID", "veh-001"],
  );

  await client.query(
    `INSERT INTO "VehicleResolution" (
      "id", "status", "inputType", "vehicleReferenceId", "confidence", "source",
      "requestFingerprint", "normalizedInput", "normalizedFacts", "resolutionPolicy",
      "correlationId", "resolvedAt", "expiresAt", "createdAt", "updatedAt"
    ) VALUES ($1,'RESOLVED','PLATE',$2,91,'SMOKE',$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$10)`,
    [
      "vrs_smoke_1",
      "vr_smoke_1",
      "hmac-sha256:4b33c8c8e06b77d24dbb9e5f60dd0c2f2b44f47e9e5c2af9a8a27657c52a54a1",
      JSON.stringify({ countryCode: "UA", identifierKind: "PLATE", masked: "KA••••CI" }),
      JSON.stringify({ make: "Volkswagen", model: "Passat", year: 2018 }),
      "vehicle-identity-v1",
      "corr-smoke-1",
      now,
      expiry,
      now,
    ],
  );

  await client.query(
    `INSERT INTO "VehicleResolutionCandidate" (
      "id", "vehicleResolutionId", "vehicleReferenceId", "rank", "score", "selected"
    ) VALUES ($1,$2,$3,1,94,true)`,
    ["vrc_smoke_1", "vrs_smoke_1", "vr_smoke_1"],
  );

  const resolved = await client.query<{
    inputType: string;
    status: string;
    confidence: number;
    referenceId: string | null;
    candidateCount: string;
  }>(`
    SELECT r."inputType", r."status", r."confidence", r."vehicleReferenceId" AS "referenceId",
           COUNT(c."id")::text AS "candidateCount"
    FROM "VehicleResolution" r
    LEFT JOIN "VehicleResolutionCandidate" c ON c."vehicleResolutionId" = r."id"
    WHERE r."id" = 'vrs_smoke_1'
    GROUP BY r."id"
  `);
  assert.equal(resolved.rows[0]?.inputType, "PLATE");
  assert.equal(resolved.rows[0]?.status, "RESOLVED");
  assert.equal(resolved.rows[0]?.confidence, 91);
  assert.equal(resolved.rows[0]?.referenceId, "vr_smoke_1");
  assert.equal(resolved.rows[0]?.candidateCount, "1");

  await expectCheckViolation(
    client,
    `INSERT INTO "VehicleResolution" (
      "id", "status", "inputType", "confidence", "requestFingerprint", "resolutionPolicy",
      "expiresAt", "createdAt", "updatedAt"
    ) VALUES ('vrs_bad_confidence','PENDING','VIN',101,'fingerprint-bad-confidence','vehicle-identity-v1',$1,$2,$2)`,
    [expiry, now],
  );

  await expectCheckViolation(
    client,
    `INSERT INTO "VehicleResolution" (
      "id", "status", "inputType", "confidence", "requestFingerprint", "resolutionPolicy",
      "expiresAt", "createdAt", "updatedAt"
    ) VALUES ('vrs_bad_expiry','PENDING','PLATE',0,'fingerprint-bad-expiry','vehicle-identity-v1',$1,$1,$1)`,
    [now],
  );

  await expectCheckViolation(
    client,
    `INSERT INTO "VehicleReference" (
      "id", "fitmentKey", "make", "makeNormalized", "model", "modelNormalized",
      "confidence", "createdAt", "updatedAt"
    ) VALUES ('vr_bad_confidence','fitment-bad-confidence','X','X','Y','Y',101,$1,$1)`,
    [now],
  );

  await client.query(`DELETE FROM "VehicleResolution" WHERE "id" = 'vrs_smoke_1'`);
  const candidatesAfterDelete = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM "VehicleResolutionCandidate" WHERE "id" = 'vrc_smoke_1'`,
  );
  assert.equal(candidatesAfterDelete.rows[0]?.count, "0", "resolution candidate must cascade-delete with resolution");

  await client.query("ROLLBACK");
  console.log("Vehicle resolution core PostgreSQL smoke: PASS");
} finally {
  client.release();
  await pool.end();
}
