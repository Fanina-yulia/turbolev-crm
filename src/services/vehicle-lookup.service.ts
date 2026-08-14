import { getPrisma } from "@/src/lib/prisma";
import {
  classifyVehicle,
  TURBO_LEV_CLASS_LABELS,
  type TurboLevClass,
  type VehicleType,
} from "@/src/domain/vehicle-intelligence";

export function normalizeRegistrationPlate(value: string) {
  return value.toUpperCase().replace(/[^A-ZА-ЯІЇЄ0-9]/g, "").slice(0, 10);
}

export type GlobalVehicleLookupResponse = {
  status: "FOUND" | "NOT_FOUND";
  lookupLevel: "CRM" | "EXTERNAL_REQUIRED";
  plate: string;
  vehicle?: {
    id: string;
    clientId: string;
    clientName: string | null;
    clientPhone: string;
    vin: string | null;
    make: string | null;
    model: string | null;
    year: number | null;
    mileageKm: number | null;
    engine: string | null;
    engineVolumeCm3: number | null;
    engineVolumeL: number | null;
    fuelType: string | null;
    bodyType: string | null;
    grossWeightKg: number | null;
    driveType: string | null;
    vehicleType: VehicleType;
    turboLevClass: TurboLevClass;
    turboLevClassLabel: string;
    priceCoefficient: number;
    classificationSource: string;
    classificationConfidence: number;
    classificationReason: string;
    manualClassOverride: boolean;
    vehicleDataSource: string;
    vehicleDataConfidence: number;
  };
};

export async function lookupVehicleByPlate(rawPlate: string): Promise<GlobalVehicleLookupResponse> {
  const plate = normalizeRegistrationPlate(rawPlate);
  if (plate.length < 6) {
    return { status: "NOT_FOUND", lookupLevel: "EXTERNAL_REQUIRED", plate };
  }

  const prisma = getPrisma();
  const vehicle = await prisma.vehicle.findFirst({
    where: {
      OR: [{ plateNormalized: plate }, { plateNumber: plate }],
    },
    include: {
      client: {
        select: { id: true, name: true, phone: true },
      },
    },
  });

  if (!vehicle) {
    return {
      status: "NOT_FOUND",
      lookupLevel: "EXTERNAL_REQUIRED",
      plate,
    };
  }

  const automatic = classifyVehicle({
    make: vehicle.brand ?? "",
    model: vehicle.model ?? "",
    year: vehicle.year?.toString() ?? "",
    engine: vehicle.engineName ?? "",
    engineVolume: vehicle.engineVolumeCm3 ? (vehicle.engineVolumeCm3 / 1000).toString() : "",
    fuelType: vehicle.fuelType ?? "",
    bodyType: vehicle.bodyType ?? "",
    grossWeight: vehicle.grossWeightKg?.toString() ?? "",
    driveType: vehicle.driveType ?? "",
    vehicleType: vehicle.vehicleType ?? "UNKNOWN",
  });

  const turboLevClass = (vehicle.turboLevClass as TurboLevClass | null) ?? automatic.turboLevClass;
  const vehicleType = (vehicle.vehicleType as VehicleType | null) ?? automatic.vehicleType;
  const priceCoefficient = vehicle.priceCoefficient ? Number(vehicle.priceCoefficient) : automatic.priceCoefficient;
  const classificationConfidence = vehicle.classificationConfidence ?? automatic.confidence;

  return {
    status: "FOUND",
    lookupLevel: "CRM",
    plate,
    vehicle: {
      id: vehicle.id,
      clientId: vehicle.clientId,
      clientName: vehicle.client.name,
      clientPhone: vehicle.client.phone,
      vin: vehicle.vin,
      make: vehicle.brand,
      model: vehicle.model,
      year: vehicle.year,
      mileageKm: vehicle.mileageKm,
      engine: vehicle.engineName,
      engineVolumeCm3: vehicle.engineVolumeCm3,
      engineVolumeL: vehicle.engineVolumeCm3 ? vehicle.engineVolumeCm3 / 1000 : null,
      fuelType: vehicle.fuelType,
      bodyType: vehicle.bodyType,
      grossWeightKg: vehicle.grossWeightKg,
      driveType: vehicle.driveType,
      vehicleType,
      turboLevClass,
      turboLevClassLabel: TURBO_LEV_CLASS_LABELS[turboLevClass],
      priceCoefficient,
      classificationSource: vehicle.classificationSource ?? automatic.source,
      classificationConfidence,
      classificationReason: vehicle.manualClassOverride
        ? "Клас автомобіля підтверджено або змінено вручну"
        : automatic.reason,
      manualClassOverride: vehicle.manualClassOverride,
      vehicleDataSource: vehicle.vehicleDataSource ?? "CRM",
      vehicleDataConfidence: vehicle.vehicleDataConfidence ?? 100,
    },
  };
}
