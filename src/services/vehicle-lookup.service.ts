import { getPrisma } from "@/src/lib/prisma";
import {
  classifyVehicle,
  TURBO_LEV_CLASS_LABELS,
  type TurboLevClass,
  type VehicleType,
} from "@/src/domain/vehicle-intelligence";
import { lookupMvsOpenDataByPlate, MVS_OPEN_DATA_SOURCE_URL } from "@/src/services/mvs-open-data.provider";

export function normalizeRegistrationPlate(value: string) {
  return value.toUpperCase().replace(/[^A-ZА-ЯІЇЄ0-9]/g, "").slice(0, 10);
}

export type GlobalVehicleLookupResponse = {
  status: "FOUND" | "NOT_FOUND";
  lookupLevel: "CRM" | "MVS_OPEN_DATA" | "EXTERNAL_REQUIRED";
  plate: string;
  message?: string;
  attributionUrl?: string;
  vehicle?: {
    id: string | null;
    clientId: string | null;
    clientName: string | null;
    clientPhone: string | null;
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
    registrationDate?: string | null;
    sourceYear?: number | null;
  };
};

async function lookupCrmVehicle(plate: string): Promise<GlobalVehicleLookupResponse | null> {
  try {
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

    if (!vehicle) return null;

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
  } catch (error) {
    // CRM DB can be temporarily unavailable during deployment; free MVS lookup still works.
    console.warn("CRM vehicle lookup unavailable, falling back to MVS open data", error);
    return null;
  }
}

export async function lookupVehicleByPlate(rawPlate: string): Promise<GlobalVehicleLookupResponse> {
  const plate = normalizeRegistrationPlate(rawPlate);
  if (plate.length < 6) {
    return { status: "NOT_FOUND", lookupLevel: "EXTERNAL_REQUIRED", plate };
  }

  const crm = await lookupCrmVehicle(plate);
  if (crm) return crm;

  try {
    const mvs = await lookupMvsOpenDataByPlate(plate);
    if (mvs) {
      const classification = classifyVehicle({
        make: mvs.make,
        model: mvs.model,
        year: mvs.year,
        engine: mvs.engine,
        engineVolume: mvs.engineVolume,
        fuelType: mvs.fuelType,
        bodyType: `${mvs.kind ?? ""} ${mvs.bodyType ?? ""}`.trim(),
        grossWeight: mvs.grossWeight,
        vehicleType: mvs.vehicleType,
      });
      const engineVolumeL = mvs.engineVolume ? Number.parseFloat(mvs.engineVolume) : null;
      const year = mvs.year ? Number.parseInt(mvs.year, 10) : null;
      const grossWeightKg = mvs.grossWeight ? Number.parseInt(mvs.grossWeight.replace(/[^0-9]/g, ""), 10) : null;

      return {
        status: "FOUND",
        lookupLevel: "MVS_OPEN_DATA",
        plate,
        attributionUrl: MVS_OPEN_DATA_SOURCE_URL,
        message: "Знайдено у безкоштовних відкритих даних МВС України",
        vehicle: {
          id: null,
          clientId: null,
          clientName: null,
          clientPhone: null,
          vin: mvs.vin || null,
          make: mvs.make || null,
          model: mvs.model || null,
          year: Number.isFinite(year) ? year : null,
          mileageKm: null,
          engine: mvs.engine || null,
          engineVolumeCm3: engineVolumeL ? Math.round(engineVolumeL * 1000) : null,
          engineVolumeL: Number.isFinite(engineVolumeL) ? engineVolumeL : null,
          fuelType: mvs.fuelType || null,
          bodyType: mvs.bodyType || mvs.kind || null,
          grossWeightKg: Number.isFinite(grossWeightKg) ? grossWeightKg : null,
          driveType: null,
          vehicleType: classification.vehicleType,
          turboLevClass: classification.turboLevClass,
          turboLevClassLabel: TURBO_LEV_CLASS_LABELS[classification.turboLevClass],
          priceCoefficient: classification.priceCoefficient,
          classificationSource: "MVS_OPEN_DATA+RULES",
          classificationConfidence: classification.confidence,
          classificationReason: classification.reason,
          manualClassOverride: false,
          vehicleDataSource: "MVS_OPEN_DATA",
          vehicleDataConfidence: mvs.confidence,
          registrationDate: mvs.registrationDate || null,
          sourceYear: mvs.sourceYear,
        },
      };
    }
  } catch (error) {
    console.warn("MVS open-data lookup failed", error);
  }

  return {
    status: "NOT_FOUND",
    lookupLevel: "EXTERNAL_REQUIRED",
    plate,
    attributionUrl: MVS_OPEN_DATA_SOURCE_URL,
    message:
      "Авто не знайдено у CRM або в актуальному відкритому ресурсі МВС. VIN можна ввести вручну; історичний індекс додамо окремо.",
  };
}
