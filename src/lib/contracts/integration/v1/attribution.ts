import {
  ContractValidationError,
  enumValue,
  isRecord,
  optionalString,
  validateOpaqueId,
} from "./common";

export const ATTRIBUTION_ENTRYPOINTS = [
  "WEB_FORM",
  "BOOKING",
  "VIN",
  "SHOP",
  "BUY_INSTALL",
  "AI_ASSISTANT",
  "CALLBACK",
] as const;

export const ATTRIBUTION_SOURCE_CLASSES = [
  "ORGANIC_SEARCH",
  "PAID_SEARCH",
  "ORGANIC_SOCIAL",
  "PAID_SOCIAL",
  "REFERRAL",
  "DIRECT",
  "EMAIL",
  "MESSENGER",
  "AI_ASSISTED",
  "OTHER",
  "UNKNOWN",
] as const;

export type AttributionEntrypointV1 = (typeof ATTRIBUTION_ENTRYPOINTS)[number];
export type AttributionSourceClassV1 = (typeof ATTRIBUTION_SOURCE_CLASSES)[number];

export type AttributionTouchV1 = {
  capturedAt?: string;
  sourceClass: AttributionSourceClassV1;
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
  landingPath?: string;
  referrerHost?: string;
  pageTypeId?: string;
  intentCluster?: string;
  locationId?: string;
  serviceId?: string;
  categoryId?: string;
  productId?: string;
  vehicleReferenceId?: string;
  aiAssisted?: boolean;
};

export type AttributionSnapshotV1 = {
  schemaVersion: "v1";
  entrypoint: AttributionEntrypointV1;
  publicSessionId?: string;
  pageViewId?: string;
  aiSessionId?: string;
  firstTouch?: AttributionTouchV1;
  sessionTouch?: AttributionTouchV1;
  conversionTouch: AttributionTouchV1;
};

export type LegacyInquiryAttributionFieldsV1 = {
  sourceDetail: string;
  campaign: string | null;
  utm: string | null;
};

function isoTimestamp(value: unknown, field: string) {
  const raw = optionalString(value, 64);
  if (!raw) return undefined;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    throw new ContractValidationError("INVALID_REQUEST", `Поле ${field} має некоректну дату.`, {
      [field]: "INVALID_TIMESTAMP",
    });
  }
  return new Date(parsed).toISOString();
}

function safePath(value: unknown) {
  const raw = optionalString(value, 512);
  if (!raw) return undefined;
  try {
    if (raw.startsWith("/")) {
      const url = new URL(raw, "https://turbolev.invalid");
      return url.pathname.slice(0, 300) || "/";
    }
    const url = new URL(raw);
    return url.pathname.slice(0, 300) || "/";
  } catch {
    return undefined;
  }
}

function safeHost(value: unknown) {
  const raw = optionalString(value, 512);
  if (!raw) return undefined;
  try {
    const candidate = raw.includes("://") ? raw : `https://${raw}`;
    return new URL(candidate).hostname.toLowerCase().slice(0, 180) || undefined;
  } catch {
    return undefined;
  }
}

function optionalOpaqueId(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return undefined;
  return validateOpaqueId(value, field);
}

function parseTouch(value: unknown, field: string, required: boolean): AttributionTouchV1 | undefined {
  if (value === undefined || value === null) {
    if (!required) return undefined;
    throw new ContractValidationError("INVALID_REQUEST", `Поле ${field} є обов'язковим.`, {
      [field]: "REQUIRED",
    });
  }
  if (!isRecord(value)) {
    throw new ContractValidationError("INVALID_REQUEST", `Поле ${field} має некоректний формат.`, {
      [field]: "INVALID_FORMAT",
    });
  }

  const sourceClass = enumValue(value.sourceClass, ATTRIBUTION_SOURCE_CLASSES) || "UNKNOWN";
  const touch: AttributionTouchV1 = {
    sourceClass,
  };

  const capturedAt = isoTimestamp(value.capturedAt, `${field}.capturedAt`);
  if (capturedAt) touch.capturedAt = capturedAt;

  const source = optionalString(value.source, 100);
  if (source) touch.source = source;
  const medium = optionalString(value.medium, 100);
  if (medium) touch.medium = medium;
  const campaign = optionalString(value.campaign, 160);
  if (campaign) touch.campaign = campaign;
  const content = optionalString(value.content, 160);
  if (content) touch.content = content;
  const term = optionalString(value.term, 160);
  if (term) touch.term = term;
  const landingPath = safePath(value.landingPath);
  if (landingPath) touch.landingPath = landingPath;
  const referrerHost = safeHost(value.referrerHost);
  if (referrerHost) touch.referrerHost = referrerHost;
  const pageTypeId = optionalString(value.pageTypeId, 64);
  if (pageTypeId) touch.pageTypeId = pageTypeId;
  const intentCluster = optionalString(value.intentCluster, 120);
  if (intentCluster) touch.intentCluster = intentCluster;

  const locationId = optionalOpaqueId(value.locationId, `${field}.locationId`);
  if (locationId) touch.locationId = locationId;
  const serviceId = optionalOpaqueId(value.serviceId, `${field}.serviceId`);
  if (serviceId) touch.serviceId = serviceId;
  const categoryId = optionalOpaqueId(value.categoryId, `${field}.categoryId`);
  if (categoryId) touch.categoryId = categoryId;
  const productId = optionalOpaqueId(value.productId, `${field}.productId`);
  if (productId) touch.productId = productId;
  const vehicleReferenceId = optionalOpaqueId(value.vehicleReferenceId, `${field}.vehicleReferenceId`);
  if (vehicleReferenceId) touch.vehicleReferenceId = vehicleReferenceId;

  if (typeof value.aiAssisted === "boolean") touch.aiAssisted = value.aiAssisted;

  return touch;
}

export function parseAttributionSnapshotV1(value: unknown): AttributionSnapshotV1 {
  if (!isRecord(value)) {
    throw new ContractValidationError("INVALID_REQUEST", "Attribution має некоректний формат.", {
      attribution: "INVALID_FORMAT",
    });
  }

  const entrypoint = enumValue(value.entrypoint, ATTRIBUTION_ENTRYPOINTS);
  if (!entrypoint) {
    throw new ContractValidationError("INVALID_REQUEST", "Некоректний attribution entrypoint.", {
      "attribution.entrypoint": "INVALID_VALUE",
    });
  }

  const result: AttributionSnapshotV1 = {
    schemaVersion: "v1",
    entrypoint,
    conversionTouch: parseTouch(value.conversionTouch, "attribution.conversionTouch", true)!,
  };

  const publicSessionId = optionalOpaqueId(value.publicSessionId, "attribution.publicSessionId");
  if (publicSessionId) result.publicSessionId = publicSessionId;
  const pageViewId = optionalOpaqueId(value.pageViewId, "attribution.pageViewId");
  if (pageViewId) result.pageViewId = pageViewId;
  const aiSessionId = optionalOpaqueId(value.aiSessionId, "attribution.aiSessionId");
  if (aiSessionId) result.aiSessionId = aiSessionId;

  const firstTouch = parseTouch(value.firstTouch, "attribution.firstTouch", false);
  if (firstTouch) result.firstTouch = firstTouch;
  const sessionTouch = parseTouch(value.sessionTouch, "attribution.sessionTouch", false);
  if (sessionTouch) result.sessionTouch = sessionTouch;

  return result;
}

function encodeUtm(touch: AttributionTouchV1) {
  const pairs = [
    ["utm_source", touch.source],
    ["utm_medium", touch.medium],
    ["utm_campaign", touch.campaign],
    ["utm_content", touch.content],
    ["utm_term", touch.term],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  if (!pairs.length) return null;
  return new URLSearchParams(pairs).toString().slice(0, 1000);
}

export function deriveLegacyInquiryAttributionFieldsV1(
  snapshot: AttributionSnapshotV1,
): LegacyInquiryAttributionFieldsV1 {
  const touch = snapshot.conversionTouch;
  const sourceLabel = touch.source || touch.sourceClass;
  const detailParts = [sourceLabel, touch.medium, touch.landingPath, touch.intentCluster]
    .filter(Boolean)
    .map(String);

  return {
    sourceDetail: detailParts.join(" · ").slice(0, 300) || "TURBO LEV public web",
    campaign: touch.campaign || null,
    utm: encodeUtm(touch),
  };
}

export function attributionMetadataV1(snapshot: AttributionSnapshotV1) {
  return {
    attribution: snapshot,
  } as const;
}
