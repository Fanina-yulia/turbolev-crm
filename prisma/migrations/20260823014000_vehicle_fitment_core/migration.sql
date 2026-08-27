-- DB-ENG-VEH-001 Phase B: canonical CRM↔catalog vehicle links and product fitment.
-- Additive only. This migration does not backfill or activate VERIFIED compatibility.

CREATE TYPE "VehicleReferenceLinkStatus" AS ENUM ('PROVISIONAL', 'VERIFIED', 'STALE', 'CONFLICT');
CREATE TYPE "VehicleFitmentStatus" AS ENUM ('ACTIVE', 'DEPRECATED', 'REVIEW_REQUIRED', 'DISABLED');
CREATE TYPE "VehicleFitmentCriterionOperator" AS ENUM ('EQ', 'IN', 'RANGE', 'EXISTS', 'NOT_EQ');

CREATE TABLE "VehicleCatalogLink" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "vehicleReferenceId" TEXT NOT NULL,
    "status" "VehicleReferenceLinkStatus" NOT NULL DEFAULT 'PROVISIONAL',
    "confidence" INTEGER NOT NULL,
    "source" VARCHAR(64) NOT NULL,
    "sourceVersion" VARCHAR(80),
    "evidence" JSONB,
    "confirmedAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VehicleCatalogLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VehicleFitment" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "vehicleReferenceId" TEXT NOT NULL,
    "genericArticleId" TEXT,
    "status" "VehicleFitmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "position" VARCHAR(80),
    "validFromYear" SMALLINT,
    "validFromMonth" SMALLINT,
    "validToYear" SMALLINT,
    "validToMonth" SMALLINT,
    "source" VARCHAR(64) NOT NULL,
    "sourceVersion" VARCHAR(80),
    "sourceFitmentId" VARCHAR(180) NOT NULL,
    "confidence" INTEGER,
    "notes" TEXT,
    "rawEvidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VehicleFitment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VehicleFitmentCriterion" (
    "id" TEXT NOT NULL,
    "vehicleFitmentId" TEXT NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "operator" "VehicleFitmentCriterionOperator" NOT NULL DEFAULT 'EQ',
    "valueText" VARCHAR(200),
    "valueNormalized" VARCHAR(200),
    "valueNumber" DECIMAL(16,4),
    "valueNumberTo" DECIMAL(16,4),
    "unit" VARCHAR(32),
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "displayText" VARCHAR(240),
    "metadata" JSONB,
    CONSTRAINT "VehicleFitmentCriterion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vehicle_catalog_link_vehicle_uq" ON "VehicleCatalogLink"("vehicleId");
CREATE INDEX "vehicle_catalog_link_reference_status_idx" ON "VehicleCatalogLink"("vehicleReferenceId", "status");
CREATE INDEX "vehicle_catalog_link_status_verified_idx" ON "VehicleCatalogLink"("status", "lastVerifiedAt");

CREATE UNIQUE INDEX "vehicle_fitment_source_identity_uq" ON "VehicleFitment"("source", "sourceFitmentId");
CREATE INDEX "vehicle_fitment_product_status_idx" ON "VehicleFitment"("productId", "status");
CREATE INDEX "vehicle_fitment_reference_status_idx" ON "VehicleFitment"("vehicleReferenceId", "status");
CREATE INDEX "vehicle_fitment_reference_article_status_idx" ON "VehicleFitment"("vehicleReferenceId", "genericArticleId", "status");
CREATE INDEX "vehicle_fitment_source_version_idx" ON "VehicleFitment"("source", "sourceVersion");

CREATE INDEX "vehicle_fitment_criterion_required_idx" ON "VehicleFitmentCriterion"("vehicleFitmentId", "isMandatory");
CREATE INDEX "vehicle_fitment_criterion_text_idx" ON "VehicleFitmentCriterion"("key", "valueNormalized");
CREATE INDEX "vehicle_fitment_criterion_number_idx" ON "VehicleFitmentCriterion"("key", "valueNumber");

ALTER TABLE "VehicleCatalogLink"
  ADD CONSTRAINT "vehicle_catalog_link_vehicle_fk"
  FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VehicleCatalogLink"
  ADD CONSTRAINT "vehicle_catalog_link_reference_fk"
  FOREIGN KEY ("vehicleReferenceId") REFERENCES "VehicleReference"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VehicleFitment"
  ADD CONSTRAINT "vehicle_fitment_product_fk"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VehicleFitment"
  ADD CONSTRAINT "vehicle_fitment_reference_fk"
  FOREIGN KEY ("vehicleReferenceId") REFERENCES "VehicleReference"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VehicleFitment"
  ADD CONSTRAINT "vehicle_fitment_generic_article_fk"
  FOREIGN KEY ("genericArticleId") REFERENCES "GenericArticle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VehicleFitmentCriterion"
  ADD CONSTRAINT "vehicle_fitment_criterion_fitment_fk"
  FOREIGN KEY ("vehicleFitmentId") REFERENCES "VehicleFitment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VehicleCatalogLink"
  ADD CONSTRAINT "vehicle_catalog_link_confidence_check" CHECK ("confidence" >= 0 AND "confidence" <= 100);

ALTER TABLE "VehicleFitment"
  ADD CONSTRAINT "vehicle_fitment_confidence_check" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 100)),
  ADD CONSTRAINT "vehicle_fitment_from_year_check" CHECK ("validFromYear" IS NULL OR ("validFromYear" >= 1886 AND "validFromYear" <= 2200)),
  ADD CONSTRAINT "vehicle_fitment_to_year_check" CHECK ("validToYear" IS NULL OR ("validToYear" >= 1886 AND "validToYear" <= 2200)),
  ADD CONSTRAINT "vehicle_fitment_from_month_check" CHECK ("validFromMonth" IS NULL OR ("validFromMonth" >= 1 AND "validFromMonth" <= 12)),
  ADD CONSTRAINT "vehicle_fitment_to_month_check" CHECK ("validToMonth" IS NULL OR ("validToMonth" >= 1 AND "validToMonth" <= 12)),
  ADD CONSTRAINT "vehicle_fitment_date_order_check" CHECK (
    "validFromYear" IS NULL OR "validToYear" IS NULL OR
    "validFromYear" < "validToYear" OR
    ("validFromYear" = "validToYear" AND ("validFromMonth" IS NULL OR "validToMonth" IS NULL OR "validFromMonth" <= "validToMonth"))
  );

ALTER TABLE "VehicleFitmentCriterion"
  ADD CONSTRAINT "vehicle_fitment_criterion_value_check" CHECK (
    "operator" = 'EXISTS' OR
    "valueText" IS NOT NULL OR
    "valueNormalized" IS NOT NULL OR
    "valueNumber" IS NOT NULL
  ),
  ADD CONSTRAINT "vehicle_fitment_criterion_range_check" CHECK (
    "operator" <> 'RANGE' OR
    ("valueNumber" IS NOT NULL AND "valueNumberTo" IS NOT NULL AND "valueNumber" <= "valueNumberTo")
  );
