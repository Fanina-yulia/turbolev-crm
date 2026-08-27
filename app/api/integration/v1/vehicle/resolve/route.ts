import { NextResponse } from "next/server";
import {
  API_VERSION,
  ContractValidationError,
  parseVehicleResolveRequest,
  validateOpaqueId,
  type ApiErrorCode,
  type ApiFailure,
  type ApiSuccess,
  type VehicleResolutionDto,
} from "@/src/lib/contracts/integration/v1";
import {
  abandonIdempotentOperation,
  beginIdempotentOperation,
  completeIdempotentOperation,
  correlationIdForRequest,
  enforceIntegrationRateLimit,
  integrationRateLimitHeaders,
  prepareIntegrationRequest,
  requiredIdempotencyKey,
  type IntegrationRateLimitResult,
} from "@/src/security/integration-api-request-guard";
import {
  ServiceAccessError,
  servicePrincipalHash,
} from "@/src/security/service-access-context";
import {
  getVehicleResolution,
  resolveVehicleRequest,
  VehicleResolutionRuntimeError,
} from "@/src/services/integration-vehicle-resolution.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POST_OPERATION = "POST:/api/integration/v1/vehicle/resolve";
const RESOLVE_BURST_BUDGET = { bucketKey: "vehicle.resolve", limit: 30, windowSeconds: 60 } as const;
const RESOLVE_ENUMERATION_BUDGET = { bucketKey: "vehicle.resolve.enumeration", limit: 300, windowSeconds: 3_600 } as const;
const POLL_BURST_BUDGET = { bucketKey: "vehicle.resolve.poll", limit: 120, windowSeconds: 60 } as const;

function meta(correlationId: string) {
  return {
    correlationId,
    apiVersion: API_VERSION,
    servedAt: new Date().toISOString(),
  } as const;
}

function responseHeaders(correlationId: string, rateLimit: IntegrationRateLimitResult | null, extra: Record<string, string> = {}) {
  return {
    "Cache-Control": "no-store",
    "X-Correlation-Id": correlationId,
    ...(rateLimit ? integrationRateLimitHeaders(rateLimit) : {}),
    ...extra,
  };
}

function success(
  data: VehicleResolutionDto,
  status: number,
  correlationId: string,
  rateLimit: IntegrationRateLimitResult | null,
) {
  const body: ApiSuccess<VehicleResolutionDto> = { ok: true, data, meta: meta(correlationId) };
  return NextResponse.json(body, { status, headers: responseHeaders(correlationId, rateLimit) });
}

function failure(
  code: ApiErrorCode,
  status: number,
  message: string,
  correlationId: string,
  rateLimit: IntegrationRateLimitResult | null,
  options: {
    retryable?: boolean;
    fieldErrors?: Record<string, string>;
    details?: Record<string, string | number | boolean | null>;
    headers?: Record<string, string>;
  } = {},
) {
  const body: ApiFailure = {
    ok: false,
    error: {
      code,
      message,
      retryable: options.retryable ?? false,
      ...(options.fieldErrors ? { fieldErrors: options.fieldErrors } : {}),
      ...(options.details ? { details: options.details } : {}),
    },
    meta: meta(correlationId),
  };
  return NextResponse.json(body, {
    status,
    headers: responseHeaders(correlationId, rateLimit, options.headers),
  });
}

function serviceErrorCode(error: ServiceAccessError): ApiErrorCode {
  return error.code;
}

function unknownFailure(error: unknown, correlationId: string, rateLimit: IntegrationRateLimitResult | null) {
  console.error("integration vehicle resolver failed", {
    correlationId,
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return failure("INTERNAL_ERROR", 500, "Internal integration error.", correlationId, rateLimit, { retryable: true });
}

function rateLimited(
  message: string,
  correlationId: string,
  limit: IntegrationRateLimitResult,
) {
  return failure("RATE_LIMITED", 429, message, correlationId, limit, {
    retryable: true,
    details: { retryAfterSeconds: limit.retryAfterSeconds },
  });
}

export async function POST(request: Request) {
  let correlationId = correlationIdForRequest(request);
  let rateLimit: IntegrationRateLimitResult | null = null;
  let acquired: { recordId: string; requestFingerprint: string } | null = null;

  try {
    const context = await prepareIntegrationRequest(request, "vehicle:resolve", {
      rateLimit: RESOLVE_BURST_BUDGET,
    });
    correlationId = context.correlationId;
    rateLimit = context.rateLimit;

    if (rateLimit && !rateLimit.allowed) {
      return rateLimited("Vehicle resolution burst rate limit exceeded.", correlationId, rateLimit);
    }

    const enumerationLimit = await enforceIntegrationRateLimit(context.service, RESOLVE_ENUMERATION_BUDGET);
    if (!enumerationLimit.allowed) {
      rateLimit = enumerationLimit;
      return rateLimited("Vehicle resolution enumeration budget exceeded.", correlationId, enumerationLimit);
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      throw new ContractValidationError("INVALID_REQUEST", "Тіло запиту повинно містити коректний JSON.");
    }
    const resolveRequest = parseVehicleResolveRequest(payload);
    const idempotencyKey = requiredIdempotencyKey(request);
    const principalHash = servicePrincipalHash(context.service);

    const idempotency = await beginIdempotentOperation({
      service: context.service,
      operationKey: POST_OPERATION,
      idempotencyKey,
      payload: resolveRequest,
    });

    if (idempotency.kind === "CONFLICT") {
      return failure("IDEMPOTENCY_CONFLICT", 409, "Idempotency key was already used with another request.", correlationId, rateLimit);
    }
    if (idempotency.kind === "IN_PROGRESS") {
      return failure("RESOLUTION_STATE_CONFLICT", 409, "An identical vehicle resolution request is still in progress.", correlationId, rateLimit, {
        retryable: true,
        details: { retryAfterSeconds: idempotency.retryAfterSeconds },
        headers: { "Retry-After": String(idempotency.retryAfterSeconds) },
      });
    }
    if (idempotency.kind === "REPLAY") {
      return NextResponse.json(idempotency.responseBody, {
        status: idempotency.responseStatus,
        headers: responseHeaders(correlationId, rateLimit, { "X-Idempotency-Replayed": "true" }),
      });
    }

    acquired = { recordId: idempotency.recordId, requestFingerprint: idempotency.requestFingerprint };
    const result = await resolveVehicleRequest(resolveRequest, { principalHash, correlationId });
    const status = result.status === "PENDING" ? 202 : 200;
    const body: ApiSuccess<VehicleResolutionDto> = { ok: true, data: result, meta: meta(correlationId) };

    await completeIdempotentOperation({
      recordId: acquired.recordId,
      requestFingerprint: acquired.requestFingerprint,
      responseStatus: status,
      responseBody: body,
    });
    acquired = null;

    return NextResponse.json(body, { status, headers: responseHeaders(correlationId, rateLimit) });
  } catch (error) {
    if (acquired) {
      await abandonIdempotentOperation(acquired).catch(() => undefined);
    }
    if (error instanceof ServiceAccessError) {
      return failure(serviceErrorCode(error), error.status, error.message, correlationId, rateLimit, {
        retryable: error.status === 503,
      });
    }
    if (error instanceof ContractValidationError) {
      return failure(error.code, 400, error.message, correlationId, rateLimit, { fieldErrors: error.fieldErrors });
    }
    if (error instanceof VehicleResolutionRuntimeError) {
      return failure(error.code, error.status, error.message, correlationId, rateLimit, { retryable: error.retryable });
    }
    return unknownFailure(error, correlationId, rateLimit);
  }
}

export async function GET(request: Request) {
  let correlationId = correlationIdForRequest(request);
  let rateLimit: IntegrationRateLimitResult | null = null;

  try {
    const context = await prepareIntegrationRequest(request, "vehicle:read", {
      rateLimit: POLL_BURST_BUDGET,
    });
    correlationId = context.correlationId;
    rateLimit = context.rateLimit;

    if (rateLimit && !rateLimit.allowed) {
      return rateLimited("Vehicle resolution polling rate limit exceeded.", correlationId, rateLimit);
    }

    const resolutionId = validateOpaqueId(new URL(request.url).searchParams.get("resolutionId"), "resolutionId");
    const principalHash = servicePrincipalHash(context.service);
    const result = await getVehicleResolution(resolutionId, principalHash);
    if (!result) {
      return failure("RESOLUTION_NOT_FOUND", 404, "Vehicle resolution was not found.", correlationId, rateLimit);
    }

    return success(result, result.status === "PENDING" ? 202 : 200, correlationId, rateLimit);
  } catch (error) {
    if (error instanceof ServiceAccessError) {
      return failure(serviceErrorCode(error), error.status, error.message, correlationId, rateLimit, {
        retryable: error.status === 503,
      });
    }
    if (error instanceof ContractValidationError) {
      return failure(error.code, 400, error.message, correlationId, rateLimit, { fieldErrors: error.fieldErrors });
    }
    if (error instanceof VehicleResolutionRuntimeError) {
      return failure(error.code, error.status, error.message, correlationId, rateLimit, { retryable: error.retryable });
    }
    return unknownFailure(error, correlationId, rateLimit);
  }
}
