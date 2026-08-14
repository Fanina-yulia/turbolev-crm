import { getPrisma } from "@/src/lib/prisma";
import { validateVin, type VinRegion } from "@/src/domain/vin";

export type VinVehicle = {
  vin: string;
  wmi: string | null;
  region: VinRegion;
  make: string | null;
  model: string | null;
  year: number | null;
  trim: string | null;
  series: string | null;
  bodyType: string | null;
  vehicleType: string | null;
  engine: string | null;
  engineVolumeL: number | null;
  cylinders: number | null;
  fuelType: string | null;
  secondaryFuelType: string | null;
  driveType: string | null;
  transmission: string | null;
  plantCountry: string | null;
  plantCompany: string | null;
  manufacturer: string | null;
};

export type FieldConfidence = Record<keyof Omit<VinVehicle, "vin"> | "vin", number>;

export type VinIntelligence = {
  status: "FOUND" | "NOT_FOUND";
  vin: string;
  source: "CACHE" | "VPIC_LOCAL" | "NHTSA_VPIC_API";
  sourceDetail: string;
  confidence: number;
  fieldConfidence: FieldConfidence;
  validation: ReturnType<typeof validateVin>;
  warning: string | null;
  vehicle: VinVehicle | null;
  cached: boolean;
};

const VPIC_API = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues";
const CACHE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function text(value: unknown) {
  const result = String(value ?? "").trim();
  return result || null;
}

function numberOrNull(value: unknown) {
  const normalized = String(value ?? "").replace(",", ".").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getCaseInsensitive(row: Record<string, unknown>, ...names: string[]) {
  const map = new Map(Object.entries(row).map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]/g, ""), value]));
  for (const name of names) {
    const value = map.get(name.toLowerCase().replace(/[^a-z0-9]/g, ""));
    if (value !== undefined) return value;
  }
  return undefined;
}

function baseConfidence(vehicle: VinVehicle, providerPenalty = 0): FieldConfidence {
  const score = (value: unknown, strong: number, weak = 0) => value != null && value !== "" ? Math.max(0, strong - providerPenalty) : weak;
  return {
    vin: 100,
    wmi: score(vehicle.wmi, 100),
    region: score(vehicle.region !== "UNKNOWN" ? vehicle.region : null, 96),
    make: score(vehicle.make, 98),
    model: score(vehicle.model, 96),
    year: score(vehicle.year, 96),
    trim: score(vehicle.trim, 78),
    series: score(vehicle.series, 80),
    bodyType: score(vehicle.bodyType, 90),
    vehicleType: score(vehicle.vehicleType, 90),
    engine: score(vehicle.engine, 84),
    engineVolumeL: score(vehicle.engineVolumeL, 90),
    cylinders: score(vehicle.cylinders, 88),
    fuelType: score(vehicle.fuelType, 90),
    secondaryFuelType: score(vehicle.secondaryFuelType, 82),
    driveType: score(vehicle.driveType, 86),
    transmission: score(vehicle.transmission, 84),
    plantCountry: score(vehicle.plantCountry, 92),
    plantCompany: score(vehicle.plantCompany, 82),
    manufacturer: score(vehicle.manufacturer, 94),
  };
}

function overallConfidence(fields: FieldConfidence) {
  const core = [fields.vin, fields.make, fields.model, fields.year, fields.engineVolumeL, fields.fuelType];
  const present = core.filter((value) => value > 0);
  if (!present.length) return 0;
  return Math.round(present.reduce((sum, value) => sum + value, 0) / present.length);
}

function normalizeFlatVehicle(vin: string, row: Record<string, unknown>, validation: ReturnType<typeof validateVin>): VinVehicle {
  const transmissionStyle = text(getCaseInsensitive(row, "TransmissionStyle", "Transmission Style"));
  const transmissionSpeeds = text(getCaseInsensitive(row, "TransmissionSpeeds", "Transmission Speeds"));
  return {
    vin,
    wmi: validation.wmi,
    region: validation.region,
    make: text(getCaseInsensitive(row, "Make")),
    model: text(getCaseInsensitive(row, "Model")),
    year: numberOrNull(getCaseInsensitive(row, "ModelYear", "Model Year")),
    trim: text(getCaseInsensitive(row, "Trim")),
    series: text(getCaseInsensitive(row, "Series")),
    bodyType: text(getCaseInsensitive(row, "BodyClass", "Body Class")),
    vehicleType: text(getCaseInsensitive(row, "VehicleType", "Vehicle Type")),
    engine: text(getCaseInsensitive(row, "EngineModel", "Engine Model")),
    engineVolumeL: numberOrNull(getCaseInsensitive(row, "DisplacementL", "Displacement (L)", "Displacement L")),
    cylinders: numberOrNull(getCaseInsensitive(row, "EngineCylinders", "Engine Cylinders")),
    fuelType: text(getCaseInsensitive(row, "FuelTypePrimary", "Fuel Type - Primary")),
    secondaryFuelType: text(getCaseInsensitive(row, "FuelTypeSecondary", "Fuel Type - Secondary")),
    driveType: text(getCaseInsensitive(row, "DriveType", "Drive Type")),
    transmission: [transmissionStyle, transmissionSpeeds ? `${transmissionSpeeds} ст.` : null].filter(Boolean).join(" · ") || null,
    plantCountry: text(getCaseInsensitive(row, "PlantCountry", "Plant Country")),
    plantCompany: text(getCaseInsensitive(row, "PlantCompanyName", "Plant Company Name")),
    manufacturer: text(getCaseInsensitive(row, "Manufacturer", "Manufacturer Name")),
  };
}

function normalizeLocalRows(vin: string, rows: Record<string, unknown>[], validation: ReturnType<typeof validateVin>) {
  if (!rows.length) return null;
  if (getCaseInsensitive(rows[0], "Make", "Model", "ModelYear") !== undefined) {
    return normalizeFlatVehicle(vin, rows[0], validation);
  }

  const flat: Record<string, unknown> = {};
  for (const row of rows) {
    const variable = text(getCaseInsensitive(row, "Variable", "VariableName", "Element", "Name"));
    const value = getCaseInsensitive(row, "Value", "Attribute", "DecodedValue");
    if (variable && value != null && String(value).trim()) flat[variable] = value;
  }
  return Object.keys(flat).length ? normalizeFlatVehicle(vin, flat, validation) : null;
}

function useful(vehicle: VinVehicle | null) {
  return Boolean(vehicle && (vehicle.make || vehicle.model || vehicle.year || vehicle.manufacturer));
}

async function readCache(vin: string): Promise<VinIntelligence | null> {
  try {
    const prisma = getPrisma();
    const cached = await prisma.vinDecodeCache.findUnique({ where: { vin } });
    if (!cached) return null;
    if (cached.expiresAt && cached.expiresAt.getTime() < Date.now()) return null;
    return {
      status: "FOUND",
      vin,
      source: "CACHE",
      sourceDetail: cached.source,
      confidence: cached.confidence,
      fieldConfidence: cached.fieldConfidence as unknown as FieldConfidence,
      validation: cached.validation as unknown as ReturnType<typeof validateVin>,
      warning: cached.lastError,
      vehicle: cached.vehicle as unknown as VinVehicle,
      cached: true,
    };
  } catch (error) {
    console.warn("VIN cache read skipped", error);
    return null;
  }
}

async function writeCache(result: VinIntelligence) {
  if (!result.vehicle || result.status !== "FOUND") return;
  try {
    const prisma = getPrisma();
    await prisma.vinDecodeCache.upsert({
      where: { vin: result.vin },
      create: {
        vin: result.vin,
        source: result.sourceDetail,
        providerVersion: process.env.VPIC_PROVIDER_VERSION?.trim() || null,
        confidence: result.confidence,
        vehicle: result.vehicle as never,
        fieldConfidence: result.fieldConfidence as never,
        validation: result.validation as never,
        decodedAt: new Date(),
        expiresAt: new Date(Date.now() + CACHE_TTL_MS),
        lastError: result.warning,
      },
      update: {
        source: result.sourceDetail,
        providerVersion: process.env.VPIC_PROVIDER_VERSION?.trim() || null,
        confidence: result.confidence,
        vehicle: result.vehicle as never,
        fieldConfidence: result.fieldConfidence as never,
        validation: result.validation as never,
        decodedAt: new Date(),
        expiresAt: new Date(Date.now() + CACHE_TTL_MS),
        lastError: result.warning,
      },
    });
  } catch (error) {
    console.warn("VIN cache write skipped", error);
  }
}

async function decodeLocal(vin: string, validation: ReturnType<typeof validateVin>): Promise<VinIntelligence | null> {
  if (process.env.VPIC_LOCAL_ENABLED !== "true") return null;
  try {
    const prisma = getPrisma();
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>("SELECT * FROM vpic.spVinDecode($1)", vin);
    const vehicle = normalizeLocalRows(vin, rows, validation);
    if (!useful(vehicle)) return null;
    const fieldConfidence = baseConfidence(vehicle!);
    return {
      status: "FOUND",
      vin,
      source: "VPIC_LOCAL",
      sourceDetail: "NHTSA_VPIC_LOCAL_POSTGRES",
      confidence: overallConfidence(fieldConfidence),
      fieldConfidence,
      validation,
      warning: validation.region === "EUROPE" ? "Для суто європейських модифікацій vPIC може повертати неповні дані." : null,
      vehicle,
      cached: false,
    };
  } catch (error) {
    console.warn("Local vPIC decode unavailable; falling back to API", error);
    return null;
  }
}

async function decodeApi(vin: string, validation: ReturnType<typeof validateVin>): Promise<VinIntelligence> {
  const response = await fetch(`${VPIC_API}/${encodeURIComponent(vin)}?format=json`, {
    headers: { "User-Agent": "TurboLEV-CRM/2.0" },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`vPIC HTTP ${response.status}`);
  const payload = await response.json();
  const row = Array.isArray(payload?.Results) ? payload.Results[0] as Record<string, unknown> | undefined : undefined;
  if (!row) {
    return { status: "NOT_FOUND", vin, source: "NHTSA_VPIC_API", sourceDetail: "NHTSA_VPIC_API", confidence: 0, fieldConfidence: baseConfidence({ vin, wmi: validation.wmi, region: validation.region, make: null, model: null, year: null, trim: null, series: null, bodyType: null, vehicleType: null, engine: null, engineVolumeL: null, cylinders: null, fuelType: null, secondaryFuelType: null, driveType: null, transmission: null, plantCountry: null, plantCompany: null, manufacturer: null }), validation, warning: null, vehicle: null, cached: false };
  }

  const vehicle = normalizeFlatVehicle(vin, row, validation);
  const errorCode = text(getCaseInsensitive(row, "ErrorCode"));
  const errorText = text(getCaseInsensitive(row, "ErrorText"));
  const penalty = errorCode && errorCode !== "0" ? 8 : 0;
  const fieldConfidence = baseConfidence(vehicle, penalty);
  const warnings = [
    errorCode && errorCode !== "0" ? errorText : null,
    validation.region === "EUROPE" ? "vPIC орієнтований на транспорт, заявлений для ринку/імпорту США; європейська комплектація може бути неповною." : null,
    ...validation.warnings,
  ].filter(Boolean);

  return {
    status: useful(vehicle) ? "FOUND" : "NOT_FOUND",
    vin,
    source: "NHTSA_VPIC_API",
    sourceDetail: "NHTSA_VPIC_API",
    confidence: useful(vehicle) ? overallConfidence(fieldConfidence) : 0,
    fieldConfidence,
    validation,
    warning: warnings.join(" ") || null,
    vehicle: useful(vehicle) ? vehicle : null,
    cached: false,
  };
}

export async function decodeVinIntelligence(rawVin: string, options: { forceRefresh?: boolean } = {}): Promise<VinIntelligence> {
  const validation = validateVin(rawVin);
  if (!validation.formatValid) throw new Error("INVALID_VIN_FORMAT");
  if (validation.northAmerican && validation.checkDigit.status === "INVALID") throw new Error("INVALID_VIN_CHECK_DIGIT");

  if (!options.forceRefresh) {
    const cached = await readCache(validation.vin);
    if (cached) return cached;
  }

  const local = await decodeLocal(validation.vin, validation);
  if (local) {
    await writeCache(local);
    return local;
  }

  const api = await decodeApi(validation.vin, validation);
  if (api.status === "FOUND") await writeCache(api);
  return api;
}
