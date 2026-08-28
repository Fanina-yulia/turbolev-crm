import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";

export type RequestRateLimitBudget = {
  bucketKey: string;
  limit: number;
  windowSeconds: number;
  identity?: string;
};

export type RequestRateLimitResult = {
  allowed: boolean;
  limit: number;
  count: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: string;
};

function clientAddress(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function enforceRequestRateLimit(
  request: Request,
  input: RequestRateLimitBudget,
  now = new Date(),
): Promise<RequestRateLimitResult> {
  const bucketKey = input.bucketKey.trim().slice(0, 160);
  const limit = Math.trunc(input.limit);
  const windowSeconds = Math.trunc(input.windowSeconds);
  if (!bucketKey || !Number.isFinite(limit) || limit < 1 || !Number.isFinite(windowSeconds) || windowSeconds < 1 || windowSeconds > 86_400) {
    throw new Error("INVALID_RATE_LIMIT");
  }
  const principalHash = hash(`${bucketKey}:${clientAddress(request)}:${input.identity?.trim().slice(0, 160) || ""}`);
  const windowMs = windowSeconds * 1000;
  const windowStartMs = Math.floor(now.getTime() / windowMs) * windowMs;
  const windowStart = new Date(windowStartMs);
  const resetAt = new Date(windowStartMs + windowMs);
  const expiresAt = new Date(resetAt.getTime() + 5 * 60_000);
  const rows = await getPrisma().$queryRaw<Array<{ count: number }>>(Prisma.sql`
    INSERT INTO "IntegrationRateLimitBucket"
      ("id", "principalHash", "bucketKey", "windowStart", "windowSeconds", "count", "expiresAt", "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${principalHash}, ${bucketKey}, ${windowStart}, ${windowSeconds}, 1, ${expiresAt}, ${now}, ${now})
    ON CONFLICT ("principalHash", "bucketKey", "windowStart", "windowSeconds")
    DO UPDATE SET "count" = "IntegrationRateLimitBucket"."count" + 1, "updatedAt" = EXCLUDED."updatedAt", "expiresAt" = EXCLUDED."expiresAt"
    RETURNING "count"
  `);
  const count = Number(rows[0]?.count ?? limit + 1);
  return {
    allowed: count <= limit,
    limit,
    count,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000)),
    resetAt: resetAt.toISOString(),
  };
}

export function requestRateLimitHeaders(result: RequestRateLimitResult) {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": result.resetAt,
    ...(result.allowed ? {} : { "Retry-After": String(result.retryAfterSeconds) }),
  };
}
