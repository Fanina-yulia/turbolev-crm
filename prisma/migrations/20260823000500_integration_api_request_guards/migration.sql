-- API-ENG-004: additive durable request-guard primitives for /integration/v1/*.
-- This migration is intentionally data-independent and does not activate any public route.

CREATE TYPE "IntegrationIdempotencyState" AS ENUM ('IN_PROGRESS', 'COMPLETED');

CREATE TABLE "IntegrationIdempotencyRecord" (
    "id" TEXT NOT NULL,
    "principalHash" VARCHAR(64) NOT NULL,
    "operationKey" VARCHAR(160) NOT NULL,
    "idempotencyKeyHash" VARCHAR(64) NOT NULL,
    "requestFingerprint" VARCHAR(64) NOT NULL,
    "state" "IntegrationIdempotencyState" NOT NULL DEFAULT 'IN_PROGRESS',
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationIdempotencyRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IntegrationRateLimitBucket" (
    "id" TEXT NOT NULL,
    "principalHash" VARCHAR(64) NOT NULL,
    "bucketKey" VARCHAR(160) NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowSeconds" INTEGER NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationRateLimitBucket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integration_idempotency_principal_op_key_uq"
ON "IntegrationIdempotencyRecord"("principalHash", "operationKey", "idempotencyKeyHash");

CREATE INDEX "IntegrationIdempotencyRecord_state_updatedAt_idx"
ON "IntegrationIdempotencyRecord"("state", "updatedAt");

CREATE INDEX "IntegrationIdempotencyRecord_expiresAt_idx"
ON "IntegrationIdempotencyRecord"("expiresAt");

CREATE UNIQUE INDEX "integration_rate_limit_principal_bucket_window_uq"
ON "IntegrationRateLimitBucket"("principalHash", "bucketKey", "windowStart", "windowSeconds");

CREATE INDEX "IntegrationRateLimitBucket_expiresAt_idx"
ON "IntegrationRateLimitBucket"("expiresAt");

ALTER TABLE "IntegrationRateLimitBucket"
ADD CONSTRAINT "IntegrationRateLimitBucket_windowSeconds_check" CHECK ("windowSeconds" > 0 AND "windowSeconds" <= 86400);

ALTER TABLE "IntegrationRateLimitBucket"
ADD CONSTRAINT "IntegrationRateLimitBucket_count_check" CHECK ("count" >= 0);
