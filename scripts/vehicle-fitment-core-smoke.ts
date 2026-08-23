import assert from "node:assert/strict";
import { Pool, type PoolClient } from "pg";

function requiredDatabaseUrl() {
  const value = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required");
  return value;
}

function pgCode(error: unknown) {
  return typeof error === "object" && error && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
}

async function expectViolation(client: PoolClient, expectedCode: string, sql: string, params: unknown[] = []) {
  await client.query("SAVEPOINT invalid_case");
  try {
    await client.query(sql, params);
    assert.fail(`Expected PostgreSQL violation ${expectedCode}`);
  } catch (error) {
    assert.equal(pgCode(error), expectedCode, `Expected PostgreSQL ${expectedCode}, got ${pgCode(error) || "unknown"}`);
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT invalid_case");
    await client.query("RELEASE SAVEPOINT invalid_case");
  }
}

const pool = new Pool({ connectionString: requiredDatabaseUrl(), max: 1 });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  const now = new Date();

  const fitmentStatuses = await client.query<{ enumlabel: string }>(`
    SELECT e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'VehicleFitmentStatus'
    ORDER BY e.enumsortorder
  `);
  assert.deepEqual(fitmentStatuses.rows.map((row) => row.enumlabel), ["ACTIVE", "DEPRECATED", "REVIEW_REQUIRED", "DISABLED"]);

  const linkStatuses = await client.query<{ enumlabel: string }>(`
    SELECT e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'VehicleReferenceLinkStatus'
    ORDER BY e.enumsortorder
  `);
  assert.deepEqual(linkStatuses.rows.map((row) => row.enumlabel), ["PROVISIONAL", "VERIFIED", "STALE", "CONFLICT"]);

  await client.query(
    `INSERT INTO "Client" ("id", "phone", "phoneNormalized", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$4)`,
    ["fit_client_1", "+380000000901", "+380000000901", now],
  );
  await client.query(
    `INSERT INTO "Vehicle" ("id", "clientId", "plateNumber", "plateNormalized", "brand", "model", "year", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
    ["fit_vehicle_1", "fit_client_1", "KA7584CI", "KA7584CI", "Volkswagen", "Passat", 2018, now],
  );

  await client.query(
    `INSERT INTO "Brand" ("id", "canonicalName", "normalizedName", "slug", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$5)`,
    ["fit_brand_1", "ATE", "ATE", "ate-fit-smoke", now],
  );
  await client.query(
    `INSERT INTO "GenericArticle" ("id", "code", "name", "slug", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$5)`,
    ["fit_article_1", "BRAKE_PAD_SET_SMOKE", "Brake pad set", "brake-pad-set-smoke", now],
  );
  await client.query(
    `INSERT INTO "Product" (
       "id", "brandId", "genericArticleId", "mpnRaw", "mpnNormalized", "mpnSearchNormalized",
       "title", "createdAt", "updatedAt"
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
    ["fit_product_1", "fit_brand_1", "fit_article_1", "13.0460-7184.2", "13046071842", "13046071842", "ATE brake pads smoke", now],
  );

  await client.query(
    `INSERT INTO "VehicleReference" (
       "id", "fitmentKey", "make", "makeNormalized", "model", "modelNormalized",
       "productionStartYear", "productionEndYear", "engineCode", "engineCodeNormalized",
       "confidence", "createdAt", "updatedAt"
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
    ["fit_vr_1", "fitment-pass-b8-2018-20tdi", "Volkswagen", "VOLKSWAGEN", "Passat", "PASSAT", 2018, 2020, "DFGA", "DFGA", 97, now],
  );

  await client.query(
    `INSERT INTO "VehicleCatalogLink" (
       "id", "vehicleId", "vehicleReferenceId", "status", "confidence", "source",
       "confirmedAt", "lastVerifiedAt", "createdAt", "updatedAt"
     ) VALUES ($1,$2,$3,'VERIFIED',98,'SMOKE',$4,$4,$4,$4)`,
    ["fit_link_1", "fit_vehicle_1", "fit_vr_1", now],
  );

  await client.query(
    `INSERT INTO "VehicleFitment" (
       "id", "productId", "vehicleReferenceId", "genericArticleId", "status", "position",
       "validFromYear", "validFromMonth", "validToYear", "validToMonth",
       "source", "sourceVersion", "sourceFitmentId", "confidence", "rawEvidence", "createdAt", "updatedAt"
     ) VALUES ($1,$2,$3,$4,'ACTIVE','FRONT',2018,1,2020,12,'SMOKE','v1','smoke-fitment-1',99,$5::jsonb,$6,$6)`,
    ["fit_fitment_1", "fit_product_1", "fit_vr_1", "fit_article_1", JSON.stringify({ provider: "SMOKE", verified: true }), now],
  );

  await client.query(
    `INSERT INTO "VehicleFitmentCriterion" (
       "id", "vehicleFitmentId", "key", "operator", "valueText", "valueNormalized", "isMandatory", "displayText"
     ) VALUES ($1,$2,'ENGINE_CODE','EQ','DFGA','DFGA',true,'Код двигуна DFGA')`,
    ["fit_criterion_1", "fit_fitment_1"],
  );
  await client.query(
    `INSERT INTO "VehicleFitmentCriterion" (
       "id", "vehicleFitmentId", "key", "operator", "valueNumber", "valueNumberTo", "unit", "isMandatory"
     ) VALUES ($1,$2,'POWER_KW','RANGE',85,120,'kW',false)`,
    ["fit_criterion_2", "fit_fitment_1"],
  );

  const verified = await client.query<{
    linkStatus: string;
    fitmentStatus: string;
    fitmentConfidence: number | null;
    criterionCount: string;
  }>(`
    SELECT l."status" AS "linkStatus", f."status" AS "fitmentStatus", f."confidence" AS "fitmentConfidence",
           COUNT(c."id")::text AS "criterionCount"
    FROM "VehicleCatalogLink" l
    JOIN "VehicleFitment" f ON f."vehicleReferenceId" = l."vehicleReferenceId"
    LEFT JOIN "VehicleFitmentCriterion" c ON c."vehicleFitmentId" = f."id"
    WHERE l."vehicleId" = 'fit_vehicle_1' AND f."productId" = 'fit_product_1'
    GROUP BY l."status", f."status", f."confidence"
  `);
  assert.equal(verified.rows[0]?.linkStatus, "VERIFIED");
  assert.equal(verified.rows[0]?.fitmentStatus, "ACTIVE");
  assert.equal(verified.rows[0]?.fitmentConfidence, 99);
  assert.equal(verified.rows[0]?.criterionCount, "2");

  await expectViolation(
    client,
    "23514",
    `INSERT INTO "VehicleCatalogLink" (
       "id", "vehicleId", "vehicleReferenceId", "confidence", "source", "createdAt", "updatedAt"
     ) VALUES ('fit_link_bad_confidence','fit_vehicle_1','fit_vr_1',101,'SMOKE',$1,$1)`,
    [now],
  );

  await expectViolation(
    client,
    "23505",
    `INSERT INTO "VehicleFitment" (
       "id", "productId", "vehicleReferenceId", "source", "sourceFitmentId", "createdAt", "updatedAt"
     ) VALUES ('fit_fitment_duplicate','fit_product_1','fit_vr_1','SMOKE','smoke-fitment-1',$1,$1)`,
    [now],
  );

  await expectViolation(
    client,
    "23514",
    `INSERT INTO "VehicleFitmentCriterion" (
       "id", "vehicleFitmentId", "key", "operator", "valueNumber", "valueNumberTo"
     ) VALUES ('fit_criterion_bad_range','fit_fitment_1','POWER_KW','RANGE',150,100)`,
  );

  await expectViolation(
    client,
    "23503",
    `INSERT INTO "VehicleFitment" (
       "id", "productId", "vehicleReferenceId", "source", "sourceFitmentId", "createdAt", "updatedAt"
     ) VALUES ('fit_fitment_bad_product','missing_product','fit_vr_1','SMOKE','smoke-fitment-missing-product',$1,$1)`,
    [now],
  );

  await expectViolation(
    client,
    "23001",
    `DELETE FROM "Product" WHERE "id" = 'fit_product_1'`,
  );

  await client.query(`DELETE FROM "Vehicle" WHERE "id" = 'fit_vehicle_1'`);
  const linkAfterVehicleDelete = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM "VehicleCatalogLink" WHERE "id" = 'fit_link_1'`,
  );
  assert.equal(linkAfterVehicleDelete.rows[0]?.count, "0", "VehicleCatalogLink must cascade-delete with CRM Vehicle");

  await client.query(`DELETE FROM "VehicleFitment" WHERE "id" = 'fit_fitment_1'`);
  const criteriaAfterFitmentDelete = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM "VehicleFitmentCriterion" WHERE "vehicleFitmentId" = 'fit_fitment_1'`,
  );
  assert.equal(criteriaAfterFitmentDelete.rows[0]?.count, "0", "fitment criteria must cascade-delete with fitment");

  await client.query("ROLLBACK");
  console.log("Vehicle fitment core PostgreSQL smoke: PASS");
} finally {
  client.release();
  await pool.end();
}
