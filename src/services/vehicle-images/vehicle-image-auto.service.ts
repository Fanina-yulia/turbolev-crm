import "server-only";

import { getPrisma } from "@/src/lib/prisma";
import { resolveVehicleColorByPlate } from "@/src/services/vehicle-registry-color.service";
import { lookupVehicleByPlate } from "@/src/services/vehicle-lookup.service";
import { decodeVinIntelligence } from "@/src/services/vin-intelligence.service";
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
      vin: true,
      exteriorColorConfirmed: true,
    },
  });

  if (!vehicle) return { state: "MISSING_DATA" as const, assetId: null, libraryKey: null, error: "Автомобіль не знайдено." };
  const plate = vehicle.plateNormalized || vehicle.plateNumber;
  if ((!vehicle.brand?.trim() || !vehicle.model?.trim()) && plate) {
    try {
      const lookup = await lookupVehicleByPlate(plate, { deep: true });
      const found = lookup.status === "FOUND" ? lookup.vehicle : null;
      if (found?.make && found.model) {
        vehicle = await prisma.vehicle.update({ where: { id: vehicle.id }, data: { brand: found.make, model: found.model, year: found.year ?? undefined, vin: found.vin ?? undefined, vehicleDataSource: found.vehicleDataSource || "MVS_INDEX", vehicleDataConfidence: found.vehicleDataConfidence ?? 80 } });
      }
    } catch (error) {
      console.warn("vehicle image plate enrichment failed", { vehicleId, message: error instanceof Error ? error.message : "unknown error" });
    }
  }
  if ((!vehicle.brand?.trim() || !vehicle.model?.trim()) && vehicle.vin?.trim()) {
    try {
      const decoded = await decodeVinIntelligence(vehicle.vin.trim());
      if (decoded.status === "FOUND" && decoded.vehicle?.make && decoded.vehicle.model) {
        const found = decoded.vehicle;
        vehicle = await prisma.vehicle.update({ where: { id: vehicle.id }, data: { brand: found.make, model: found.model, year: found.year ?? undefined, bodyType: found.bodyType ?? undefined, engineName: found.engine ?? undefined, engineVolumeCm3: found.engineVolumeL ? Math.round(found.engineVolumeL * 1000) : undefined, fuelType: found.fuelType ?? undefined, driveType: found.driveType ?? undefined, vehicleType: found.vehicleType ?? undefined, vehicleDataSource: decoded.sourceDetail, vehicleDataConfidence: decoded.confidence } });
      }
    } catch (error) {
      console.warn("vehicle image VIN enrichment failed", { vehicleId, message: error instanceof Error ? error.message : "unknown error" });
    }
  }
  if (!vehicle.brand?.trim() || !vehicle.model?.trim()) {
    return { state: "MISSING_DATA" as const, assetId: null, libraryKey: null, error: "Для генерації потрібні марка і модель." };
  }

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

  // A newly created vehicle should start generation immediately. The caller
  // invokes this service from Next.js `after()`, so the API response is not
  // blocked while the image provider is running.
  return generateVehicleImageInBackground(vehicleId);
}
