import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import {
  ContractValidationError,
  validateCorrelationId,
  validateIdempotencyKey,
} from "@/src/lib/contracts/integration/v1";
import {
  requireServiceScope,
  servicePrincipalHash,
  type ServiceAccessContext,
  type ServiceScope,
} from "@/src/security/service-access-context";

export type IntegrationRateLimitBudget = {
  bucketKey: string;
  limit: number;
  windowSeconds: number;
};

export type IntegrationRateLimitResult = {
  allowed: boolean;
  limit: number;
  count: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: string;
};

export type IntegrationRequestContext = {
  correlationId: string;
  service: ServiceAccessContext;
  rateLimit: IntegrationRateLimitResult | null;
};

export type IdempotencyBeginResult =
  | { kind: "ACQUIRED"; recordId: string; requestFingerprint: string }
  | { kind: "REPLAY"; recordId: string; requestFingerprint: string; responseStatus: number; responseBody: unknown }
  | { kind: "IN_PROGRESS"; recordId: string; requestFingerprint: string; retryAfterSeconds: number }
  | { kind: "CONFLICT"; recordId: string; requestFingerprint: string };

type IdempotencyRow = {
  id: string;
  requestFingerprint: string;
  state: "IN_PROGRESS" | "COMPLETED";
  responseStatus: number | null;
  responseBody: Prisma.JsonValue | null;
  lockedAt: Date;
  expiresAt: Date;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeForStableJson(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => normalizeForStableJson(item, seen));
  if (typeof value === "object") {
    if (seen.has(value)) throw new TypeError("Circular value cannot be fingerprinted.");
    seen.add(value);
    const record = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined || typeof record[key] === "function" || typeof record[key] === "symbol") continue;
      normalized[key] = normalizeForStableJson(record[key], seen);
    }
    seen.delete(value);
    return normalized;
  }
  return null;
}

export function stableRequestFingerprint(operationKey: string, payload: unknown) {
  const normalized = normalizeForStableJson(payload);
  return sha256(`${operationKey}\n${JSON.stringify(normalized)}`);
}

export function correlationIdForRequest(request: Request) {
  return validateCorrelationId(request.headers.get("x-correlation-id")) || randomUUID();
}

export function requiredIdempotencyKey(request: Request) {
  const value = validateIdempotencyKey(request.headers.get("x-idempotency-key"));
  if (!value) {
    throw new ContractValidationError("INVALID_REQUEST", "X-Idempotency-Key is required for this operation.", {
      idempotencyKey: "REQUIRED",
    });
  }
  return value;
}

function normalizeOperationKey(value: string) {
  const result = value.trim().slice(0, 160);
  if (!result || !/^[A-Za-z0-9._:/-]+$/.test(result)) throw new Error("INVALID_OPERATION_KEY");
  return result;
}

function normalizeBudget(input: IntegrationRateLimitBudget) {
  const bucketKey = normalizeOperationKey(input.bucketKey);
  const limit = Math.trunc(input.limit);
  const windowSeconds = Math.trunc(input.windowSeconds);
  if (!Number.isFinite(limit) || limit < 1 || limit > 1_000_000) throw new Error("INVALID_RATE_LIMIT");
  if (!Number.isFinite(windowSeconds) || windowSeconds < 1 || windowSeconds > 86_400) throw new Error("INVALID_RATE_WINDOW");
  return { bucketKey, limit, windowSeconds };
}

export async function enforceIntegrationRateLimit(
  service: Pick<ServiceAccessContext, "subject" | "environment">,
  budget: IntegrationRateLimitBudget,
  now = new Date(),
): Promise<IntegrationRateLimitResult> {
  const normalized = normalizeBudget(budget);
  const principalHash = servicePrincipalHash(service);
  const windowMs = normalized.windowSeconds * 1000;
  const windowStartMs = Math.floor(now.getTime() / windowMs) * windowMs;
  const windowStart = new Date(windowStartMs);
  const resetAt = new Date(windowStartMs + windowMs);
  const expiresAt = new Date(resetAt.getTime() + 5 * 60_000);
  const id = randomUUID();
  const prisma = getPrisma();

  const rows = await prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    INSERT INTO "IntegrationRateLimitBucket"
      ("id", "principalHash", "bucketKey", "windowStart", "windowSeconds", "count", "expiresAt", "createdAt", "updatedAt")
    VALUES
      (${id}, ${principalHash}, ${normalized.bucketKey}, ${windowStart}, ${normalized.windowSeconds}, 1, ${expiresAt}, ${now}, ${now})
    ON CONFLICT ("principalHash", "bucketKey", "windowStart", "windowSeconds")
    DO UPDATE SET
      "count" = "IntegrationRateLimitBucket"."count" + 1,
      "updatedAt" = EXCLUDED."updatedAt",
      "expiresAt" = EXCLUDED."expiresAt"
    RETURNING "count"
  `);

  const count = rows[0]?.count ?? normalized.limit + 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000));
  return {
    allowed: count <= normalized.limit,
    limit: normalized.limit,
    count,
    remaining: Math.max(0, normalized.limit - count),
    retryAfterSeconds,
    resetAt: resetAt.toISOString(),
  };
}

export async function prepareIntegrationRequest(
  request: Request,
  requiredScope: ServiceScope,
  options: {
    rateLimit?: IntegrationRateLimitBudget | null;
    auth?: Parameters<typeof requireServiceScope>[2];
  } = {},
): Promise<IntegrationRequestContext> {
  const correlationId = correlationIdForRequest(request);
  const service = await requireServiceScope(request, requiredScope, options.auth);
  const rateLimit = options.rateLimit ? await enforceIntegrationRateLimit(service, options.rateLimit) : null;
  return { correlationId, service, rateLimit };
}

async function readIdempotencyRow(
  principalHash: string,
  operationKey: string,
  idempotencyKeyHash: string,
): Promise<IdempotencyRow | null> {
  return getPrisma().integrationIdempotencyRecord.findUnique({
    where: {
      principalHash_operationKey_idempotencyKeyHash: {
        principalHash,
        operationKey,
        idempotencyKeyHash,
      },
    },
    select: {
      id: true,
      requestFingerprint: true,
      state: true,
      responseStatus: true,
      responseBody: true,
      lockedAt: true,
      expiresAt: true,
    },
  });
}

export async function beginIdempotentOperation(input: {
  service: Pick<ServiceAccessContext, "subject" | "environment">;
  operationKey: string;
  idempotencyKey: string;
  payload: unknown;
  ttlSeconds?: number;
  takeoverAfterSeconds?: number;
  now?: Date;
}): Promise<IdempotencyBeginResult> {
  const operationKey = normalizeOperationKey(input.operationKey);
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  if (!idempotencyKey) throw new Error("IDEMPOTENCY_KEY_REQUIRED");
  const principalHash = servicePrincipalHash(input.service);
  const idempotencyKeyHash = sha256(idempotencyKey);
  const requestFingerprint = stableRequestFingerprint(operationKey, input.payload);
  const now = input.now ?? new Date();
  const ttlSeconds = Math.min(Math.max(Math.trunc(input.ttlSeconds ?? 86_400), 60), 7 * 86_400);
  const takeoverAfterSeconds = Math.min(Math.max(Math.trunc(input.takeoverAfterSeconds ?? 30), 5), 300);
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  const recordId = randomUUID();
  const prisma = getPrisma();

  const inserted = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    INSERT INTO "IntegrationIdempotencyRecord"
      ("id", "principalHash", "operationKey", "idempotencyKeyHash", "requestFingerprint", "state", "lockedAt", "expiresAt", "createdAt", "updatedAt")
    VALUES
      (${recordId}, ${principalHash}, ${operationKey}, ${idempotencyKeyHash}, ${requestFingerprint}, 'IN_PROGRESS'::"IntegrationIdempotencyState", ${now}, ${expiresAt}, ${now}, ${now})
    ON CONFLICT ("principalHash", "operationKey", "idempotencyKeyHash") DO NOTHING
    RETURNING "id"
  `);
  if (inserted.length) return { kind: "ACQUIRED", recordId: inserted[0].id, requestFingerprint };

  let existing = await readIdempotencyRow(principalHash, operationKey, idempotencyKeyHash);
  if (!existing) throw new Error("IDEMPOTENCY_ROW_LOST");

  if (existing.expiresAt.getTime() <= now.getTime()) {
    await prisma.integrationIdempotencyRecord.deleteMany({
      where: { id: existing.id, expiresAt: { lte: now } },
    });
    return beginIdempotentOperation({ ...input, now });
  }

  if (existing.requestFingerprint !== requestFingerprint) {
    return { kind: "CONFLICT", recordId: existing.id, requestFingerprint };
  }

  if (existing.state === "COMPLETED" && existing.responseStatus !== null) {
    return {
      kind: "REPLAY",
      recordId: existing.id,
      requestFingerprint,
      responseStatus: existing.responseStatus,
      responseBody: existing.responseBody,
    };
  }

  const staleBefore = new Date(now.getTime() - takeoverAfterSeconds * 1000);
  if (existing.lockedAt <= staleBefore) {
    const takeover = await prisma.integrationIdempotencyRecord.updateMany({
      where: {
        id: existing.id,
        state: "IN_PROGRESS",
        requestFingerprint,
        lockedAt: { lte: staleBefore },
      },
      data: { lockedAt: now },
    });
    if (takeover.count === 1) return { kind: "ACQUIRED", recordId: existing.id, requestFingerprint };
    existing = (await readIdempotencyRow(principalHash, operationKey, idempotencyKeyHash)) ?? existing;
  }

  const retryAfterSeconds = Math.max(1, Math.ceil(
    (existing.lockedAt.getTime() + takeoverAfterSeconds * 1000 - now.getTime()) / 1000,
  ));
  return { kind: "IN_PROGRESS", recordId: existing.id, requestFingerprint, retryAfterSeconds };
}

export async function completeIdempotentOperation(input: {
  recordId: string;
  requestFingerprint: string;
  responseStatus: number;
  responseBody: unknown;
  completedAt?: Date;
}) {
  const responseStatus = Math.trunc(input.responseStatus);
  if (responseStatus < 100 || responseStatus > 599) throw new Error("INVALID_RESPONSE_STATUS");
  const completedAt = input.completedAt ?? new Date();
  const result = await getPrisma().integrationIdempotencyRecord.updateMany({
    where: {
      id: input.recordId,
      state: "IN_PROGRESS",
      requestFingerprint: input.requestFingerprint,
    },
    data: {
      state: "COMPLETED",
      responseStatus,
      responseBody: toPrismaJson(input.responseBody),
      completedAt,
    },
  });
  if (result.count !== 1) throw new Error("IDEMPOTENCY_COMPLETION_CONFLICT");
}

export async function abandonIdempotentOperation(input: {
  recordId: string;
  requestFingerprint: string;
}) {
  await getPrisma().integrationIdempotencyRecord.deleteMany({
    where: {
      id: input.recordId,
      state: "IN_PROGRESS",
      requestFingerprint: input.requestFingerprint,
    },
  });
}

export async function cleanupExpiredIntegrationGuards(now = new Date(), take = 500) {
  const limit = Math.min(Math.max(Math.trunc(take), 1), 5_000);
  const prisma = getPrisma();
  const [idempotency, rateLimits] = await prisma.$transaction([
    prisma.integrationIdempotencyRecord.findMany({
      where: { expiresAt: { lte: now } },
      select: { id: true },
      take: limit,
      orderBy: { expiresAt: "asc" },
    }),
    prisma.integrationRateLimitBucket.findMany({
      where: { expiresAt: { lte: now } },
      select: { id: true },
      take: limit,
      orderBy: { expiresAt: "asc" },
    }),
  ]);
  const [deletedIdempotency, deletedRateLimits] = await prisma.$transaction([
    prisma.integrationIdempotencyRecord.deleteMany({ where: { id: { in: idempotency.map((row) => row.id) } } }),
    prisma.integrationRateLimitBucket.deleteMany({ where: { id: { in: rateLimits.map((row) => row.id) } } }),
  ]);
  return { idempotency: deletedIdempotency.count, rateLimits: deletedRateLimits.count };
}

export function integrationRateLimitHeaders(result: IntegrationRateLimitResult) {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": result.resetAt,
    ...(result.allowed ? {} : { "Retry-After": String(result.retryAfterSeconds) }),
  };
}
