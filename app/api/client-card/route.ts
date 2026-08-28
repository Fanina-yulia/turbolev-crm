import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSqlPool } from "@/src/lib/sql";
import { lookupVehicleByPlate, normalizeRegistrationPlate } from "@/src/services/vehicle-lookup.service";
import { decodeVinIntelligence } from "@/src/services/vin-intelligence.service";
import { validateVin } from "@/src/domain/vin";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const dynamic = "force-dynamic";

async function clientCardAccess(request: Request, write = false) {
  return authorize(write ? PERMISSIONS.CLIENTS_WRITE : PERMISSIONS.CLIENTS_READ, {
    request,
    strict: true,
    minimumScope: write ? "TEAM" : "SELF",
  });
}

function normalizePhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `38${digits}`;
  if (!digits.startsWith("380") && digits.length === 9) digits = `380${digits}`;
  return digits.slice(0, 12);
}

function displayPhone(normalized: string) {
  if (normalized.length !== 12 || !normalized.startsWith("380")) return normalized;
  return `+${normalized}`;
}

function cleanClientName(value: unknown) {
  const name = String(value || "").trim();
  if (!name) return null;
  const normalized = name.toLocaleLowerCase("uk-UA").replace(/\s+/g, " ");
  if (["без імені", "без имени", "невідомий номер", "неизвестный номер", "unknown", "unknown number"].includes(normalized)) return null;
  return name.slice(0, 160);
}

async function readClient(phoneNormalized: string) {
  const pool = getSqlPool();
  const result = await pool.query(
    `WITH target AS (
       SELECT c."id"
       FROM "Client" c
       LEFT JOIN "ClientPhone" cp ON cp."clientId" = c."id"
       WHERE c."phoneNormalized" = $1 OR cp."phoneNormalized" = $1
       ORDER BY CASE WHEN c."phoneNormalized" = $1 THEN 0 ELSE 1 END
       LIMIT 1
     )
     SELECT c."id", c."name", c."phone",
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
           'id', cp."id", 'phone', cp."phone", 'phoneNormalized', cp."phoneNormalized", 'label', cp."label", 'isPrimary', cp."isPrimary"
         ) ORDER BY cp."isPrimary" DESC, cp."createdAt" ASC)
         FROM "ClientPhone" cp WHERE cp."clientId" = c."id"
       ), '[]'::jsonb) AS phones,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
           'id', v."id", 'plateNumber', v."plateNumber", 'vin', v."vin", 'brand', v."brand", 'model', v."model", 'year', v."year",
           'engineName', v."engineName", 'fuelType', v."fuelType", 'driveType', v."driveType", 'vehicleDataSource', v."vehicleDataSource", 'vehicleDataConfidence', v."vehicleDataConfidence"
         ) ORDER BY v."updatedAt" DESC)
         FROM "Vehicle" v WHERE v."clientId" = c."id"
       ), '[]'::jsonb) AS vehicles,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
           'id', wo."id", 'vehicleId', wo."vehicleId", 'status', wo."status", 'createdAt', wo."createdAt", 'updatedAt', wo."updatedAt", 'closedAt', wo."closedAt"
         ) ORDER BY wo."updatedAt" DESC)
         FROM "WorkOrder" wo WHERE wo."clientId" = c."id"
       ), '[]'::jsonb) AS "serviceHistory"
     FROM "Client" c JOIN target t ON t."id" = c."id"`, [phoneNormalized]);
  return result.rows[0] || null;
}

async function findClientIdByPhone(db: { query: (text: string, params?: unknown[]) => Promise<{ rows: Array<{ id: string }> }> }, phoneNormalized: string) {
  const result = await db.query(
    `SELECT DISTINCT c."id"
     FROM "Client" c
     LEFT JOIN "ClientPhone" cp ON cp."clientId"=c."id"
     WHERE c."phoneNormalized"=$1 OR cp."phoneNormalized"=$1
     LIMIT 1`, [phoneNormalized]);
  return result.rows[0]?.id || null;
}

export async function GET(request: NextRequest) {
  const access = await clientCardAccess(request);
  if (!access.allowed) return access.response!;
  const phoneNormalized = normalizePhone(request.nextUrl.searchParams.get("phone") || "");
  if (!phoneNormalized) return NextResponse.json({ client: null });
  return NextResponse.json({ client: await readClient(phoneNormalized) });
}

export async function PUT(request: NextRequest) {
  const access = await clientCardAccess(request, true);
  if (!access.allowed) return access.response!;
  const body = await request.json().catch(() => ({}));
  const clientIdInput = String(body.clientId || "").trim() || null;
  const primaryNormalized = normalizePhone(String(body.primaryPhone || body.phone || ""));
  const additionalRaw = String(body.additionalPhone || "").trim();
  const additionalNormalized = additionalRaw ? normalizePhone(additionalRaw) : "";
  const additionalPhoneId = String(body.additionalPhoneId || "").trim() || null;
  const name = cleanClientName(body.name);

  if (primaryNormalized.length !== 12 || !primaryNormalized.startsWith("380")) {
    return NextResponse.json({ error: "Вкажіть коректний основний номер телефону" }, { status: 400 });
  }
  if (additionalRaw && (additionalNormalized.length !== 12 || !additionalNormalized.startsWith("380"))) {
    return NextResponse.json({ error: "Вкажіть коректний додатковий номер телефону" }, { status: 400 });
  }
  if (additionalNormalized && additionalNormalized === primaryNormalized) {
    return NextResponse.json({ error: "Основний і додатковий номери мають відрізнятися" }, { status: 400 });
  }

  const pool = getSqlPool();
  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    let clientId = clientIdInput;
    if (clientId) {
      const existing = await db.query(`SELECT "id" FROM "Client" WHERE "id"=$1 LIMIT 1`, [clientId]);
      if (!existing.rows[0]) clientId = null;
    }
    if (!clientId) clientId = await findClientIdByPhone(db, primaryNormalized);

    const primaryOwner = await findClientIdByPhone(db, primaryNormalized);
    if (primaryOwner && clientId && primaryOwner !== clientId) {
      await db.query("ROLLBACK");
      return NextResponse.json({ error: "Цей основний номер уже належить іншому клієнту" }, { status: 409 });
    }
    if (additionalNormalized) {
      const additionalOwner = await findClientIdByPhone(db, additionalNormalized);
      if (additionalOwner && clientId && additionalOwner !== clientId) {
        await db.query("ROLLBACK");
        return NextResponse.json({ error: "Цей додатковий номер уже належить іншому клієнту" }, { status: 409 });
      }
    }

    const primaryDisplay = displayPhone(primaryNormalized);
    if (!clientId) {
      clientId = `client_${randomUUID()}`;
      await db.query(
        `INSERT INTO "Client" ("id","name","phone","phoneNormalized","createdAt","updatedAt") VALUES ($1,$2,$3,$4,NOW(),NOW())`,
        [clientId, name, primaryDisplay, primaryNormalized],
      );
    } else {
      await db.query(
        `UPDATE "Client" SET "name"=COALESCE($2,"name"),"phone"=$3,"phoneNormalized"=$4,"updatedAt"=NOW() WHERE "id"=$1`,
        [clientId, name, primaryDisplay, primaryNormalized],
      );
    }

    await db.query(`UPDATE "ClientPhone" SET "isPrimary"=false,"updatedAt"=NOW() WHERE "clientId"=$1`, [clientId]);
    await db.query(
      `INSERT INTO "ClientPhone" ("id","clientId","phone","phoneNormalized","label","isPrimary","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,'Основний',true,NOW(),NOW())
       ON CONFLICT ("phoneNormalized") DO UPDATE SET
         "phone"=EXCLUDED."phone","label"='Основний',"isPrimary"=true,"updatedAt"=NOW()`,
      [`cp_${randomUUID()}`, clientId, primaryDisplay, primaryNormalized],
    );

    if (Object.prototype.hasOwnProperty.call(body, "additionalPhone")) {
      if (additionalNormalized) {
        const additionalDisplay = displayPhone(additionalNormalized);
        if (additionalPhoneId) {
          const editable = await db.query(
            `SELECT "id" FROM "ClientPhone" WHERE "id"=$1 AND "clientId"=$2 AND "isPrimary"=false LIMIT 1`,
            [additionalPhoneId, clientId],
          );
          if (editable.rows[0]) {
            await db.query(
              `UPDATE "ClientPhone"
               SET "phone"=$3,"phoneNormalized"=$4,"label"='Додатковий',"isPrimary"=false,"updatedAt"=NOW()
               WHERE "id"=$1 AND "clientId"=$2 AND "isPrimary"=false`,
              [additionalPhoneId, clientId, additionalDisplay, additionalNormalized],
            );
          } else {
            await db.query(
              `INSERT INTO "ClientPhone" ("id","clientId","phone","phoneNormalized","label","isPrimary","createdAt","updatedAt")
               VALUES ($1,$2,$3,$4,'Додатковий',false,NOW(),NOW())
               ON CONFLICT ("phoneNormalized") DO UPDATE SET
                 "phone"=EXCLUDED."phone","label"='Додатковий',"isPrimary"=false,"updatedAt"=NOW()`,
              [`cp_${randomUUID()}`, clientId, additionalDisplay, additionalNormalized],
            );
          }
        } else {
          await db.query(
            `INSERT INTO "ClientPhone" ("id","clientId","phone","phoneNormalized","label","isPrimary","createdAt","updatedAt")
             VALUES ($1,$2,$3,$4,'Додатковий',false,NOW(),NOW())
             ON CONFLICT ("phoneNormalized") DO UPDATE SET
               "phone"=EXCLUDED."phone","label"='Додатковий',"isPrimary"=false,"updatedAt"=NOW()`,
            [`cp_${randomUUID()}`, clientId, additionalDisplay, additionalNormalized],
          );
        }
      } else if (additionalPhoneId) {
        await db.query(`DELETE FROM "ClientPhone" WHERE "id"=$1 AND "clientId"=$2 AND "isPrimary"=false`, [additionalPhoneId, clientId]);
      }
    }

    await db.query("COMMIT");
    const client = await readClient(primaryNormalized);
    return NextResponse.json({ ok: true, client });
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    console.error("client contact save failed", error);
    return NextResponse.json({ error: "Не вдалося зберегти дані клієнта" }, { status: 500 });
  } finally {
    db.release();
  }
}

export async function POST(request: NextRequest) {
  const access = await clientCardAccess(request, true);
  if (!access.allowed) return access.response!;
  const body = await request.json().catch(() => ({}));
  const name = cleanClientName(body.name);
  const phone = String(body.phone || body.primaryPhone || "").trim();
  const phoneNormalized = normalizePhone(phone);
  const plate = normalizeRegistrationPlate(String(body.plate || ""));
  const vinRaw = String(body.vin || "").trim().toUpperCase();
  if (phoneNormalized.length !== 12 || !phoneNormalized.startsWith("380")) return NextResponse.json({ error: "Не вказаний коректний телефон клієнта" }, { status: 400 });
  if (!plate && !vinRaw) return NextResponse.json({ error: "Вкажіть держномер або VIN" }, { status: 400 });

  const pool = getSqlPool(); const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const existingClient = await db.query(
      `SELECT DISTINCT c."id",c."name",c."phone",c."phoneNormalized"
       FROM "Client" c LEFT JOIN "ClientPhone" cp ON cp."clientId"=c."id"
       WHERE c."phoneNormalized"=$1 OR cp."phoneNormalized"=$1 LIMIT 1`, [phoneNormalized]);
    const clientId = existingClient.rows[0]?.id || `client_${randomUUID()}`;
    if (!existingClient.rows[0]) {
      const display = phone || displayPhone(phoneNormalized);
      await db.query(`INSERT INTO "Client" ("id","name","phone","phoneNormalized","createdAt","updatedAt") VALUES ($1,$2,$3,$4,NOW(),NOW())`, [clientId, name, display, phoneNormalized]);
      await db.query(`INSERT INTO "ClientPhone" ("id","clientId","phone","phoneNormalized","label","isPrimary","createdAt","updatedAt") VALUES ($1,$2,$3,$4,'Основний',true,NOW(),NOW()) ON CONFLICT ("phoneNormalized") DO NOTHING`, [`cp_${randomUUID()}`, clientId, display, phoneNormalized]);
    } else {
      if (name && name !== existingClient.rows[0].name) await db.query(`UPDATE "Client" SET "name"=$2,"updatedAt"=NOW() WHERE "id"=$1`, [clientId, name]);
      await db.query(`INSERT INTO "ClientPhone" ("id","clientId","phone","phoneNormalized","label","isPrimary","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW()) ON CONFLICT ("phoneNormalized") DO NOTHING`, [`cp_${randomUUID()}`, clientId, phone || displayPhone(phoneNormalized), phoneNormalized, existingClient.rows[0].phoneNormalized === phoneNormalized ? "Основний" : "Додатковий", existingClient.rows[0].phoneNormalized === phoneNormalized]);
    }

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
