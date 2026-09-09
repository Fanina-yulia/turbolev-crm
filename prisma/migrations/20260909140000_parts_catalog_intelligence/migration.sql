CREATE TYPE "PartSoldAs" AS ENUM ('PIECE','PAIR','SET','KIT','ASSEMBLY','LITER','UNKNOWN');
CREATE TYPE "PartCatalogReviewStatus" AS ENUM ('DRAFT','PENDING_REVIEW','APPROVED','REJECTED','ARCHIVED');

ALTER TABLE "GenericArticle"
  ADD COLUMN "categoryCode" VARCHAR(80), ADD COLUMN "assembly" VARCHAR(120), ADD COLUMN "partType" VARCHAR(120),
  ADD COLUMN "axis" VARCHAR(16), ADD COLUMN "side" VARCHAR(16), ADD COLUMN "position" VARCHAR(32), ADD COLUMN "subPosition" VARCHAR(32),
  ADD COLUMN "quantityPerVehicle" DECIMAL(10,3) NOT NULL DEFAULT 1, ADD COLUMN "soldAs" "PartSoldAs" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "requiresVin" BOOLEAN NOT NULL DEFAULT true, ADD COLUMN "confidence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reviewStatus" "PartCatalogReviewStatus" NOT NULL DEFAULT 'DRAFT', ADD COLUMN "lastVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "lastVerifiedByUserId" VARCHAR(128), ADD COLUMN "successfulMatchCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "rejectedMatchCount" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "GenericArticle_reviewStatus_categoryCode_idx" ON "GenericArticle"("reviewStatus","categoryCode");
CREATE INDEX "GenericArticle_axis_side_position_idx" ON "GenericArticle"("axis","side","position");

CREATE TABLE "PartCatalogChange" (
  "id" TEXT NOT NULL, "genericArticleId" TEXT, "entityType" VARCHAR(64) NOT NULL, "entityId" VARCHAR(128) NOT NULL,
  "action" VARCHAR(64) NOT NULL, "status" VARCHAR(32) NOT NULL DEFAULT 'PENDING', "beforeData" JSONB, "afterData" JSONB,
  "reason" TEXT, "requestedByUserId" VARCHAR(128), "requestedByName" VARCHAR(160), "reviewedByUserId" VARCHAR(128),
  "reviewedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartCatalogChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PartCatalogChange_status_createdAt_idx" ON "PartCatalogChange"("status","createdAt");
CREATE INDEX "PartCatalogChange_entityType_entityId_idx" ON "PartCatalogChange"("entityType","entityId");
CREATE INDEX "PartCatalogChange_genericArticleId_createdAt_idx" ON "PartCatalogChange"("genericArticleId","createdAt");
ALTER TABLE "PartCatalogChange" ADD CONSTRAINT "PartCatalogChange_genericArticleId_fkey" FOREIGN KEY ("genericArticleId") REFERENCES "GenericArticle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PartSearchFeedback" (
  "id" TEXT NOT NULL, "genericArticleId" TEXT, "vehicleId" TEXT, "query" VARCHAR(240) NOT NULL, "provider" VARCHAR(64),
  "selectedArticle" VARCHAR(180), "selectedBrand" VARCHAR(120), "resultStatus" VARCHAR(40) NOT NULL, "reason" TEXT, "metadata" JSONB,
  "createdByUserId" VARCHAR(128), "createdByName" VARCHAR(160), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartSearchFeedback_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PartSearchFeedback_genericArticleId_createdAt_idx" ON "PartSearchFeedback"("genericArticleId","createdAt");
CREATE INDEX "PartSearchFeedback_vehicleId_createdAt_idx" ON "PartSearchFeedback"("vehicleId","createdAt");
CREATE INDEX "PartSearchFeedback_resultStatus_createdAt_idx" ON "PartSearchFeedback"("resultStatus","createdAt");
ALTER TABLE "PartSearchFeedback" ADD CONSTRAINT "PartSearchFeedback_genericArticleId_fkey" FOREIGN KEY ("genericArticleId") REFERENCES "GenericArticle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PartSearchFeedback" ADD CONSTRAINT "PartSearchFeedback_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PartRejectedMatch" (
  "id" TEXT NOT NULL, "genericArticleId" TEXT, "provider" VARCHAR(64), "article" VARCHAR(180), "brand" VARCHAR(120), "name" VARCHAR(240) NOT NULL,
  "reason" TEXT, "source" VARCHAR(64) NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true, "createdByUserId" VARCHAR(128), "createdByName" VARCHAR(160),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "PartRejectedMatch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PartRejectedMatch_genericArticleId_active_idx" ON "PartRejectedMatch"("genericArticleId","active");
CREATE INDEX "PartRejectedMatch_provider_article_idx" ON "PartRejectedMatch"("provider","article");
ALTER TABLE "PartRejectedMatch" ADD CONSTRAINT "PartRejectedMatch_genericArticleId_fkey" FOREIGN KEY ("genericArticleId") REFERENCES "GenericArticle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "RepairKit" (
  "id" TEXT NOT NULL, "code" VARCHAR(80) NOT NULL, "name" VARCHAR(180) NOT NULL, "description" TEXT, "status" "CatalogEntityStatus" NOT NULL DEFAULT 'DRAFT',
  "reviewStatus" "PartCatalogReviewStatus" NOT NULL DEFAULT 'DRAFT', "requiresVin" BOOLEAN NOT NULL DEFAULT true, "source" VARCHAR(64), "sourceVersion" VARCHAR(160),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "RepairKit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RepairKit_code_key" ON "RepairKit"("code");
CREATE INDEX "RepairKit_status_reviewStatus_idx" ON "RepairKit"("status","reviewStatus");
CREATE TABLE "RepairKitItem" (
  "id" TEXT NOT NULL, "repairKitId" TEXT NOT NULL, "genericArticleId" TEXT NOT NULL, "quantity" DECIMAL(10,3) NOT NULL DEFAULT 1, "required" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 100, "note" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RepairKitItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RepairKitItem_repairKitId_genericArticleId_key" ON "RepairKitItem"("repairKitId","genericArticleId");
CREATE INDEX "RepairKitItem_repairKitId_sortOrder_idx" ON "RepairKitItem"("repairKitId","sortOrder");
ALTER TABLE "RepairKitItem" ADD CONSTRAINT "RepairKitItem_repairKitId_fkey" FOREIGN KEY ("repairKitId") REFERENCES "RepairKit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RepairKitItem" ADD CONSTRAINT "RepairKitItem_genericArticleId_fkey" FOREIGN KEY ("genericArticleId") REFERENCES "GenericArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
