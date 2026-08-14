import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSqlPool } from "@/src/lib/sql";
import { lookupVehicleByPlate, normalizeRegistrationPlate } from "@/src/services/vehicle-lookup.service";
import { decodeVinIntelligence } from "@/src/services/vin-intelligence.service";
import { validateVin } from "@/src/domain/vin";

export const dynamic = "force-dynamic";

function normalizePhone(value: string) { return value.replace(/\D/g, ""); }

async function readClient(phoneNormalized: string) {
  const pool = getSqlPool();
  const result = await pool.query(
    `SELECT c."id", c."name", c."phone",
      COALESCE(jsonb_agg(jsonb_build_object(
        'id', v."id", 'plateNumber', v."plateNumber", 'vin', v."vin", 'brand', v."brand", 'model', v."model", 'year', v."year",
        'engineName', v."engineName", 'fuelType', v."fuelType", 'driveType', v."driveType", 'vehicleDataSource', v."vehicleDataSource", 'vehicleDataConfidence', v."vehicleDataConfidence"
      ) ORDER BY v."updatedAt" DESC) FILTER (WHERE v."id" IS NOT NULL), '[]'::jsonb) AS vehicles
     FROM "Client" c LEFT JOIN "Vehicle" v ON v."clientId" = c."id"
     WHERE c."phoneNormalized" = $1 GROUP BY c."id" LIMIT 1`, [phoneNormalized]);
  return result.rows[0] || null;
}

export async function GET(request: NextRequest) {
  const phoneNormalized = normalizePhone(request.nextUrl.searchParams.get("phone") || "");
  if (!phoneNormalized) return NextResponse.json({ client: null });
  return NextResponse.json({ client: await readClient(phoneNormalized) });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim() || null;
  const phone = String(body.phone || "").trim();
  const phoneNormalized = normalizePhone(phone);
  const plate = normalizeRegistrationPlate(String(body.plate || ""));
  const vinRaw = String(body.vin || "").trim().toUpperCase();
  if (!phoneNormalized) return NextResponse.json({ error: "Не вказаний телефон клієнта" }, { status: 400 });
  if (!plate && !vinRaw) return NextResponse.json({ error: "Вкажіть держномер або VIN" }, { status: 400 });

  const pool = getSqlPool(); const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const existingClient = await db.query(`SELECT "id","name","phone" FROM "Client" WHERE "phoneNormalized"=$1 LIMIT 1`, [phoneNormalized]);
    const clientId = existingClient.rows[0]?.id || `client_${randomUUID()}`;
    if (!existingClient.rows[0]) await db.query(`INSERT INTO "Client" ("id","name","phone","phoneNormalized","createdAt","updatedAt") VALUES ($1,$2,$3,$4,NOW(),NOW())`, [clientId, name, phone, phoneNormalized]);
    else if (name && !existingClient.rows[0].name) await db.query(`UPDATE "Client" SET "name"=$2,"updatedAt"=NOW() WHERE "id"=$1`, [clientId, name]);

    let data: Record<string, unknown> = {};
    if (plate) {
      try { const r = await lookupVehicleByPlate(plate); if (r.vehicle) data = { vin:r.vehicle.vin, brand:r.vehicle.make, model:r.vehicle.model, year:r.vehicle.year, engineName:r.vehicle.engine, engineVolumeCm3:r.vehicle.engineVolumeCm3, fuelType:r.vehicle.fuelType, bodyType:r.vehicle.bodyType, driveType:r.vehicle.driveType, vehicleType:r.vehicle.vehicleType, turboLevClass:r.vehicle.turboLevClass, priceCoefficient:r.vehicle.priceCoefficient, vehicleDataSource:r.vehicle.vehicleDataSource, vehicleDataConfidence:r.vehicle.vehicleDataConfidence }; } catch {}
    }
    if (vinRaw) {
      const validation = validateVin(vinRaw);
      if (!validation.formatValid) { await db.query("ROLLBACK"); return NextResponse.json({ error: "VIN має містити 17 коректних символів" }, { status: 400 }); }
      try { const r = await decodeVinIntelligence(validation.vin); if (r.vehicle) data = { ...data, vin:validation.vin, brand:r.vehicle.make, model:r.vehicle.model, year:r.vehicle.year, engineName:r.vehicle.engine, engineVolumeCm3:r.vehicle.engineVolumeL ? Math.round(r.vehicle.engineVolumeL*1000) : null, fuelType:r.vehicle.fuelType, bodyType:r.vehicle.bodyType, driveType:r.vehicle.driveType, vehicleType:r.vehicle.vehicleType, vehicleDataSource:r.source, vehicleDataConfidence:r.confidence }; }
      catch { data = { ...data, vin:validation.vin, vehicleDataSource:"MANUAL_VIN", vehicleDataConfidence:60 }; }
    }

    const resolvedVin = String(data.vin || vinRaw || "") || null;
    const conflict = await db.query(`SELECT "id","clientId" FROM "Vehicle" WHERE ($1::text IS NOT NULL AND "plateNormalized"=$1) OR ($2::text IS NOT NULL AND "vin"=$2) LIMIT 1`, [plate || null, resolvedVin]);
    if (conflict.rows[0] && conflict.rows[0].clientId !== clientId) { await db.query("ROLLBACK"); return NextResponse.json({ error: "Цей автомобіль уже прив'язаний до іншого клієнта" }, { status: 409 }); }

    const vehicleId = conflict.rows[0]?.id || `vehicle_${randomUUID()}`;
    const values = [vehicleId,clientId,plate||null,plate||null,resolvedVin,data.brand||null,data.model||null,data.year||null,data.engineName||null,data.engineVolumeCm3||null,data.fuelType||null,data.bodyType||null,data.driveType||null,data.vehicleType||null,data.turboLevClass||null,data.priceCoefficient||1,data.vehicleDataSource||(vinRaw?"MANUAL_VIN":"MANUAL_PLATE"),data.vehicleDataConfidence||70];
    if (conflict.rows[0]) await db.query(`UPDATE "Vehicle" SET "clientId"=$2,"plateNumber"=COALESCE($3,"plateNumber"),"plateNormalized"=COALESCE($4,"plateNormalized"),"vin"=COALESCE($5,"vin"),"brand"=COALESCE($6,"brand"),"model"=COALESCE($7,"model"),"year"=COALESCE($8,"year"),"engineName"=COALESCE($9,"engineName"),"engineVolumeCm3"=COALESCE($10,"engineVolumeCm3"),"fuelType"=COALESCE($11,"fuelType"),"bodyType"=COALESCE($12,"bodyType"),"driveType"=COALESCE($13,"driveType"),"vehicleType"=COALESCE($14,"vehicleType"),"turboLevClass"=COALESCE($15,"turboLevClass"),"priceCoefficient"=$16,"vehicleDataSource"=$17,"vehicleDataConfidence"=$18,"lastVehicleLookupAt"=NOW(),"updatedAt"=NOW() WHERE "id"=$1`, values);
    else await db.query(`INSERT INTO "Vehicle" ("id","clientId","plateNumber","plateNormalized","vin","brand","model","year","engineName","engineVolumeCm3","fuelType","bodyType","driveType","vehicleType","turboLevClass","priceCoefficient","vehicleDataSource","vehicleDataConfidence","lastVehicleLookupAt","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),NOW(),NOW())`, values);
    await db.query("COMMIT");
    const client = await readClient(phoneNormalized);
    const vehicle = client?.vehicles?.find((v: { id: string }) => v.id === vehicleId) || null;
    return NextResponse.json({ ok:true, client, vehicle });
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {}); console.error("client-card save failed", error); return NextResponse.json({ error:"Не вдалося зберегти карту клієнта" }, { status:500 });
  } finally { db.release(); }
}
