import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { getSqlPool } from "@/src/lib/sql";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getVehicleImageLibraryState } from "@/src/services/vehicle-images/openai-library.service";
import { generateVehicleImageInBackground } from "@/src/services/vehicle-images/vehicle-image-background.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_SCAN = 160;
const MAX_VISIBLE = 24;
const STATE_WORKERS = 6;

type VehicleRow = {
  id: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  bodyType: string | null;
  plateNumber: string | null;
};

type MissingVehicle = {
  id: string;
  make: string;
  model: string;
  year: number | null;
  bodyType: string | null;
  plateNumber: string | null;
  imageState: string;
};

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

function toVehicle(row: VehicleRow, imageState: string): MissingVehicle | null {
  const make = row.brand?.trim() || "";
  const model = row.model?.trim() || "";
  if (!make || !model) return null;
  return {
    id: row.id,
    make,
    model,
    year: row.year,
    bodyType: row.bodyType?.trim() || null,
    plateNumber: row.plateNumber?.trim() || null,
    imageState,
  };
}

function needsImage(state: string) {
  return state === "MISSING" || state === "ERROR" || state === "NOT_CONFIGURED";
}

async function missingVehicles() {
  const rows = await getPrisma().vehicle.findMany({
    where: {
      brand: { not: null },
      model: { not: null },
      NOT: { id: { startsWith: "demo_" } },
    },
    orderBy: { updatedAt: "desc" },
    take: MAX_SCAN,
    select: {
      id: true,
      brand: true,
      model: true,
      year: true,
      bodyType: true,
      plateNumber: true,
    },
  });

  let cursor = 0;
  const found: Array<{ index: number; vehicle: MissingVehicle }> = [];
  const worker = async () => {
    while (true) {
      const index = cursor++;
      if (index >= rows.length) return;
      const row = rows[index] as VehicleRow;
      const base = toVehicle(row, "");
      if (!base) continue;
      try {
        const library = await getVehicleImageLibraryState(row.id);
        if (!needsImage(library.state)) continue;
        found.push({ index, vehicle: { ...base, imageState: library.state } });
      } catch (error) {
        console.warn("vehicle image missing-set state check failed", {
          vehicleId: row.id,
          message: error instanceof Error ? error.message : "unknown",
        });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(STATE_WORKERS, Math.max(1, rows.length)) }, () => worker()));
  found.sort((a, b) => a.index - b.index);
  return {
    vehicles: found.slice(0, MAX_VISIBLE).map((item) => item.vehicle),
    totalMissing: found.length,
    scanned: rows.length,
    limited: found.length > MAX_VISIBLE,
  };
}

export async function GET(request: NextRequest) {
  const access = await authorize(PERMISSIONS.SETTINGS_INTEGRATIONS, { strict: true, request });
  if (!access.allowed) return access.response!;

  try {
    const result = await missingVehicles();
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("vehicle image missing-set GET failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося знайти автомобілі CRM без зображення." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const access = await authorize(PERMISSIONS.SETTINGS_INTEGRATIONS, { strict: true, request });
  if (!access.allowed) return access.response!;
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  try {
    const body = await request.json().catch(() => null) as { vehicleId?: string } | null;
    const vehicleId = body?.vehicleId?.trim();
    if (!vehicleId) return NextResponse.json({ ok: false, error: "Не передано автомобіль для генерації." }, { status: 400 });

    const row = await getPrisma().vehicle.findFirst({
      where: { id: vehicleId, NOT: { id: { startsWith: "demo_" } } },
      select: { id: true, brand: true, model: true, year: true, bodyType: true, plateNumber: true },
    }) as VehicleRow | null;
    if (!row) return NextResponse.json({ ok: false, error: "Картку автомобіля в CRM не знайдено." }, { status: 404 });

    const candidate = toVehicle(row, "");
    if (!candidate) return NextResponse.json({ ok: false, error: "У картці автомобіля мають бути заповнені марка і модель." }, { status: 409 });

    const before = await getVehicleImageLibraryState(vehicleId);
    if (before.state === "READY" || before.state === "GENERATING") {
      return NextResponse.json(
        { ok: true, skipped: true, vehicle: { ...candidate, imageState: before.state }, library: before },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (!needsImage(before.state)) {
      return NextResponse.json({ ok: false, error: before.error || "Для цього автомобіля генерація зараз недоступна." }, { status: 409 });
    }
    if (!before.canGenerate) {
      return NextResponse.json({ ok: false, error: before.error || "OpenAI API для зображень не налаштовано." }, { status: 422 });
    }

    if (before.assetId) {
      await getSqlPool().query(
        `UPDATE public."VehicleImageLibraryAsset"
            SET "reviewStatus"='PENDING',"reviewedAt"=NULL,"reviewedByUserId"=NULL,"updatedAt"=CURRENT_TIMESTAMP
          WHERE "id"=$1`,
        [before.assetId],
      ).catch(() => undefined);
    }

    const generation = await generateVehicleImageInBackground(vehicleId, { force: before.state === "ERROR" });
    const library = await getVehicleImageLibraryState(vehicleId);
    return NextResponse.json(
      { ok: true, vehicle: { ...candidate, imageState: before.state }, generation, library },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("vehicle image missing-set POST failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Не вдалося згенерувати зображення автомобіля." },
      { status: 422 },
    );
  }
}
