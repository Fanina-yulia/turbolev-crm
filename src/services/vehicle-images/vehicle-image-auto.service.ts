import "server-only";

import { getPrisma } from "@/src/lib/prisma";
import { resolveVehicleColorByPlate } from "@/src/services/vehicle-registry-color.service";
import { generateVehicleImageInBackground } from "./vehicle-image-background.service";

/**
 * Automatic image entry point for persisted CRM vehicles.
 * It enriches a missing real color from the registry first, then delegates to the
 * shared model-template/color-variant library. Failures in registry enrichment do
 * not block image generation or the business workflow.
 */
export async function autoGenerateVehicleImage(vehicleId: string) {
  const prisma = getPrisma();
  let vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: {
      id: true,
      brand: true,
      model: true,
      plateNumber: true,
      plateNormalized: true,
      exteriorColorConfirmed: true,
    },
  });

  if (!vehicle) return { state: "MISSING_DATA" as const, assetId: null, libraryKey: null, error: "Автомобіль не знайдено." };
  if (!vehicle.brand?.trim() || !vehicle.model?.trim()) {
    return { state: "MISSING_DATA" as const, assetId: null, libraryKey: null, error: "Для генерації потрібні марка і модель." };
  }

  const plate = vehicle.plateNormalized || vehicle.plateNumber;
  if (!vehicle.exteriorColorConfirmed && plate) {
    try {
      const resolvedColor = await resolveVehicleColorByPlate(plate, vehicle.id);
      if (resolvedColor) {
        await prisma.vehicle.update({
          where: { id: vehicle.id },
          data: {
            exteriorColorName: resolvedColor.exteriorColorName,
            exteriorColorHex: resolvedColor.exteriorColorHex,
            exteriorPaintCode: resolvedColor.exteriorPaintCode,
            exteriorColorSource: resolvedColor.exteriorColorSource as "USER" | "VIN" | "REGISTRY" | "PROVIDER" | "THEME" | "UNKNOWN",
            exteriorColorConfirmed: true,
          },
        });
        vehicle = { ...vehicle, exteriorColorConfirmed: true };
      }
    } catch (error) {
      console.warn("automatic vehicle image color enrichment failed", {
        vehicleId,
        plate,
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
  }

  return generateVehicleImageInBackground(vehicleId);
}
