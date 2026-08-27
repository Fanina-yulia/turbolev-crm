import { NextResponse } from "next/server";
import {
  API_VERSION,
  ContractValidationError,
  parsePublicLeadRequestV1,
  type ApiErrorCode,
  type ApiFailure,
  type ApiSuccess,
  type PublicLeadAcceptanceDto,
} from "@/src/lib/contracts/integration/v1";
import {
  abandonIdempotentOperation,
  beginIdempotentOperation,
  completeIdempotentOperation,
  correlationIdForRequest,
  integrationRateLimitHeaders,
  prepareIntegrationRequest,
  requiredIdempotencyKey,
  type IntegrationRateLimitResult,
} from "@/src/security/integration-api-request-guard";
import { ServiceAccessError } from "@/src/security/service-access-context";
import { acceptPublicLeadV1 } from "@/src/services/integration-public-lead.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POST_OPERATION = "POST:/api/integration/v1/leads";

function meta(correlationId: string) {
  return {
    correlationId,
    apiVersion: API_VERSION,
    servedAt: new Date().toISOString(),
  } as const;
}

function responseHeaders(
  correlationId: string,
  rateLimit: IntegrationRateLimitResult | null,
  extra: Record<string, string> = {},
) {
  return {
    "Cache-Control": "no-store",
    "X-Correlation-Id": correlationId,
    ...(rateLimit ? integrationRateLimitHeaders(rateLimit) : {}),
    ...extra,
  };
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

export async function POST(request: Request) {
  let correlationId = correlationIdForRequest(request);
  let rateLimit: IntegrationRateLimitResult | null = null;
  let acquired: { recordId: string; requestFingerprint: string } | null = null;

  try {
    const context = await prepareIntegrationRequest(request, "lead:submit", {
      rateLimit: { bucketKey: "lead.submit", limit: 60, windowSeconds: 60 },
    });
    correlationId = context.correlationId;
    rateLimit = context.rateLimit;

    if (rateLimit && !rateLimit.allowed) {
      return failure("RATE_LIMITED", 429, "Lead intake rate limit exceeded.", correlationId, rateLimit, {
        retryable: true,
        details: { retryAfterSeconds: rateLimit.retryAfterSeconds },
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      });
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      throw new ContractValidationError("INVALID_REQUEST", "Тіло запиту повинно містити коректний JSON.");
    }

    const leadRequest = parsePublicLeadRequestV1(payload);
    const idempotencyKey = requiredIdempotencyKey(request);
    const idempotency = await beginIdempotentOperation({
      service: context.service,
      operationKey: POST_OPERATION,
      idempotencyKey,
      payload: leadRequest,
    });

    if (idempotency.kind === "CONFLICT") {
      return failure(
        "IDEMPOTENCY_CONFLICT",
        409,
        "Idempotency key was already used with another lead payload.",
        correlationId,
        rateLimit,
      );
    }

    if (idempotency.kind === "IN_PROGRESS") {
      return failure(
        "IDEMPOTENCY_CONFLICT",
        409,
        "An identical lead request is still being accepted.",
        correlationId,
        rateLimit,
        {
          retryable: true,
          details: { retryAfterSeconds: idempotency.retryAfterSeconds },
          headers: { "Retry-After": String(idempotency.retryAfterSeconds) },
        },
      );
    }

    if (idempotency.kind === "REPLAY") {
      return NextResponse.json(idempotency.responseBody, {
        status: idempotency.responseStatus,
        headers: responseHeaders(correlationId, rateLimit, { "X-Idempotency-Replayed": "true" }),
      });
    }

    acquired = {
      recordId: idempotency.recordId,
      requestFingerprint: idempotency.requestFingerprint,
    };

    const accepted = await acceptPublicLeadV1({
      request: leadRequest,
      idempotencyKey,
      correlationId,
    });
    const body: ApiSuccess<PublicLeadAcceptanceDto> = {
      ok: true,
      data: accepted,
      meta: meta(correlationId),
    };

    await completeIdempotentOperation({
      recordId: acquired.recordId,
      requestFingerprint: acquired.requestFingerprint,
      responseStatus: 201,
      responseBody: body,
    });
    acquired = null;

    return NextResponse.json(body, {
      status: 201,
      headers: responseHeaders(correlationId, rateLimit),
    });
  } catch (error) {
    if (acquired) {
      await abandonIdempotentOperation(acquired).catch(() => undefined);
    }

    if (error instanceof ServiceAccessError) {
      return failure(error.code, error.status, error.message, correlationId, rateLimit, {
        retryable: error.status === 503,
      });
    }

    if (error instanceof ContractValidationError) {
      return failure(error.code, 400, error.message, correlationId, rateLimit, {
        fieldErrors: error.fieldErrors,
      });
    }

    console.error("integration public lead intake failed", {
      correlationId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return failure(
      "INTEGRATION_UNAVAILABLE",
      503,
      "Lead intake is temporarily unavailable.",
      correlationId,
      rateLimit,
      { retryable: true },
    );
  }
}
