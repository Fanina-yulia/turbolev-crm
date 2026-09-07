-- Provider fitment cache/evidence for BM Parts and auditable vehicle-scoped searches.
-- Additive only: no existing catalog rows are removed or rewritten.

CREATE TABLE "ProviderVehicleContext" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "externalVehicleId" VARCHAR(180),
    "externalSecurityKey" VARCHAR(180),
    "catalogCode" VARCHAR(80),
    "brand" VARCHAR(120),
    "model" VARCHAR(180),
    "variant" VARCHAR(180),
    "source" VARCHAR(80) NOT NULL,
    "sourceVersion" VARCHAR(80),
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "exact" BOOLEAN NOT NULL DEFAULT false,
    "rawEvidence" JSONB,
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProviderVehicleContext_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProviderFitmentSearchAudit" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT,
    "provider" VARCHAR(64) NOT NULL,
    "query" VARCHAR(180) NOT NULL,
    "position" VARCHAR(120),
    "status" VARCHAR(48) NOT NULL,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "fitmentExact" BOOLEAN NOT NULL DEFAULT false,
    "sourceVersion" VARCHAR(80),
    "errorCode" VARCHAR(80),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderFitmentSearchAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provider_vehicle_context_vehicle_provider_uq"
  ON "ProviderVehicleContext"("vehicleId", "provider");
CREATE INDEX "provider_vehicle_context_provider_external_idx"
  ON "ProviderVehicleContext"("provider", "externalVehicleId");
CREATE INDEX "provider_vehicle_context_expires_idx"
  ON "ProviderVehicleContext"("expiresAt");

CREATE INDEX "provider_fitment_audit_vehicle_provider_idx"
  ON "ProviderFitmentSearchAudit"("vehicleId", "provider", "createdAt");
CREATE INDEX "provider_fitment_audit_provider_created_idx"
  ON "ProviderFitmentSearchAudit"("provider", "createdAt");

ALTER TABLE "ProviderVehicleContext"
  ADD CONSTRAINT "provider_vehicle_context_vehicle_fk"
  FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProviderFitmentSearchAudit"
  ADD CONSTRAINT "provider_fitment_audit_vehicle_fk"
  FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProviderVehicleContext"
  ADD CONSTRAINT "provider_vehicle_context_confidence_check"
  CHECK ("confidence" >= 0 AND "confidence" <= 100);
