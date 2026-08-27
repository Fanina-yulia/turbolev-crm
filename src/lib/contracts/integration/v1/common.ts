export const API_VERSION = "v1" as const;

export const API_ERROR_CODES = [
  "INVALID_REQUEST",
  "INVALID_FILTER",
  "RESOLUTION_NOT_FOUND",
  "PRODUCT_NOT_FOUND",
  "VEHICLE_REFERENCE_NOT_FOUND",
  "IDEMPOTENCY_CONFLICT",
  "RESOLUTION_STATE_CONFLICT",
  "RESOLUTION_EXPIRED",
  "INVALID_VIN_FORMAT",
  "INVALID_VIN_CHECK_DIGIT",
  "INVALID_PLATE_FORMAT",
  "VEHICLE_INPUT_INSUFFICIENT",
  "RATE_LIMITED",
  "UPSTREAM_BAD_RESPONSE",
  "VIN_PROVIDER_UNAVAILABLE",
  "VEHICLE_LOOKUP_UNAVAILABLE",
  "SEARCH_UNAVAILABLE",
  "INTEGRATION_UNAVAILABLE",
  "UPSTREAM_TIMEOUT",
  "INTERNAL_ERROR",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
export type ApiCacheState = "HIT" | "MISS" | "BYPASS" | "STALE";

export type ApiMeta = {
  correlationId: string;
  apiVersion: typeof API_VERSION;
  servedAt: string;
  cache?: ApiCacheState;
  sourceVersion?: string | null;
};

export type ApiSuccess<T> = { ok: true; data: T; meta: ApiMeta };
export type ApiFailure = {
  ok: false;
  error: {
    code: ApiErrorCode;
    message: string;
    retryable: boolean;
    fieldErrors?: Record<string, string>;
    details?: Record<string, string | number | boolean | null>;
  };
  meta: ApiMeta;
};
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export type ContractValidationCode = Extract<
  ApiErrorCode,
  "INVALID_REQUEST" | "INVALID_FILTER" | "INVALID_VIN_FORMAT" | "INVALID_VIN_CHECK_DIGIT" | "INVALID_PLATE_FORMAT" | "VEHICLE_INPUT_INSUFFICIENT"
>;

export class ContractValidationError extends Error {
  readonly code: ContractValidationCode;
  readonly fieldErrors: Record<string, string>;

  constructor(code: ContractValidationCode, message: string, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = "ContractValidationError";
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function optionalString(value: unknown, maxLength = 240) {
  if (value === undefined || value === null || typeof value !== "string") return undefined;
  const result = value.trim();
  return result ? result.slice(0, maxLength) : undefined;
}

export function requiredString(value: unknown, field: string, maxLength = 240) {
  const result = optionalString(value, maxLength);
  if (!result) {
    throw new ContractValidationError("INVALID_REQUEST", `Поле ${field} є обов'язковим.`, { [field]: "REQUIRED" });
  }
  return result;
}

export function optionalInteger(value: unknown, min: number, max: number) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return undefined;
  return parsed;
}

export function enumValue<const T extends readonly string[]>(value: unknown, values: T): T[number] | undefined {
  return typeof value === "string" && (values as readonly string[]).includes(value) ? (value as T[number]) : undefined;
}

export function validateOpaqueId(value: unknown, field: string) {
  const result = requiredString(value, field, 180);
  if (!/^[A-Za-z0-9._~-]+$/.test(result)) {
    throw new ContractValidationError("INVALID_REQUEST", `Поле ${field} має некоректний формат.`, { [field]: "INVALID_FORMAT" });
  }
  return result;
}

export function validateCorrelationId(value: unknown) {
  const result = optionalString(value, 128);
  if (!result) return undefined;
  return /^[A-Za-z0-9._:-]+$/.test(result) ? result : undefined;
}

export function validateIdempotencyKey(value: unknown) {
  const result = optionalString(value, 160);
  if (!result) return undefined;
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(result)) {
    throw new ContractValidationError("INVALID_REQUEST", "Некоректний X-Idempotency-Key.", { idempotencyKey: "INVALID_FORMAT" });
  }
  return result;
}
