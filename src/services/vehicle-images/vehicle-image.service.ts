import { getPrisma } from "@/src/lib/prisma";
import type { ResolvedVehicleImage } from "./types";
import {
  getVehicleImageLibraryState,
  testOpenAIVehicleImageConnection,
} from "./openai-library.service";

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

export async function resolveVehicleImage(vehicleId: string, options?: { themePaint?: string | null; force?: boolean }) {
  const prisma = getPrisma();
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: {
      id: true,
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

  const state = await getVehicleImageLibraryState(vehicleId, options?.themePaint);
  if (state.state !== "READY" || !state.assetId) return null;
  const proxyUrl = `/api/vehicle-images/${encodeURIComponent(state.assetId)}`;
  return {
    assetId: state.assetId,
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
