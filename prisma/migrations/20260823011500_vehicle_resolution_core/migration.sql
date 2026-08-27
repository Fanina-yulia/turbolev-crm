-- DB-ENG-VEH-001 Phase A: canonical vehicle identity/resolution storage.
-- Additive only. This migration does not activate public routes or mutate legacy Vehicle rows.
-- Privacy invariant: raw VIN/registration plate must NOT be stored in VehicleResolution;
-- requestFingerprint is intended for secret-keyed/HMAC request identity.

-- CreateEnum
CREATE TYPE "VehicleReferenceStatus" AS ENUM ('ACTIVE', 'DEPRECATED', 'MERGED', 'DISABLED');

-- CreateEnum
CREATE TYPE "VehicleResolutionStatus" AS ENUM ('PENDING', 'RESOLVED', 'AMBIGUOUS', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "VehicleResolutionInputType" AS ENUM ('VIN', 'PLATE', 'MANUAL', 'CRM_VEHICLE', 'REGISTRY');

-- CreateTable
CREATE TABLE "VehicleReference" (
    "id" TEXT NOT NULL,
    "fitmentKey" VARCHAR(40) NOT NULL,
    "status" "VehicleReferenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "make" VARCHAR(80) NOT NULL,
    "makeNormalized" VARCHAR(80) NOT NULL,
    "model" VARCHAR(100) NOT NULL,
    "modelNormalized" VARCHAR(100) NOT NULL,
    "generation" VARCHAR(120),
    "generationNormalized" VARCHAR(120),
    "modification" VARCHAR(160),
    "productionStartYear" SMALLINT,
    "productionStartMonth" SMALLINT,
    "productionEndYear" SMALLINT,
    "productionEndMonth" SMALLINT,
    "engineName" VARCHAR(160),
    "engineCode" VARCHAR(80),
    "engineCodeNormalized" VARCHAR(80),
    "displacementCm3" INTEGER,
    "cylinders" SMALLINT,
    "powerKw" SMALLINT,
    "powerHp" SMALLINT,
    "fuelType" VARCHAR(48),
    "bodyType" VARCHAR(80),
    "driveType" VARCHAR(48),
    "transmissionType" VARCHAR(80),
    "transmissionCode" VARCHAR(80),
    "market" VARCHAR(32),
    "canonicalFingerprint" VARCHAR(64),
    "confidence" INTEGER,
    "mergedIntoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleReference_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vehicle_reference_confidence_check" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 100)),
    CONSTRAINT "vehicle_reference_start_year_check" CHECK ("productionStartYear" IS NULL OR ("productionStartYear" >= 1886 AND "productionStartYear" <= 2200)),
    CONSTRAINT "vehicle_reference_end_year_check" CHECK ("productionEndYear" IS NULL OR ("productionEndYear" >= 1886 AND "productionEndYear" <= 2200)),
    CONSTRAINT "vehicle_reference_start_month_check" CHECK ("productionStartMonth" IS NULL OR ("productionStartMonth" >= 1 AND "productionStartMonth" <= 12)),
    CONSTRAINT "vehicle_reference_end_month_check" CHECK ("productionEndMonth" IS NULL OR ("productionEndMonth" >= 1 AND "productionEndMonth" <= 12)),
    CONSTRAINT "vehicle_reference_year_order_check" CHECK ("productionStartYear" IS NULL OR "productionEndYear" IS NULL OR "productionEndYear" >= "productionStartYear"),
    CONSTRAINT "vehicle_reference_displacement_check" CHECK ("displacementCm3" IS NULL OR "displacementCm3" > 0),
    CONSTRAINT "vehicle_reference_cylinders_check" CHECK ("cylinders" IS NULL OR "cylinders" > 0),
    CONSTRAINT "vehicle_reference_power_kw_check" CHECK ("powerKw" IS NULL OR "powerKw" > 0),
    CONSTRAINT "vehicle_reference_power_hp_check" CHECK ("powerHp" IS NULL OR "powerHp" > 0)
);

-- CreateTable
CREATE TABLE "VehicleReferenceExternalId" (
    "id" TEXT NOT NULL,
    "vehicleReferenceId" TEXT NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "externalType" VARCHAR(64) NOT NULL,
    "externalId" VARCHAR(160) NOT NULL,
    "sourceVersion" VARCHAR(80),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "VehicleReferenceExternalId_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleResolution" (
    "id" TEXT NOT NULL,
    "status" "VehicleResolutionStatus" NOT NULL DEFAULT 'PENDING',
    "inputType" "VehicleResolutionInputType" NOT NULL,
    "vehicleReferenceId" TEXT,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "source" VARCHAR(64),
    "sourceVersion" VARCHAR(80),
    "requestFingerprint" VARCHAR(96) NOT NULL,
    "normalizedInput" JSONB,
    "normalizedFacts" JSONB,
    "missingCriteria" JSONB,
    "evidence" JSONB,
    "resolutionPolicy" VARCHAR(40) NOT NULL,
    "correlationId" VARCHAR(80),
    "errorCode" VARCHAR(80),
    "errorDetail" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleResolution_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vehicle_resolution_confidence_check" CHECK ("confidence" >= 0 AND "confidence" <= 100),
    CONSTRAINT "vehicle_resolution_expiry_check" CHECK ("expiresAt" > "createdAt")
);

-- CreateTable
CREATE TABLE "VehicleResolutionCandidate" (
    "id" TEXT NOT NULL,
    "vehicleResolutionId" TEXT NOT NULL,
    "vehicleReferenceId" TEXT NOT NULL,
    "rank" SMALLINT NOT NULL,
    "score" INTEGER NOT NULL,
    "discriminators" JSONB,
    "evidence" JSONB,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleResolutionCandidate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vehicle_resolution_candidate_rank_check" CHECK ("rank" > 0),
    CONSTRAINT "vehicle_resolution_candidate_score_check" CHECK ("score" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_reference_fitment_key_uq" ON "VehicleReference"("fitmentKey");
CREATE UNIQUE INDEX "vehicle_reference_fingerprint_uq" ON "VehicleReference"("canonicalFingerprint");
CREATE INDEX "vehicle_reference_make_model_idx" ON "VehicleReference"("makeNormalized", "modelNormalized");
CREATE INDEX "vehicle_reference_make_model_years_idx" ON "VehicleReference"("makeNormalized", "modelNormalized", "productionStartYear", "productionEndYear");
CREATE INDEX "vehicle_reference_engine_code_idx" ON "VehicleReference"("engineCodeNormalized");
CREATE INDEX "vehicle_reference_status_updated_idx" ON "VehicleReference"("status", "updatedAt");
CREATE INDEX "vehicle_reference_merged_into_idx" ON "VehicleReference"("mergedIntoId");

CREATE UNIQUE INDEX "vehicle_reference_external_identity_uq" ON "VehicleReferenceExternalId"("provider", "externalType", "externalId");
CREATE INDEX "vehicle_reference_external_provider_idx" ON "VehicleReferenceExternalId"("vehicleReferenceId", "provider");
CREATE INDEX "vehicle_reference_external_version_idx" ON "VehicleReferenceExternalId"("provider", "sourceVersion");

CREATE INDEX "vehicle_resolution_status_expiry_idx" ON "VehicleResolution"("status", "expiresAt");
CREATE INDEX "vehicle_resolution_reference_status_idx" ON "VehicleResolution"("vehicleReferenceId", "status");
CREATE INDEX "vehicle_resolution_fingerprint_created_idx" ON "VehicleResolution"("requestFingerprint", "createdAt");
CREATE INDEX "vehicle_resolution_correlation_idx" ON "VehicleResolution"("correlationId");

CREATE UNIQUE INDEX "vehicle_resolution_candidate_reference_uq" ON "VehicleResolutionCandidate"("vehicleResolutionId", "vehicleReferenceId");
CREATE INDEX "vehicle_resolution_candidate_rank_idx" ON "VehicleResolutionCandidate"("vehicleResolutionId", "rank");
CREATE INDEX "vehicle_resolution_candidate_reference_idx" ON "VehicleResolutionCandidate"("vehicleReferenceId");

-- AddForeignKey
ALTER TABLE "VehicleReference"
ADD CONSTRAINT "vehicle_reference_merged_into_fk"
FOREIGN KEY ("mergedIntoId") REFERENCES "VehicleReference"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VehicleReferenceExternalId"
ADD CONSTRAINT "vehicle_reference_external_ref_fk"
FOREIGN KEY ("vehicleReferenceId") REFERENCES "VehicleReference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VehicleResolution"
ADD CONSTRAINT "vehicle_resolution_reference_fk"
FOREIGN KEY ("vehicleReferenceId") REFERENCES "VehicleReference"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VehicleResolutionCandidate"
ADD CONSTRAINT "vehicle_resolution_candidate_resolution_fk"
FOREIGN KEY ("vehicleResolutionId") REFERENCES "VehicleResolution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VehicleResolutionCandidate"
ADD CONSTRAINT "vehicle_resolution_candidate_reference_fk"
FOREIGN KEY ("vehicleReferenceId") REFERENCES "VehicleReference"("id") ON DELETE CASCADE ON UPDATE CASCADE;
