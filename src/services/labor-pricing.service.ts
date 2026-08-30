import { getPrisma } from "@/src/lib/prisma";
import { classifyVehicle, type VehicleTechnicalInput } from "@/src/domain/vehicle-intelligence";

export type PricingVehicleType =
  | "PASSENGER"
  | "CROSSOVER"
  | "SUV"
  | "PICKUP"
  | "MINIVAN"
  | "VAN_SMALL"
  | "VAN"
  | "VAN_LARGE"
  | "COMMERCIAL_HEAVY";

export const DEFAULT_VEHICLE_TYPE_COEFFICIENTS: Record<PricingVehicleType, number> = {
  PASSENGER: 1,
  CROSSOVER: 1.15,
  SUV: 1.2,
  PICKUP: 1.2,
  MINIVAN: 1.15,
  VAN_SMALL: 1.2,
  VAN: 1.35,
  VAN_LARGE: 1.5,
  COMMERCIAL_HEAVY: 1.65,
};

export const PRICING_VEHICLE_TYPE_LABELS: Record<PricingVehicleType, string> = {
  PASSENGER: "Легковий",
  CROSSOVER: "Кросовер",
  SUV: "Позашляховик / SUV",
  PICKUP: "Пікап",
  MINIVAN: "Мінівен / MPV",
  VAN_SMALL: "Малий бус",
  VAN: "Бус",
  VAN_LARGE: "Великий бус",
  COMMERCIAL_HEAVY: "Важкий комерційний",
};

type SettingRow = { value: unknown };

const PICKUP_SIGNATURES = [
  "hilux", "ranger", "amarok", "navara", "frontier", "l200", "triton", "d max", "d-max",
  "bt 50", "bt-50", "ram 1500", "ram 2500", "f 150", "f-150", "silverado", "tundra",
  "colorado", "tacoma", "gladiator", "ridgeline", "musso", "fullback", "alaskan", "pickup", "pick up", "пікап",
];

function normalizeText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[‐‑‒–—-]/g, " ")
    .replace(/[^a-zа-яіїє0-9]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function validCoefficient(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0.5 && parsed <= 5 ? parsed : fallback;
}

export function detectPricingVehicleType(input: VehicleTechnicalInput): PricingVehicleType {
  const text = normalizeText(`${input.make ?? ""} ${input.model ?? ""} ${input.bodyType ?? ""} ${input.vehicleType ?? ""}`);
  if (PICKUP_SIGNATURES.some((signature) => text.includes(normalizeText(signature)))) return "PICKUP";

  const classified = classifyVehicle(input);
  const type = classified.vehicleType;
  if (type === "CROSSOVER" || type === "SUV" || type === "MINIVAN" || type === "VAN_SMALL" || type === "VAN" || type === "VAN_LARGE" || type === "COMMERCIAL_HEAVY") return type;
  return "PASSENGER";
}

export async function getVehicleTypeCoefficients() {
  const prisma = getPrisma();
  let configured: Record<string, unknown> = {};
  try {
    const rows = await prisma.$queryRawUnsafe<SettingRow[]>(`SELECT "value" FROM "CrmSetting" WHERE "key"='markup' LIMIT 1`);
    const markup = asObject(rows[0]?.value);
    configured = asObject(markup.vehicleTypeCoefficients);
  } catch (error) {
    console.warn("Vehicle pricing settings unavailable; using defaults", error);
  }

  return Object.fromEntries(
    (Object.keys(DEFAULT_VEHICLE_TYPE_COEFFICIENTS) as PricingVehicleType[]).map((key) => [
      key,
      validCoefficient(configured[key], DEFAULT_VEHICLE_TYPE_COEFFICIENTS[key]),
    ]),
  ) as Record<PricingVehicleType, number>;
}

export async function getCustomerPartsLaborPercent() {
  const prisma = getPrisma();
  try {
    const rows = await prisma.$queryRawUnsafe<SettingRow[]>(`SELECT "value" FROM "CrmSetting" WHERE "key"='markup' LIMIT 1`);
    const markup = asObject(rows[0]?.value);
    const parsed = Number(markup.customerPartsLaborPercent);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1000 ? parsed : 20;
  } catch (error) {
    console.warn("Customer-part labor settings unavailable; using default", error);
    return 20;
  }
}

export async function resolveLaborPricing(input: VehicleTechnicalInput) {
  const classification = classifyVehicle(input);
  const pricingVehicleType = detectPricingVehicleType(input);
  const coefficients = await getVehicleTypeCoefficients();
  const coefficient = coefficients[pricingVehicleType];
  return {
    pricingVehicleType,
    pricingVehicleTypeLabel: PRICING_VEHICLE_TYPE_LABELS[pricingVehicleType],
    coefficient,
    classification,
    source: "CRM_MARKUP_SETTINGS" as const,
  };
}

export async function calculateLaborPrice(basePrice: number, input: VehicleTechnicalInput, quantity = 1, manualAdjustmentPercent = 0) {
  const safeBase = Number.isFinite(basePrice) && basePrice >= 0 ? basePrice : 0;
  const safeQty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  const safeAdjustment = Number.isFinite(manualAdjustmentPercent) ? manualAdjustmentPercent : 0;
  const pricing = await resolveLaborPricing(input);
  const subtotal = safeBase * safeQty * pricing.coefficient;
  const adjusted = subtotal * (1 + safeAdjustment / 100);
  return {
    basePrice: safeBase,
    quantity: safeQty,
    ...pricing,
    subtotal: Math.round(subtotal),
    manualAdjustmentPercent: safeAdjustment,
    total: Math.round(adjusted),
  };
}

function normalized(value: unknown) {
  return String(value ?? "").toLocaleLowerCase("uk-UA").replace(/[‐‑‒–—-]/g, " ").replace(/[^a-zа-яіїє0-9]+/giu, " ").replace(/\s+/g, " ").trim();
}

export function isReplacementLabor(input: { nameOperation?: string | null; calculatorOperation?: string | null; displayName?: string | null; internalName?: string | null }) {
  const explicit = normalized(`${input.nameOperation ?? ""} ${input.calculatorOperation ?? ""}`);
  if (explicit.includes("replace") || explicit.includes("замін")) return true;
  return normalized(`${input.displayName ?? ""} ${input.internalName ?? ""}`).includes("замін");
}

export async function calculateCatalogLaborPrice(input: {
  basePrice: number;
  vehicle: VehicleTechnicalInput;
  quantity?: number;
  vehicleCoefficientEnabled: boolean;
  customerProvidedPart?: boolean;
  replacementOperation: boolean;
}) {
  const quantity = Number.isFinite(input.quantity) && (input.quantity ?? 0) > 0 ? input.quantity ?? 1 : 1;
  const pricing = await resolveLaborPricing(input.vehicle);
  const coefficient = input.vehicleCoefficientEnabled ? pricing.coefficient : 1;
  const baseSubtotal = Math.round(Math.max(0, input.basePrice) * quantity * coefficient * 100) / 100;
  const customerPartsLaborPercent = input.customerProvidedPart && input.replacementOperation
    ? await getCustomerPartsLaborPercent()
    : 0;
  const total = Math.round(baseSubtotal * (1 + customerPartsLaborPercent / 100) * 100) / 100;
  return {
    ...pricing,
    basePrice: Math.max(0, input.basePrice),
    quantity,
    coefficientApplied: input.vehicleCoefficientEnabled,
    coefficient,
    baseSubtotal,
    customerProvidedPart: Boolean(input.customerProvidedPart),
    replacementOperation: input.replacementOperation,
    customerPartsLaborPercent,
    total,
  };
}
