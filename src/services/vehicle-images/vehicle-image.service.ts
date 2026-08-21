import { getPrisma } from "@/src/lib/prisma";
import { getSqlPool } from "@/src/lib/sql";
import type { ResolvedVehicleImage } from "./types";
import { testOpenAIVehicleImageConnection } from "./openai-library.service";
import { getVehicleImageDeliveryState } from "./vehicle-image-background.service";

function asManualResolved(asset: {
  id: string;
  vehicleId: string;
  provider: string;
  sourceUrl: string | null;
  matchConfidence: number | null;
  angle: string;
  requestedColor: string | null;
  status: string;
}): ResolvedVehicleImage | null {
  if (!asset.sourceUrl || asset.status !== "MANUAL") return null;
  return {
    assetId: asset.id,
    vehicleId: asset.vehicleId,
    provider: asset.provider,
    sourceUrl: asset.sourceUrl,
    proxyUrl: `/api/vehicle-images/${encodeURIComponent(asset.id)}`,
    confidence: asset.matchConfidence ?? 100,
    angle: asset.angle,
    requestedColor: asset.requestedColor,
    status: "MANUAL",
  };
}

type VehicleImageIdentity = {
  brand: string | null;
  model: string | null;
  year: number | null;
  bodyType: string | null;
};

async function findCompatibleReadyLibraryAsset(
  vehicle: VehicleImageIdentity,
  normalizedColor: string | null | undefined,
) {
  const make = vehicle.brand?.trim();
  const model = vehicle.model?.trim();
  const color = normalizedColor?.trim();
  if (!make || !model || !color) return null;

  try {
    const result = await getSqlPool().query(
      `SELECT "id"
         FROM public."VehicleImageLibraryAsset"
        WHERE "status"='READY'
          AND "imageData" IS NOT NULL
          AND "imageMimeType"='image/webp'
          AND COALESCE("imageSizeBytes", octet_length("imageData")) <= 102400
          AND lower(trim("make"))=lower(trim($1))
          AND lower(trim("model"))=lower(trim($2))
          AND "year" IS NOT DISTINCT FROM $3::integer
          AND lower(trim(COALESCE("bodyType",'')))=lower(trim(COALESCE($4,'')))
          AND ("normalizedColor"=$5 OR "variantKey"=$6)
          AND COALESCE("reviewStatus",'PENDING') <> 'REJECTED'
        ORDER BY
          CASE WHEN "variantKey"=$6 THEN 0 ELSE 1 END,
          "updatedAt" DESC
        LIMIT 1`,
      [make, model, vehicle.year, vehicle.bodyType || "", color, `real:${color}`],
    );
    return result.rowCount ? String((result.rows[0] as { id: string }).id) : null;
  } catch (error) {
    console.warn("compatible vehicle image lookup failed", {
      make,
      model,
      year: vehicle.year,
      bodyType: vehicle.bodyType,
      normalizedColor: color,
      message: error instanceof Error ? error.message : "unknown error",
    });
    return null;
  }
}

export async function resolveVehicleImage(vehicleId: string, options?: { themePaint?: string | null; force?: boolean }) {
  const prisma = getPrisma();
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: {
      id: true,
      brand: true,
      model: true,
      year: true,
      bodyType: true,
      vehicleImages: {
        where: { status: "MANUAL" },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          id: true,
          vehicleId: true,
          provider: true,
          sourceUrl: true,
          matchConfidence: true,
          angle: true,
          requestedColor: true,
          status: true,
        },
      },
    },
  });
  if (!vehicle) return null;

  const manual = vehicle.vehicleImages[0];
  if (manual) return asManualResolved(manual);

  const state = await getVehicleImageDeliveryState(vehicleId, options?.themePaint);
  let assetId = state.state === "READY" && state.assetId ? state.assetId : null;

  // Library identities can evolve when prompt/template rules or generation catalog
  // data change. Never show a synthetic placeholder if we already have a reviewed,
  // delivery-ready image for the exact make/model/year/body/color combination.
  if (!assetId) {
    assetId = await findCompatibleReadyLibraryAsset(
      { brand: vehicle.brand, model: vehicle.model, year: vehicle.year, bodyType: vehicle.bodyType },
      state.normalizedColor,
    );
  }

  if (!assetId) return null;
  const proxyUrl = `/api/vehicle-images/${encodeURIComponent(assetId)}`;
  return {
    assetId,
    vehicleId,
    provider: "OPENAI",
    sourceUrl: proxyUrl,
    proxyUrl,
    confidence: 100,
    angle: "front-three-quarter-right",
    requestedColor: options?.themePaint || null,
    status: "READY" as const,
  };
}

export async function invalidateVehicleImages(vehicleId: string) {
  // The OpenAI library is shared between vehicles, so changing one vehicle must never
  // delete a shared model image. Only old per-vehicle provider cache entries are cleared.
  await getPrisma().vehicleImageAsset.deleteMany({ where: { vehicleId, status: { not: "MANUAL" } } });
}

export async function markVehicleImageFailure(assetId: string, message: string) {
  await getPrisma().vehicleImageAsset.update({
    where: { id: assetId },
    data: {
      status: "ERROR",
      lastError: message.slice(0, 2000),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  }).catch(() => undefined);
}

export async function getVehicleImageAsset(assetId: string) {
  return getPrisma().vehicleImageAsset.findUnique({
    where: { id: assetId },
    select: {
      id: true,
      vehicleId: true,
      provider: true,
      sourceUrl: true,
      status: true,
      make: true,
      model: true,
      year: true,
      bodyType: true,
      requestedColor: true,
    },
  });
}

export async function testVehicleImageConnection() {
  return testOpenAIVehicleImageConnection();
}
