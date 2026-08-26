import { getPrisma } from "@/src/lib/prisma";
import {
  classifyVehicle,
  TURBO_LEV_CLASS_LABELS,
  type TurboLevClass,
  type VehicleType,
} from "@/src/domain/vehicle-intelligence";
import { normalizeRegistrationPlate } from "@/src/domain/registration-plate";
import { lookupMvsOpenDataByPlate, MVS_OPEN_DATA_SOURCE_URL } from "@/src/services/mvs-open-data.provider";
import { decodeVinIntelligence } from "@/src/services/vin-intelligence.service";

export { normalizeRegistrationPlate };

export type GlobalVehicleLookupResponse = {
  status: "FOUND" | "NOT_FOUND";
  lookupLevel: "CRM" | "MVS_INDEX" | "MVS_OPEN_DATA" | "EXTERNAL_REQUIRED";
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

type CompactRegistryRow = {
  vin: string | null;
  brand: string | null;
  model: string | null;
  makeYear: number | null;
  engineVolumeCm3: number | null;
  fuelType: string | null;
  vehicleTypeRaw: string | null;
  sourceYear: number;
};

type LookupVehicle = NonNullable<GlobalVehicleLookupResponse["vehicle"]>;

function registrationPlateKey(plate: string): bigint | null {
  if (!/^[A-Z0-9]{6,10}$/.test(plate)) return null;
  let value = 0n;
  for (const char of plate) {
    const code = char.charCodeAt(0);
    const digit = code >= 48 && code <= 57 ? code - 48 : code - 65 + 10;
    if (digit < 0 || digit >= 36) return null;
    value = value * 36n + BigInt(digit);
  }
  return value * 16n + BigInt(plate.length);
}

async function lookupCrmVehicle(plate: string): Promise<GlobalVehicleLookupResponse | null> {
  const prisma = getPrisma();
  const vehicle = await prisma.vehicle.findFirst({
    where: { OR: [{ plateNormalized: plate }, { plateNumber: plate }] },
    include: { client: { select: { id: true, name: true, phone: true } } },
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
      classificationConfidence: vehicle.classificationConfidence ?? automatic.confidence,
      classificationReason: vehicle.manualClassOverride ? "Клас автомобіля підтверджено або змінено вручну" : automatic.reason,
      manualClassOverride: vehicle.manualClassOverride,
      vehicleDataSource: vehicle.vehicleDataSource ?? "CRM",
      vehicleDataConfidence: vehicle.vehicleDataConfidence ?? 100,
    },
  };
}

function mapCompactRegistryRow(plate: string, row: CompactRegistryRow): GlobalVehicleLookupResponse {
  const classification = classifyVehicle({
    make: row.brand ?? "",
    model: row.model ?? "",
    year: row.makeYear?.toString() ?? "",
    engineVolume: row.engineVolumeCm3 ? (row.engineVolumeCm3 / 1000).toString() : "",
    fuelType: row.fuelType ?? "",
    bodyType: row.vehicleTypeRaw ?? "",
  });

  return {
    status: "FOUND",
    lookupLevel: "MVS_INDEX",
    plate,
    attributionUrl: MVS_OPEN_DATA_SOURCE_URL,
    message: `Знайдено у швидкому локальному індексі МВС за ${row.sourceYear} рік`,
    vehicle: {
      id: null,
      clientId: null,
      clientName: null,
      clientPhone: null,
      vin: row.vin,
      make: row.brand,
      model: row.model,
      year: row.makeYear,
      mileageKm: null,
      engine: row.engineVolumeCm3 ? `${(row.engineVolumeCm3 / 1000).toFixed(1)} ${row.fuelType ?? ""}`.trim() : row.fuelType,
      engineVolumeCm3: row.engineVolumeCm3,
      engineVolumeL: row.engineVolumeCm3 ? row.engineVolumeCm3 / 1000 : null,
      fuelType: row.fuelType,
      bodyType: row.vehicleTypeRaw,
      grossWeightKg: null,
      driveType: null,
      vehicleType: classification.vehicleType,
      turboLevClass: classification.turboLevClass,
      turboLevClassLabel: TURBO_LEV_CLASS_LABELS[classification.turboLevClass],
      priceCoefficient: classification.priceCoefficient,
      classificationSource: "MVS_COMPACT_INDEX+RULES",
      classificationConfidence: classification.confidence,
      classificationReason: classification.reason,
      manualClassOverride: false,
      vehicleDataSource: "MVS_INDEX",
      vehicleDataConfidence: row.vin ? 96 : 90,
      registrationDate: null,
      sourceYear: row.sourceYear,
    },
  };
}

async function lookupRegistryIndex(plate: string): Promise<GlobalVehicleLookupResponse | null> {
  const prisma = getPrisma();
  const key = registrationPlateKey(plate);

  if (key !== null) {
    try {
      const rows = await prisma.$queryRaw<CompactRegistryRow[]>`
        SELECT vin, brand, model, "makeYear", "engineVolumeCm3", "fuelType", "vehicleTypeRaw", "sourceYear"
        FROM "VehicleRegistryCompact"
        WHERE "plateKey" = ${key}
        LIMIT 1
      `;
      if (rows[0]) return mapCompactRegistryRow(plate, rows[0]);
    } catch (error) {
      console.warn("Compact MVS registry is not available yet; trying legacy index", error);
    }
  }

  const row = await prisma.vehicleRegistryEntry.findUnique({ where: { plateNormalized: plate } });
  if (!row) return null;

  const classification = classifyVehicle({
    make: row.brand ?? "",
    model: row.model ?? "",
    year: row.makeYear?.toString() ?? "",
    engineVolume: row.engineVolumeCm3 ? (row.engineVolumeCm3 / 1000).toString() : "",
    fuelType: row.fuelType ?? "",
    bodyType: `${row.vehicleKind ?? ""} ${row.bodyType ?? ""}`.trim(),
    grossWeight: row.grossWeightKg?.toString() ?? "",
  });

  return {
    status: "FOUND",
    lookupLevel: "MVS_INDEX",
    plate,
    attributionUrl: MVS_OPEN_DATA_SOURCE_URL,
    message: `Знайдено у швидкому локальному індексі МВС за ${row.sourceYear} рік`,
    vehicle: {
      id: null,
      clientId: null,
      clientName: null,
      clientPhone: null,
      vin: row.vin,
      make: row.brand,
      model: row.model,
      year: row.makeYear,
      mileageKm: null,
      engine: row.engineVolumeCm3 ? `${(row.engineVolumeCm3 / 1000).toFixed(1)} ${row.fuelType ?? ""}`.trim() : row.fuelType,
      engineVolumeCm3: row.engineVolumeCm3,
      engineVolumeL: row.engineVolumeCm3 ? row.engineVolumeCm3 / 1000 : null,
      fuelType: row.fuelType,
      bodyType: row.bodyType ?? row.vehicleKind,
      grossWeightKg: row.grossWeightKg,
      driveType: null,
      vehicleType: classification.vehicleType,
      turboLevClass: classification.turboLevClass,
      turboLevClassLabel: TURBO_LEV_CLASS_LABELS[classification.turboLevClass],
      priceCoefficient: classification.priceCoefficient,
      classificationSource: "MVS_INDEX+RULES",
      classificationConfidence: classification.confidence,
      classificationReason: classification.reason,
      manualClassOverride: false,
      vehicleDataSource: "MVS_INDEX",
      vehicleDataConfidence: row.vin ? 96 : 90,
      registrationDate: row.registrationDate,
      sourceYear: row.sourceYear,
    },
  };
}

function mapLiveMvs(plate: string, mvs: Awaited<ReturnType<typeof lookupMvsOpenDataByPlate>>): GlobalVehicleLookupResponse | null {
  if (!mvs) return null;
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
    message: `Знайдено у сирому архіві МВС за ${mvs.sourceYear} рік`,
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

function mergeVehicleData(
  base: LookupVehicle,
  supplement: Partial<LookupVehicle>,
  supplementSource: string,
  supplementConfidence: number,
): LookupVehicle {
  const merged: LookupVehicle = {
    ...base,
    vin: base.vin || supplement.vin || null,
    make: base.make || supplement.make || null,
    model: base.model || supplement.model || null,
    year: base.year ?? supplement.year ?? null,
    mileageKm: base.mileageKm ?? supplement.mileageKm ?? null,
    engine: base.engine || supplement.engine || null,
    engineVolumeCm3: base.engineVolumeCm3 ?? supplement.engineVolumeCm3 ?? null,
    engineVolumeL: base.engineVolumeL ?? supplement.engineVolumeL ?? null,
    fuelType: base.fuelType || supplement.fuelType || null,
    bodyType: base.bodyType || supplement.bodyType || null,
    grossWeightKg: base.grossWeightKg ?? supplement.grossWeightKg ?? null,
    driveType: base.driveType || supplement.driveType || null,
    registrationDate: base.registrationDate || supplement.registrationDate || null,
    sourceYear: base.sourceYear ?? supplement.sourceYear ?? null,
  };
  const changed = merged.vin !== base.vin
    || merged.make !== base.make
    || merged.model !== base.model
    || merged.year !== base.year
    || merged.engineVolumeCm3 !== base.engineVolumeCm3;

  if (changed) {
    merged.vehicleDataSource = [base.vehicleDataSource, supplementSource].filter(Boolean).join("+");
    merged.vehicleDataConfidence = Math.max(base.vehicleDataConfidence, supplementConfidence);
  }

  if (!merged.manualClassOverride) {
    const classification = classifyVehicle({
      make: merged.make ?? "",
      model: merged.model ?? "",
      year: merged.year?.toString() ?? "",
      engine: merged.engine ?? "",
      engineVolume: merged.engineVolumeL?.toString() ?? "",
      fuelType: merged.fuelType ?? "",
      bodyType: merged.bodyType ?? "",
      grossWeight: merged.grossWeightKg?.toString() ?? "",
      driveType: merged.driveType ?? "",
      vehicleType: merged.vehicleType,
    });
    merged.vehicleType = classification.vehicleType;
    merged.turboLevClass = classification.turboLevClass;
    merged.turboLevClassLabel = TURBO_LEV_CLASS_LABELS[classification.turboLevClass];
    merged.priceCoefficient = classification.priceCoefficient;
    merged.classificationSource = changed
      ? `${supplementSource}+RULES`
      : merged.classificationSource;
    merged.classificationConfidence = classification.confidence;
    merged.classificationReason = classification.reason;
  }

  return merged;
}

function mergeLookupResponses(
  base: GlobalVehicleLookupResponse,
  supplement: GlobalVehicleLookupResponse,
): GlobalVehicleLookupResponse {
  if (!base.vehicle || !supplement.vehicle) return base;
  return {
    ...base,
    attributionUrl: base.attributionUrl || supplement.attributionUrl,
    message: [base.message, supplement.message].filter(Boolean).join(" · ") || undefined,
    vehicle: mergeVehicleData(
      base.vehicle,
      supplement.vehicle,
      supplement.vehicle.vehicleDataSource,
      supplement.vehicle.vehicleDataConfidence,
    ),
  };
}

async function enrichLookupByVin(result: GlobalVehicleLookupResponse): Promise<GlobalVehicleLookupResponse> {
  const current = result.vehicle;
  if (!current?.vin || (current.make && current.model)) return result;
  try {
    const decoded = await decodeVinIntelligence(current.vin);
    if (decoded.status !== "FOUND" || !decoded.vehicle) return result;
    const vehicle = decoded.vehicle;
    return {
      ...result,
      vehicle: mergeVehicleData(current, {
        vin: vehicle.vin,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        engine: vehicle.engine,
        engineVolumeCm3: vehicle.engineVolumeL ? Math.round(vehicle.engineVolumeL * 1000) : null,
        engineVolumeL: vehicle.engineVolumeL,
        fuelType: vehicle.fuelType,
        bodyType: vehicle.bodyType,
        driveType: vehicle.driveType,
      }, decoded.sourceDetail, decoded.confidence),
    };
  } catch (error) {
    console.warn("VIN enrichment after plate lookup unavailable", error);
    return result;
  }
}

export async function lookupVehicleByPlate(rawPlate: string, options?: { deep?: boolean }): Promise<GlobalVehicleLookupResponse> {
  const plate = normalizeRegistrationPlate(rawPlate);
  if (plate.length < 6) return { status: "NOT_FOUND", lookupLevel: "EXTERNAL_REQUIRED", plate };

  let crm: GlobalVehicleLookupResponse | null = null;
  try {
    crm = await lookupCrmVehicle(plate);
    if (crm?.vehicle?.make && crm.vehicle.model) return crm;
  } catch (error) {
    console.warn("CRM vehicle lookup unavailable; continuing with MVS index", error);
  }

  let indexed: GlobalVehicleLookupResponse | null = null;
  try {
    indexed = await lookupRegistryIndex(plate);
  } catch (error) {
    console.warn("MVS registry index lookup unavailable", error);
  }

  if (crm) {
    const enriched = indexed ? mergeLookupResponses(crm, indexed) : crm;
    return enrichLookupByVin(enriched);
  }
  if (indexed) return enrichLookupByVin(indexed);

  if (options?.deep) {
    try {
      const live = mapLiveMvs(plate, await lookupMvsOpenDataByPlate(plate));
      if (live) return live;
    } catch (error) {
      console.warn("Deep MVS open-data lookup failed", error);
    }
  }

  return {
    status: "NOT_FOUND",
    lookupLevel: "EXTERNAL_REQUIRED",
    plate,
    attributionUrl: MVS_OPEN_DATA_SOURCE_URL,
    message: "Авто не знайдено у швидкому індексі. Повільний перегляд ZIP-архівів не запускається автоматично.",
  };
}
