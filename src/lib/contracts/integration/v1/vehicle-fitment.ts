import { normalizeRegistrationPlate } from "@/src/domain/registration-plate";
import { validateVin } from "@/src/domain/vin";
import {
  ContractValidationError,
  enumValue,
  isRecord,
  optionalInteger,
  optionalString,
  requiredString,
  validateOpaqueId,
} from "./common";

export const VEHICLE_RESOLUTION_STATUSES = ["RESOLVED", "AMBIGUOUS", "PENDING", "FAILED", "EXPIRED"] as const;
export const VEHICLE_RESOLVE_ACCEPTED_INPUT_TYPES = ["AUTO", "VIN", "PLATE", "MANUAL", "SAVED_VEHICLE"] as const;
export const VEHICLE_RESOLVE_INPUT_TYPES = ["VIN", "PLATE", "MANUAL", "SAVED_VEHICLE"] as const;
export const FITMENT_MATCH_STATES = ["MATCH_CONFIRMED", "MATCH_WITH_NOTES", "NEEDS_CONFIRMATION", "NOT_COMPATIBLE", "UNKNOWN"] as const;
export const FITMENT_SORTS = ["RELEVANCE", "PRICE_ASC", "PRICE_DESC", "AVAILABILITY"] as const;
export const AVAILABILITY_STATES = ["IN_STOCK", "SUPPLIER_STOCK", "ORDERABLE", "CHECK_REQUIRED", "UNAVAILABLE"] as const;

export type VehicleResolutionStatus = (typeof VEHICLE_RESOLUTION_STATUSES)[number];
export type VehicleResolveAcceptedInputType = (typeof VEHICLE_RESOLVE_ACCEPTED_INPUT_TYPES)[number];
export type VehicleResolveInputType = (typeof VEHICLE_RESOLVE_INPUT_TYPES)[number];
export type FitmentMatchState = (typeof FITMENT_MATCH_STATES)[number];
export type FitmentSort = (typeof FITMENT_SORTS)[number];
export type AvailabilityState = (typeof AVAILABILITY_STATES)[number];

export type VehicleIntentContext = { categoryId?: string; genericArticleId?: string; productId?: string };

export type ManualVehicleInput = {
  make: string;
  model: string;
  year: number;
  generation?: string;
  engineCode?: string;
  engineName?: string;
  displacementCm3?: number;
  fuelType?: string;
  bodyType?: string;
  driveType?: string;
  transmissionType?: string;
  market?: string;
};

export type VehicleResolveRequest =
  | { inputType: "VIN"; vin: string; context?: VehicleIntentContext }
  | { inputType: "PLATE"; plate: string; countryCode: "UA"; context?: VehicleIntentContext }
  | { inputType: "MANUAL"; vehicle: ManualVehicleInput; context?: VehicleIntentContext }
  | { inputType: "SAVED_VEHICLE"; publicVehicleRef: string; context?: VehicleIntentContext };

export type VehicleReferenceDto = {
  id: string;
  fitmentKey: string;
  make: string;
  model: string;
  generation?: string | null;
  year?: number | null;
  productionFrom?: string | null;
  productionTo?: string | null;
  engineName?: string | null;
  engineCode?: string | null;
  displacementCm3?: number | null;
  fuelType?: string | null;
  bodyType?: string | null;
  driveType?: string | null;
  transmissionType?: string | null;
};

export type VehicleResolutionCandidateDto = {
  candidateId: string;
  displayLabel: string;
  differences: Record<string, string | number | null>;
  confidence: number;
};

export type VehicleResolutionDto = {
  vehicleResolutionId: string;
  status: VehicleResolutionStatus;
  resolvedInputType: VehicleResolveInputType;
  maskedIdentifier: string | null;
  vehicleReference: VehicleReferenceDto | null;
  confidence: number;
  missingCriteria: string[];
  candidates: VehicleResolutionCandidateDto[];
  pollAfterMs: number | null;
  expiresAt: string;
};

export type VehicleResolveConfirmRequest = {
  vehicleResolutionId: string;
  candidateId?: string;
  answers: Record<string, string | string[] | number | boolean>;
};

export type FitmentCommercialDto = {
  price: { amount: string; currency: string } | null;
  availability: AvailabilityState;
  eta?: string | null;
  ownStock: boolean;
};

export type FitmentItemDto = {
  productId: string;
  matchState: Exclude<FitmentMatchState, "NOT_COMPATIBLE">;
  fitmentConfidence: number;
  fitmentNotes: string[];
  requiredConfirmations: string[];
  commercial: FitmentCommercialDto;
  display: { brand: string; mpn: string; title: string; image?: string | null };
};

export type VehicleFitmentBrowseDto = {
  vehicle: { display: string; fitmentKey: string };
  intent: { categoryId?: string; genericArticleId?: string };
  items: FitmentItemDto[];
  facets: Record<string, unknown>;
  nextCursor: string | null;
  totalApprox: number;
};

export type ProductFitmentCheckRequest = { vehicleResolutionId: string };
export type ProductFitmentCheckDto = {
  productId: string;
  matchState: FitmentMatchState;
  confidence: number;
  notes: string[];
  requiredConfirmations: string[];
  checkedAt: string;
  fitmentSnapshotToken?: string | null;
};

function parseContext(value: unknown): VehicleIntentContext | undefined {
  if (!isRecord(value)) return undefined;
  const context: VehicleIntentContext = {
    categoryId: optionalString(value.categoryId, 180),
    genericArticleId: optionalString(value.genericArticleId, 180),
    productId: optionalString(value.productId, 180),
  };
  return context.categoryId || context.genericArticleId || context.productId ? context : undefined;
}

function normalizeVin(value: unknown) {
  const raw = requiredString(value, "vin", 32);
  const validation = validateVin(raw);
  if (!validation.formatValid) {
    throw new ContractValidationError("INVALID_VIN_FORMAT", "VIN повинен містити 17 допустимих символів.", { vin: "INVALID_VIN_FORMAT" });
  }
  if (validation.northAmerican && validation.checkDigit.status === "INVALID") {
    throw new ContractValidationError("INVALID_VIN_CHECK_DIGIT", "Контрольна цифра VIN не збігається.", { vin: "INVALID_VIN_CHECK_DIGIT" });
  }
  return validation.vin;
}

function normalizeUaPlate(value: unknown) {
  const raw = requiredString(value, "plate", 32);
  const plate = normalizeRegistrationPlate(raw);
  if (!/^[A-Z0-9]{6,10}$/.test(plate)) {
    throw new ContractValidationError("INVALID_PLATE_FORMAT", "Введіть коректний державний номер України.", { plate: "INVALID_PLATE_FORMAT" });
  }
  return plate;
}

function parseAutoIdentifier(value: unknown, context?: VehicleIntentContext): VehicleResolveRequest {
  const raw = requiredString(value, "identifier", 32);
  const vin = validateVin(raw);
  if (vin.formatValid) {
    return { inputType: "VIN", vin: normalizeVin(raw), context };
  }
  const plate = normalizeRegistrationPlate(raw);
  if (/^[A-Z0-9]{6,10}$/.test(plate)) {
    return { inputType: "PLATE", plate, countryCode: "UA", context };
  }
  throw new ContractValidationError("INVALID_REQUEST", "Введіть коректний державний номер або VIN.", { identifier: "INVALID_VEHICLE_IDENTIFIER" });
}

function parseManualVehicle(value: unknown): ManualVehicleInput {
  if (!isRecord(value)) {
    throw new ContractValidationError("VEHICLE_INPUT_INSUFFICIENT", "Потрібні дані автомобіля.", { vehicle: "REQUIRED" });
  }
  const year = optionalInteger(value.year, 1886, 2200);
  const make = requiredString(value.make, "vehicle.make", 80);
  const model = requiredString(value.model, "vehicle.model", 100);
  if (!year) {
    throw new ContractValidationError("VEHICLE_INPUT_INSUFFICIENT", "Потрібен коректний рік автомобіля.", { "vehicle.year": "INVALID_YEAR" });
  }
  return {
    make,
    model,
    year,
    generation: optionalString(value.generation, 120),
    engineCode: optionalString(value.engineCode, 80),
    engineName: optionalString(value.engineName, 160),
    displacementCm3: optionalInteger(value.displacementCm3, 1, 20000),
    fuelType: optionalString(value.fuelType, 48),
    bodyType: optionalString(value.bodyType, 80),
    driveType: optionalString(value.driveType, 48),
    transmissionType: optionalString(value.transmissionType, 80),
    market: optionalString(value.market, 32),
  };
}

export function parseVehicleResolveRequest(value: unknown): VehicleResolveRequest {
  if (!isRecord(value)) throw new ContractValidationError("INVALID_REQUEST", "Тіло запиту повинно бути JSON-об'єктом.");
  const acceptedInputType = enumValue(value.inputType, VEHICLE_RESOLVE_ACCEPTED_INPUT_TYPES);
  if (!acceptedInputType) throw new ContractValidationError("INVALID_REQUEST", "Некоректний inputType.", { inputType: "INVALID_ENUM" });
  const context = parseContext(value.context);

  if (acceptedInputType === "AUTO") return parseAutoIdentifier(value.identifier, context);
  if (acceptedInputType === "VIN") return { inputType: "VIN", vin: normalizeVin(value.vin), context };
  if (acceptedInputType === "PLATE") {
    const countryCode = optionalString(value.countryCode, 2)?.toUpperCase() ?? "UA";
    if (countryCode !== "UA") {
      throw new ContractValidationError("INVALID_PLATE_FORMAT", "У v1 підтримується пошук державного номера України.", { countryCode: "UNSUPPORTED_COUNTRY" });
    }
    return { inputType: "PLATE", plate: normalizeUaPlate(value.plate), countryCode: "UA", context };
  }
  if (acceptedInputType === "MANUAL") return { inputType: "MANUAL", vehicle: parseManualVehicle(value.vehicle), context };
  return { inputType: "SAVED_VEHICLE", publicVehicleRef: validateOpaqueId(value.publicVehicleRef, "publicVehicleRef"), context };
}

export function parseVehicleResolveConfirmRequest(value: unknown): VehicleResolveConfirmRequest {
  if (!isRecord(value)) throw new ContractValidationError("INVALID_REQUEST", "Тіло запиту повинно бути JSON-об'єктом.");
  if (!isRecord(value.answers)) {
    throw new ContractValidationError("INVALID_REQUEST", "Потрібні answers для підтвердження конфігурації.", { answers: "REQUIRED" });
  }
  const answers: VehicleResolveConfirmRequest["answers"] = {};
  for (const [key, raw] of Object.entries(value.answers)) {
    if (!/^[A-Z0-9_]{2,80}$/.test(key)) continue;
    if (typeof raw === "string" && raw.trim()) answers[key] = raw.trim().slice(0, 200);
    else if (typeof raw === "number" && Number.isFinite(raw)) answers[key] = raw;
    else if (typeof raw === "boolean") answers[key] = raw;
    else if (Array.isArray(raw)) {
      const items = raw.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 20);
      if (items.length) answers[key] = items;
    }
  }
  if (!Object.keys(answers).length) {
    throw new ContractValidationError("INVALID_REQUEST", "Не передано жодного допустимого критерію підтвердження.", { answers: "EMPTY" });
  }
  return {
    vehicleResolutionId: validateOpaqueId(value.vehicleResolutionId, "vehicleResolutionId"),
    candidateId: value.candidateId === undefined ? undefined : validateOpaqueId(value.candidateId, "candidateId"),
    answers,
  };
}

export function parseProductFitmentCheckRequest(value: unknown): ProductFitmentCheckRequest {
  if (!isRecord(value)) throw new ContractValidationError("INVALID_REQUEST", "Тіло запиту повинно бути JSON-об'єктом.");
  return { vehicleResolutionId: validateOpaqueId(value.vehicleResolutionId, "vehicleResolutionId") };
}

export function parseFitmentBrowseQuery(input: URLSearchParams) {
  const categoryId = optionalString(input.get("categoryId"), 180);
  const genericArticleId = optionalString(input.get("genericArticleId"), 180);
  if (!categoryId && !genericArticleId) throw new ContractValidationError("INVALID_FILTER", "Потрібен categoryId або genericArticleId.");
  if (categoryId && genericArticleId) throw new ContractValidationError("INVALID_FILTER", "Передайте лише один основний catalog intent.");
  return {
    categoryId,
    genericArticleId,
    cursor: optionalString(input.get("cursor"), 240),
    limit: optionalInteger(input.get("limit"), 1, 60) ?? 24,
    sort: enumValue(input.get("sort") ?? "RELEVANCE", FITMENT_SORTS) ?? "RELEVANCE",
  };
}
