import { parseVehicleIdentityInput, type VehicleIdentityInputType } from "@/src/lib/vehicle-identity";
import { lookupVehicleByPlate, type GlobalVehicleLookupResponse } from "@/src/services/vehicle-lookup.service";
import { decodeVinIntelligence, type VinIntelligence } from "@/src/services/vin-intelligence.service";

export type PublicVehicleIdentityState = "PARTIAL" | "ASSISTED";

export type PublicVehicleIdentityContext = {
  state: PublicVehicleIdentityState;
  inputType: VehicleIdentityInputType;
  maskedIdentifier: string;
  confidence: number;
  source: string;
  vehicle: {
    make: string | null;
    model: string | null;
    year: number | null;
    engine: string | null;
    engineVolumeL: number | null;
    fuelType: string | null;
    bodyType: string | null;
    driveType: string | null;
    transmission: string | null;
  } | null;
  vinAvailable: boolean;
  canonicalReferenceReady: false;
  exactFitmentReady: false;
  needsVin: boolean;
  message: string;
};

type UnifiedVehicleIdentityDependencies = {
  lookupByPlate: typeof lookupVehicleByPlate;
  decodeVin: typeof decodeVinIntelligence;
};

const defaultDependencies: UnifiedVehicleIdentityDependencies = {
  lookupByPlate: lookupVehicleByPlate,
  decodeVin: decodeVinIntelligence,
};

function fromVin(
  inputType: VehicleIdentityInputType,
  maskedIdentifier: string,
  result: VinIntelligence,
  fallbackSource?: string,
): PublicVehicleIdentityContext {
  if (result.status !== "FOUND" || !result.vehicle) {
    return {
      state: "ASSISTED",
      inputType,
      maskedIdentifier,
      confidence: 0,
      source: result.sourceDetail || fallbackSource || "VIN",
      vehicle: null,
      vinAvailable: true,
      canonicalReferenceReady: false,
      exactFitmentReady: false,
      needsVin: false,
      message: "VIN розпізнано, але конфігурацію авто не вдалося визначити автоматично. Потрібна допомога майстра.",
    };
  }

  return {
    state: "PARTIAL",
    inputType,
    maskedIdentifier,
    confidence: result.confidence,
    source: result.sourceDetail || fallbackSource || "VIN",
    vehicle: {
      make: result.vehicle.make,
      model: result.vehicle.model,
      year: result.vehicle.year,
      engine: result.vehicle.engine,
      engineVolumeL: result.vehicle.engineVolumeL,
      fuelType: result.vehicle.fuelType,
      bodyType: result.vehicle.bodyType,
      driveType: result.vehicle.driveType,
      transmission: result.vehicle.transmission,
    },
    vinAvailable: true,
    canonicalReferenceReady: false,
    exactFitmentReady: false,
    needsVin: false,
    message: "Авто визначене по VIN. Точний товарний fitment стане VERIFIED після зв’язування з canonical VehicleReference.",
  };
}

function fromPlateOnly(maskedIdentifier: string, result: GlobalVehicleLookupResponse): PublicVehicleIdentityContext {
  if (result.status !== "FOUND" || !result.vehicle) {
    return {
      state: "ASSISTED",
      inputType: "PLATE",
      maskedIdentifier,
      confidence: 0,
      source: result.lookupLevel,
      vehicle: null,
      vinAvailable: false,
      canonicalReferenceReady: false,
      exactFitmentReady: false,
      needsVin: true,
      message: "Авто за номером не знайдено автоматично. Можна ввести VIN або передати запит майстру.",
    };
  }

  return {
    state: "PARTIAL",
    inputType: "PLATE",
    maskedIdentifier,
    confidence: result.vehicle.vehicleDataConfidence ?? 0,
    source: result.lookupLevel,
    vehicle: {
      make: result.vehicle.make,
      model: result.vehicle.model,
      year: result.vehicle.year,
      engine: result.vehicle.engine,
      engineVolumeL: result.vehicle.engineVolumeL,
      fuelType: result.vehicle.fuelType,
      bodyType: result.vehicle.bodyType,
      driveType: result.vehicle.driveType,
      transmission: null,
    },
    vinAvailable: Boolean(result.vehicle.vin),
    canonicalReferenceReady: false,
    exactFitmentReady: false,
    needsVin: !result.vehicle.vin,
    message: result.vehicle.vin
      ? "Авто знайдене за номером. VIN доступний і буде використаний для уточнення конфігурації."
      : "Авто знайдене за номером, але для точного підбору запчастин потрібен VIN.",
  };
}

function normalizeComparable(value: string | null | undefined) {
  return String(value ?? "").toUpperCase().replace(/[^A-ZА-ЯІЇЄ0-9]/g, "");
}

function labelsCompatible(left: string | null | undefined, right: string | null | undefined) {
  const a = normalizeComparable(left);
  const b = normalizeComparable(right);
  if (!a || !b) return true;
  return a === b || a.includes(b) || b.includes(a);
}

function plateVinConflicts(plateResult: GlobalVehicleLookupResponse, decoded: VinIntelligence) {
  if (plateResult.status !== "FOUND" || !plateResult.vehicle || decoded.status !== "FOUND" || !decoded.vehicle) return [];
  const conflicts: string[] = [];
  if (!labelsCompatible(plateResult.vehicle.model, decoded.vehicle.model)) conflicts.push("MODEL");
  if (plateResult.vehicle.year != null && decoded.vehicle.year != null && plateResult.vehicle.year !== decoded.vehicle.year) conflicts.push("YEAR");
  return conflicts;
}

function conflictContext(
  maskedIdentifier: string,
  plateResult: GlobalVehicleLookupResponse,
  decoded: VinIntelligence,
  conflicts: string[],
): PublicVehicleIdentityContext {
  return {
    state: "ASSISTED",
    inputType: "PLATE",
    maskedIdentifier,
    confidence: 0,
    source: `${plateResult.lookupLevel}→${decoded.sourceDetail || "VIN"}→CONFLICT`,
    vehicle: null,
    vinAvailable: true,
    canonicalReferenceReady: false,
    exactFitmentReady: false,
    needsVin: false,
    message: `Дані державного номера і VIN суперечать одне одному (${conflicts.join(", ")}). Автомобіль потрібно перевірити перед підбором запчастин.`,
  };
}

export async function resolveUnifiedVehicleIdentity(
  rawInput: string,
  options: { deepPlateLookup?: boolean; forceVinRefresh?: boolean } = {},
  dependencies: UnifiedVehicleIdentityDependencies = defaultDependencies,
): Promise<PublicVehicleIdentityContext> {
  const parsed = parseVehicleIdentityInput(rawInput);

  if (parsed.type === "VIN") {
    const decoded = await dependencies.decodeVin(parsed.normalized, { forceRefresh: options.forceVinRefresh });
    return fromVin("VIN", parsed.masked, decoded);
  }

  const plateResult = await dependencies.lookupByPlate(parsed.normalized, { deep: options.deepPlateLookup });
  const plateContext = fromPlateOnly(parsed.masked, plateResult);
  if (plateResult.status !== "FOUND" || !plateResult.vehicle?.vin) return plateContext;

  try {
    const decoded = await dependencies.decodeVin(plateResult.vehicle.vin);
    const conflicts = plateVinConflicts(plateResult, decoded);
    if (conflicts.length) return conflictContext(parsed.masked, plateResult, decoded, conflicts);

    const vinContext = fromVin("PLATE", parsed.masked, decoded, plateResult.lookupLevel);
    return {
      ...vinContext,
      source: `${plateResult.lookupLevel}→${decoded.sourceDetail}`,
      message:
        decoded.status === "FOUND"
          ? "Авто знайдене за номером, VIN підтягнуто автоматично та використано для уточнення конфігурації. Точний fitment буде доступний після canonical VehicleReference."
          : plateContext.message,
    };
  } catch {
    return {
      ...plateContext,
      message: "Авто знайдене за номером, але VIN-уточнення тимчасово недоступне. Для СТО контекст можна використати, для точного підбору запчастин потрібна повторна VIN-перевірка.",
    };
  }
}
