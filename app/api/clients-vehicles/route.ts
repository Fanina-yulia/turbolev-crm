import { NextRequest, NextResponse } from "next/server";
import { getSqlPool } from "@/src/lib/sql";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") || "").trim().toLowerCase();
  const pool = getSqlPool();
  const values: unknown[] = [];
  let where = "TRUE";

  if (q) {
    values.push(`%${q}%`);
    where = `LOWER(COALESCE(c."name", '') || ' ' || c."phone" || ' ' || COALESCE(v."plateNumber", '') || ' ' || COALESCE(v."brand", '') || ' ' || COALESCE(v."model", '') || ' ' || COALESCE(v."vin", '')) LIKE $1`;
  }

  const result = await pool.query(
    `SELECT
       c."id", c."name", c."phone", c."phoneNormalized", c."createdAt", c."updatedAt",
       COALESCE(
         jsonb_agg(
           jsonb_build_object(
             'id', v."id",
             'plateNumber', v."plateNumber",
             'brand', v."brand",
             'model', v."model",
             'vin', v."vin",
             'year', v."year",
             'mileageKm', v."mileageKm",
             'engineName', v."engineName",
             'engineVolumeCm3', v."engineVolumeCm3",
             'fuelType', v."fuelType",
             'bodyType', v."bodyType",
             'driveType', v."driveType",
             'turboLevClass', v."turboLevClass",
             'priceCoefficient', v."priceCoefficient",
             'vehicleDataSource', v."vehicleDataSource",
             'vehicleDataConfidence', v."vehicleDataConfidence"
           ) ORDER BY v."updatedAt" DESC
         ) FILTER (WHERE v."id" IS NOT NULL),
         '[]'::jsonb
       ) AS vehicles
     FROM "Client" c
     LEFT JOIN "Vehicle" v ON v."clientId" = c."id"
     WHERE ${where}
     GROUP BY c."id"
     ORDER BY c."updatedAt" DESC
     LIMIT 250`,
    values,
  );

  const stats = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM "Client") AS clients,
       (SELECT COUNT(*)::int FROM "Vehicle") AS vehicles,
       (SELECT COUNT(*)::int FROM "Client" WHERE "id" LIKE 'demo_%') AS "demoClients",
       (SELECT COUNT(*)::int FROM "Vehicle" WHERE "id" LIKE 'demo_%') AS "demoVehicles"`,
  );

  return NextResponse.json({ items: result.rows, stats: stats.rows[0] });
}
