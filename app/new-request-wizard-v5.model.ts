import {
  classifyVehicle,
  inferEngineVolume,
  type TurboLevClass,
  type VehicleType,
} from "@/src/domain/vehicle-intelligence";
import type {
  ClientLookup,
  MakeOption,
  ModelOption,
  PlannerLocation,
  PlannerResource,
  RequestForm,
  UserOption,
  VehicleCandidate,
  VehicleDataStatus,
  VinApiResponse,
} from "./new-request-wizard-v5.types";

export const STORAGE_KEY = "turbolev-manual-requests-v1";
export const MANAGER_KEY = "turbolev-current-manager";

export const requestCategories = [
  "Ходова",
  "Гальма",
  "Двигун",
  "Електрика",
  "ТО / мастило",
  "Комп. діагностика",
  "Кондиціонер",
  "Інше",
];

export const requestSources = [
  "Інше",
  "Телефон",
  "Binotel",
  "Instagram",
  "Facebook",
  "TikTok",
  "OLX",
  "Сайт",
  "Google Maps",
  "Viber",
  "WhatsApp",
  "Рекомендація",
  "Заїхав без запису",
];

export const requestYears = Array.from(
  { length: new Date().getFullYear() - 1979 + 2 },
  (_, index) => String(new Date().getFullYear() + 1 - index),
);

export const initialRequestForm: RequestForm = {
  customerName: "",
  phone: "",
  source: "Інше",
  responsible: "",
  plate: "",
  vin: "",
  make: "",
  model: "",
  year: "",
  mileage: "",
  engine: "",
  engineVolume: "",
  fuelType: "",
  bodyType: "",
  grossWeight: "",
  driveType: "",
  vehicleType: "UNKNOWN",
  turboLevClass: "UNKNOWN",
  priceCoefficient: "1.00",
  classificationSource: "UNKNOWN",
  classificationConfidence: "0",
  classificationReason: "Очікуємо дані автомобіля",
  manualClassOverride: false,
  vehicleDataSource: "UNKNOWN",
  vehicleDataConfidence: "0",
  vehicleDataStatus: "UNKNOWN",
  category: "",
  complaint: "",
  appointmentDate: "",
  appointmentTime: "",
  preliminaryAmount: "",
  comment: "",
  locationId: "",
  postId: "",
  mechanicId: "",
};

const VEHICLE_TYPES = new Set<VehicleType>([
  "PASSENGER",
  "CROSSOVER",
  "SUV",
  "MINIVAN",
  "VAN_SMALL",
  "VAN",
  "VAN_LARGE",
  "COMMERCIAL_HEAVY",
  "UNKNOWN",
]);

const TURBO_LEV_CLASSES = new Set<TurboLevClass>([
  "L1",
  "L2",
  "L3",
  "C1",
  "S1",
  "M1",
  "V1",
  "V2",
  "V3",
  "V4",
  "UNKNOWN",
]);

const VEHICLE_DATA_STATUSES = new Set<VehicleDataStatus>(["UNKNOWN", "AUTO", "MANUAL", "CONFIRMED"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function finiteNumber(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizePlate(value: string) {
  return value.toUpperCase().replace(/[^A-ZА-ЯІЇЄ0-9]/g, "").slice(0, 10);
}

export function normalizeVin(value: string) {
  return value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "").slice(0, 17);
}

export function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("380")) return digits.slice(0, 12);
  if (digits.startsWith("0")) return `38${digits}`.slice(0, 12);
  if (digits.length <= 9) return `380${digits}`.slice(0, 12);
  return digits.slice(0, 12);
}

export function formatPhone(value: string) {
  const digits = normalizePhone(value);
  if (!digits) return "";
  const local = digits.startsWith("380") ? digits.slice(3, 12) : digits;
  const parts = [local.slice(0, 2), local.slice(2, 5), local.slice(5, 7), local.slice(7, 9)].filter(Boolean);
  return `+380 ${parts.join(" ")}`.trim();
}

export function classificationPatch(input: Partial<RequestForm>) {
  const result = classifyVehicle({
    make: input.make,
    model: input.model,
    year: input.year,
    engine: input.engine,
    engineVolume: input.engineVolume || inferEngineVolume(input.engine),
    fuelType: input.fuelType,
    bodyType: input.bodyType,
    grossWeight: input.grossWeight,
    driveType: input.driveType,
    vehicleType: input.vehicleType,
  });
  return {
    vehicleType: result.vehicleType,
    turboLevClass: result.turboLevClass,
    priceCoefficient: result.priceCoefficient.toFixed(2),
    classificationSource: result.source,
    classificationConfidence: String(result.confidence),
    classificationReason: result.reason,
  };
}

export function vehicleTitle(form: RequestForm) {
  return [form.make, form.model, form.year].filter(Boolean).join(" ") || form.plate || form.vin || "Автомобіль";
}

export function resolveVehicleType(value: unknown, fallback: VehicleType): VehicleType {
  return typeof value === "string" && VEHICLE_TYPES.has(value as VehicleType) ? value as VehicleType : fallback;
}

export function resolveTurboLevClass(value: unknown, fallback: TurboLevClass): TurboLevClass {
  return typeof value === "string" && TURBO_LEV_CLASSES.has(value as TurboLevClass) ? value as TurboLevClass : fallback;
}

export function resolveVehicleDataStatus(value: unknown, fallback: VehicleDataStatus): VehicleDataStatus {
  return typeof value === "string" && VEHICLE_DATA_STATUSES.has(value as VehicleDataStatus)
    ? value as VehicleDataStatus
    : fallback;
}

function parseUserOption(value: unknown): UserOption | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id).trim();
  const name = stringValue(value.name).trim();
  return id && name ? { id, name } : null;
}

export function parseUserOptions(value: unknown): UserOption[] {
  if (!Array.isArray(value)) return [];
  return value.map(parseUserOption).filter((item): item is UserOption => item !== null);
}

function parseMakeOption(value: unknown): MakeOption | null {
  if (!isRecord(value)) return null;
  const name = stringValue(value.name).trim();
  if (!name) return null;
  const id = finiteNumber(value.id);
  return { id, name };
}

export function parseMakeOptions(value: unknown): MakeOption[] {
  if (!Array.isArray(value)) return [];
  return value.map(parseMakeOption).filter((item): item is MakeOption => item !== null);
}

function parseModelOption(value: unknown): ModelOption | null {
  if (!isRecord(value)) return null;
  const name = stringValue(value.name).trim();
  const makeName = stringValue(value.makeName).trim();
  if (!name) return null;
  return { id: finiteNumber(value.id), name, makeName };
}

export function parseModelOptions(value: unknown): ModelOption[] {
  if (!Array.isArray(value)) return [];
  return value.map(parseModelOption).filter((item): item is ModelOption => item !== null);
}

function parsePlannerResource(value: unknown): PlannerResource | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id).trim();
  const name = stringValue(value.name).trim();
  return id && name ? { id, name } : null;
}

function parsePlannerLocation(value: unknown): PlannerLocation | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id).trim();
  const name = stringValue(value.name).trim();
  if (!id || !name) return null;
  const posts = Array.isArray(value.posts)
    ? value.posts.map(parsePlannerResource).filter((item): item is PlannerResource => item !== null)
    : [];
  const mechanics = Array.isArray(value.mechanics)
    ? value.mechanics.map(parsePlannerResource).filter((item): item is PlannerResource => item !== null)
    : [];
  return { id, name, posts, mechanics };
}

export function parsePlannerLocations(value: unknown): PlannerLocation[] {
  if (!Array.isArray(value)) return [];
  return value.map(parsePlannerLocation).filter((item): item is PlannerLocation => item !== null);
}

export function parseClientLookup(value: unknown): ClientLookup | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id).trim();
  const phone = stringValue(value.phone).trim();
  if (!id || !phone) return null;
  return {
    id,
    name: nullableString(value.name),
    phone,
    vehicles: [],
  };
}

export function parseVinResponse(value: unknown): VinApiResponse | null {
  if (!isRecord(value)) return null;
  const status = stringValue(value.status);
  if (!["FOUND", "NOT_FOUND", "INVALID_VIN", "LOOKUP_UNAVAILABLE"].includes(status)) return null;
  const vehicle = isRecord(value.vehicle)
    ? {
        make: nullableString(value.vehicle.make),
        model: nullableString(value.vehicle.model),
        year: finiteNumber(value.vehicle.year),
        trim: nullableString(value.vehicle.trim),
        series: nullableString(value.vehicle.series),
        bodyType: nullableString(value.vehicle.bodyType),
        vehicleType: nullableString(value.vehicle.vehicleType),
        engine: nullableString(value.vehicle.engine),
        engineVolumeL: finiteNumber(value.vehicle.engineVolumeL),
        fuelType: nullableString(value.vehicle.fuelType),
        secondaryFuelType: nullableString(value.vehicle.secondaryFuelType),
        driveType: nullableString(value.vehicle.driveType),
        transmission: nullableString(value.vehicle.transmission),
      }
    : null;
  return {
    status: status as VinApiResponse["status"],
    source: stringValue(value.source) || undefined,
    sourceDetail: stringValue(value.sourceDetail) || undefined,
    confidence: finiteNumber(value.confidence) ?? undefined,
    warning: nullableString(value.warning),
    message: stringValue(value.message) || undefined,
    vehicle,
  };
}

export function readPayloadField(payload: unknown, key: string): unknown {
  return isRecord(payload) ? payload[key] : undefined;
}

export function payloadMessage(payload: unknown, fallback: string) {
  if (!isRecord(payload)) return fallback;
  const error = stringValue(payload.error).trim();
  if (error) return error;
  const message = stringValue(payload.message).trim();
  return message || fallback;
}

export function parseVehicleCandidate(value: unknown): VehicleCandidate | null {
  if (!isRecord(value)) return null;
  return {
    id: nullableString(value.id),
    clientId: nullableString(value.clientId),
    clientName: nullableString(value.clientName),
    clientPhone: nullableString(value.clientPhone),
    plate: stringValue(value.plate),
    vin: stringValue(value.vin),
    make: stringValue(value.make),
    model: stringValue(value.model),
    year: stringValue(value.year),
    mileage: stringValue(value.mileage),
    engine: stringValue(value.engine),
    engineVolume: stringValue(value.engineVolume),
    fuelType: stringValue(value.fuelType),
    bodyType: stringValue(value.bodyType),
    grossWeight: stringValue(value.grossWeight),
    driveType: stringValue(value.driveType),
    vehicleType: resolveVehicleType(value.vehicleType, "UNKNOWN"),
    turboLevClass: resolveTurboLevClass(value.turboLevClass, "UNKNOWN"),
    priceCoefficient: stringValue(value.priceCoefficient),
    classificationSource: stringValue(value.classificationSource),
    classificationConfidence: stringValue(value.classificationConfidence),
    classificationReason: stringValue(value.classificationReason),
    manualClassOverride: Boolean(value.manualClassOverride),
    vehicleDataSource: stringValue(value.vehicleDataSource),
    vehicleDataConfidence: stringValue(value.vehicleDataConfidence),
    vehicleDataStatus: resolveVehicleDataStatus(value.vehicleDataStatus, "AUTO"),
  };
}

export function parsePlateLookupCandidate(payload: unknown, plate: string): VehicleCandidate | null {
  const vehicle = readPayloadField(payload, "vehicle");
  if (!isRecord(vehicle)) return null;
  return {
    id: nullableString(vehicle.id),
    clientId: nullableString(vehicle.clientId),
    clientName: nullableString(vehicle.clientName),
    clientPhone: nullableString(vehicle.clientPhone),
    plate,
    vin: stringValue(vehicle.vin),
    make: stringValue(vehicle.make),
    model: stringValue(vehicle.model),
    year: finiteNumber(vehicle.year) == null ? "" : String(finiteNumber(vehicle.year)),
    mileage: finiteNumber(vehicle.mileageKm) == null ? "" : String(finiteNumber(vehicle.mileageKm)),
    engine: stringValue(vehicle.engine),
    engineVolume: finiteNumber(vehicle.engineVolumeL) == null ? "" : String(finiteNumber(vehicle.engineVolumeL)),
    fuelType: stringValue(vehicle.fuelType),
    bodyType: stringValue(vehicle.bodyType),
    grossWeight: finiteNumber(vehicle.grossWeightKg) == null ? "" : String(finiteNumber(vehicle.grossWeightKg)),
    driveType: stringValue(vehicle.driveType),
    vehicleType: resolveVehicleType(vehicle.vehicleType, "UNKNOWN"),
    turboLevClass: resolveTurboLevClass(vehicle.turboLevClass, "UNKNOWN"),
    priceCoefficient: (finiteNumber(vehicle.priceCoefficient) ?? 1).toFixed(2),
    classificationSource: stringValue(vehicle.classificationSource, "CRM"),
    classificationConfidence: String(finiteNumber(vehicle.classificationConfidence) ?? 100),
    classificationReason: stringValue(vehicle.classificationReason, "Дані автомобіля знайдено"),
    manualClassOverride: Boolean(vehicle.manualClassOverride),
    vehicleDataSource: stringValue(vehicle.vehicleDataSource) || stringValue(readPayloadField(payload, "lookupLevel"), "CRM"),
    vehicleDataConfidence: String(finiteNumber(vehicle.vehicleDataConfidence) ?? 100),
    vehicleDataStatus: "AUTO",
  };
}

export { inferEngineVolume };
