import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { getSqlPool } from "@/src/lib/sql";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { resolveVehicleImage } from "@/src/services/vehicle-images/vehicle-image.service";
import {
  generateVehicleImageInBackground,
  getVehicleImageDeliveryState,
} from "@/src/services/vehicle-images/vehicle-image-background.service";

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
  imageError: string | null;
};

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

function toVehicle(row: VehicleRow, imageState: string, imageError: string | null = null): MissingVehicle {
  return {
    id: row.id,
    make: row.brand?.trim() || "",
    model: row.model?.trim() || "",
    year: row.year,
    bodyType: row.bodyType?.trim() || null,
    plateNumber: row.plateNumber?.trim() || null,
    imageState,
    imageError,
  };
}

function canRequestImage(state: string, canGenerate: boolean) {
  return canGenerate && (state === "MISSING" || state === "ERROR");
}

async function missingVehicles() {
  const rows = await getPrisma().vehicle.findMany({
    where: {
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
  const actionable: Array<{ index: number; vehicle: MissingVehicle }> = [];
  const processing: Array<{ index: number; vehicle: MissingVehicle }> = [];
  const incomplete: Array<{ index: number; vehicle: MissingVehicle }> = [];
  const blocked: Array<{ index: number; vehicle: MissingVehicle }> = [];
  let auditFailures = 0;
  const worker = async () => {
    while (true) {
      const index = cursor++;
      if (index >= rows.length) return;
      const row = rows[index] as VehicleRow;
      try {
        // The vehicle card uses the delivery state, not the raw library status.
        // A READY PNG that still needs WebP optimization is therefore processing,
        // not a finished image, and must not make the audit report "all ready".
        const [image, library] = await Promise.all([
          resolveVehicleImage(row.id),
          getVehicleImageDeliveryState(row.id),
        ]);
        if (image || library.state === "READY") continue;
        const item = {
          index,
          vehicle: toVehicle(row, library.state, library.error || null),
        };
        if (library.state === "GENERATING") processing.push(item);
        else if (library.state === "MISSING_DATA") incomplete.push(item);
        else if (canRequestImage(library.state, library.canGenerate)) actionable.push(item);
        else blocked.push(item);
      } catch (error) {
        auditFailures += 1;
        console.warn("vehicle image missing-set state check failed", {
          vehicleId: row.id,
          message: error instanceof Error ? error.message : "unknown",
        });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(STATE_WORKERS, Math.max(1, rows.length)) }, () => worker()));
  for (const list of [actionable, processing, incomplete, blocked]) {
    list.sort((a, b) => a.index - b.index);
  }
  const totalWithoutReadyImage = actionable.length + processing.length + incomplete.length + blocked.length;
  return {
    vehicles: actionable.slice(0, MAX_VISIBLE).map((item) => item.vehicle),
    processingVehicles: processing.slice(0, MAX_VISIBLE).map((item) => item.vehicle),
    incompleteVehicles: incomplete.slice(0, MAX_VISIBLE).map((item) => item.vehicle),
    blockedVehicles: blocked.slice(0, MAX_VISIBLE).map((item) => item.vehicle),
    totalMissing: totalWithoutReadyImage,
    totalWithoutReadyImage,
    totalActionable: actionable.length,
    totalProcessing: processing.length,
    totalIncomplete: incomplete.length,
    totalBlocked: blocked.length,
    scanned: rows.length,
    auditFailures,
    limited: [actionable, processing, incomplete, blocked].some((list) => list.length > MAX_VISIBLE),
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
    if (!candidate.make || !candidate.model) return NextResponse.json({ ok: false, error: "У картці автомобіля мають бути заповнені марка і модель." }, { status: 409 });

    const [existingImage, before] = await Promise.all([
      resolveVehicleImage(vehicleId),
      getVehicleImageDeliveryState(vehicleId),
    ]);
    if (existingImage || before.state === "READY" || before.state === "GENERATING") {
      return NextResponse.json(
        { ok: true, skipped: true, vehicle: { ...candidate, imageState: existingImage ? "READY" : before.state }, library: before },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (!canRequestImage(before.state, before.canGenerate)) {
      return NextResponse.json({ ok: false, error: before.error || "Для цього автомобіля генерація зараз недоступна." }, { status: 409 });
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
    const library = await getVehicleImageDeliveryState(vehicleId);
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
