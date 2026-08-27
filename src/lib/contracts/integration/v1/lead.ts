import {
  ContractValidationError,
  enumValue,
  isRecord,
  optionalString,
  requiredString,
  validateOpaqueId,
} from "./common";
import { parseAttributionSnapshotV1, type AttributionSnapshotV1 } from "./attribution";

export const PUBLIC_LEAD_TYPES = [
  "PART_SELECTION",
  "CALLBACK",
  "BOOKING",
  "PRODUCT",
  "SEARCH_NO_RESULT",
  "DIAGNOSTIC",
  "AI_HANDOFF",
] as const;

export type PublicLeadTypeV1 = (typeof PUBLIC_LEAD_TYPES)[number];

export type PublicLeadContactV1 = {
  name?: string;
  phone: string;
};

export type PublicLeadVehicleV1 = {
  label?: string;
  plate?: string;
  vin?: string;
};

export type PublicLeadContextV1 = {
  productId?: string;
  serviceId?: string;
  categoryId?: string;
  query?: string;
  pagePath?: string;
};

export type PublicLeadPrivacyV1 = {
  noticeVersion: string;
  acknowledgedAt: string;
  marketingConsent?: boolean;
};

export type PublicLeadAiHandoffV1 = {
  sessionId?: string;
  summary?: string;
};

export type PublicLeadRequestV1 = {
  leadType: PublicLeadTypeV1;
  contact: PublicLeadContactV1;
  message?: string;
  vehicle?: PublicLeadVehicleV1;
  context?: PublicLeadContextV1;
  attribution: AttributionSnapshotV1;
  privacy: PublicLeadPrivacyV1;
  aiHandoff?: PublicLeadAiHandoffV1;
};

export type PublicLeadAcceptanceDto = {
  accepted: true;
  status: "ACCEPTED";
  receiptRef: string;
  acceptedAt: string;
};

function invalid(field: string, code = "INVALID_FORMAT"): never {
  throw new ContractValidationError("INVALID_REQUEST", `Поле ${field} має некоректний формат.`, { [field]: code });
}

function strictRecord(value: unknown, field: string, allowedKeys: readonly string[]) {
  if (!isRecord(value)) invalid(field);
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length) {
    throw new ContractValidationError("INVALID_REQUEST", `Поле ${field} містить непідтримувані дані.`, {
      [field]: `UNSUPPORTED_FIELDS:${unknownKeys.join(",")}`,
    });
  }
  return value;
}

function normalizePhoneInput(value: unknown) {
  const phone = requiredString(value, "contact.phone", 40);
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) invalid("contact.phone");
  return phone;
}

function optionalIsoTimestamp(value: unknown, field: string) {
  const raw = optionalString(value, 64);
  if (!raw) return undefined;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) invalid(field, "INVALID_TIMESTAMP");
  return new Date(parsed).toISOString();
}

function safePagePath(value: unknown) {
  const raw = optionalString(value, 512);
  if (!raw) return undefined;
  try {
    const url = raw.startsWith("/") ? new URL(raw, "https://turbolev.invalid") : new URL(raw);
    return url.pathname.slice(0, 300) || "/";
  } catch {
    invalid("context.pagePath");
  }
}

function parseContact(value: unknown): PublicLeadContactV1 {
  const row = strictRecord(value, "contact", ["name", "phone"]);
  const name = optionalString(row.name, 120);
  return {
    ...(name ? { name } : {}),
    phone: normalizePhoneInput(row.phone),
  };
}

function parseVehicle(value: unknown): PublicLeadVehicleV1 | undefined {
  if (value === undefined || value === null) return undefined;
  const row = strictRecord(value, "vehicle", ["label", "plate", "vin"]);
  const result: PublicLeadVehicleV1 = {};

  const label = optionalString(row.label, 180);
  if (label) result.label = label;

  const plate = optionalString(row.plate, 24);
  if (plate) {
    const normalized = plate.toUpperCase().replace(/[\s-]/g, "");
    if (normalized.length < 3 || normalized.length > 16 || !/^[A-ZА-ЯІЇЄ0-9]+$/u.test(normalized)) invalid("vehicle.plate");
    result.plate = normalized;
  }

  const vin = optionalString(row.vin, 32);
  if (vin) {
    const normalized = vin.toUpperCase().replace(/[\s-]/g, "");
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(normalized)) invalid("vehicle.vin");
    result.vin = normalized;
  }

  return Object.keys(result).length ? result : undefined;
}

function optionalOpaque(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return undefined;
  return validateOpaqueId(value, field);
}

function parseContext(value: unknown): PublicLeadContextV1 | undefined {
  if (value === undefined || value === null) return undefined;
  const row = strictRecord(value, "context", ["productId", "serviceId", "categoryId", "query", "pagePath"]);
  const result: PublicLeadContextV1 = {};

  const productId = optionalOpaque(row.productId, "context.productId");
  if (productId) result.productId = productId;
  const serviceId = optionalOpaque(row.serviceId, "context.serviceId");
  if (serviceId) result.serviceId = serviceId;
  const categoryId = optionalOpaque(row.categoryId, "context.categoryId");
  if (categoryId) result.categoryId = categoryId;
  const query = optionalString(row.query, 300);
  if (query) result.query = query;
  const pagePath = safePagePath(row.pagePath);
  if (pagePath) result.pagePath = pagePath;

  return Object.keys(result).length ? result : undefined;
}

function parsePrivacy(value: unknown): PublicLeadPrivacyV1 {
  const row = strictRecord(value, "privacy", ["noticeVersion", "acknowledgedAt", "marketingConsent"]);
  const noticeVersion = requiredString(row.noticeVersion, "privacy.noticeVersion", 80);
  const acknowledgedAt = optionalIsoTimestamp(row.acknowledgedAt, "privacy.acknowledgedAt");
  if (!acknowledgedAt) {
    throw new ContractValidationError("INVALID_REQUEST", "Поле privacy.acknowledgedAt є обов'язковим.", {
      "privacy.acknowledgedAt": "REQUIRED",
    });
  }
  return {
    noticeVersion,
    acknowledgedAt,
    ...(typeof row.marketingConsent === "boolean" ? { marketingConsent: row.marketingConsent } : {}),
  };
}

function parseAiHandoff(value: unknown): PublicLeadAiHandoffV1 | undefined {
  if (value === undefined || value === null) return undefined;
  const row = strictRecord(value, "aiHandoff", ["sessionId", "summary"]);
  const sessionId = optionalOpaque(row.sessionId, "aiHandoff.sessionId");
  const summary = optionalString(row.summary, 1200);
  const result: PublicLeadAiHandoffV1 = {};
  if (sessionId) result.sessionId = sessionId;
  if (summary) result.summary = summary;
  return Object.keys(result).length ? result : undefined;
}

export function parsePublicLeadRequestV1(value: unknown): PublicLeadRequestV1 {
  const row = strictRecord(value, "request", [
    "leadType",
    "contact",
    "message",
    "vehicle",
    "context",
    "attribution",
    "privacy",
    "aiHandoff",
  ]);

  const leadType = enumValue(row.leadType, PUBLIC_LEAD_TYPES);
  if (!leadType) invalid("leadType", "INVALID_VALUE");

  const message = optionalString(row.message, 2000);
  const vehicle = parseVehicle(row.vehicle);
  const context = parseContext(row.context);
  const aiHandoff = parseAiHandoff(row.aiHandoff);

  if (leadType === "AI_HANDOFF" && !aiHandoff?.summary) {
    throw new ContractValidationError("INVALID_REQUEST", "AI handoff потребує короткого summary.", {
      "aiHandoff.summary": "REQUIRED",
    });
  }

  return {
    leadType,
    contact: parseContact(row.contact),
    ...(message ? { message } : {}),
    ...(vehicle ? { vehicle } : {}),
    ...(context ? { context } : {}),
    attribution: parseAttributionSnapshotV1(row.attribution),
    privacy: parsePrivacy(row.privacy),
    ...(aiHandoff ? { aiHandoff } : {}),
  };
}
