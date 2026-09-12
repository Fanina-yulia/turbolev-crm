-- P1-01: explicit operational service type for route classification.

CREATE TYPE "ServiceCatalogServiceType" AS ENUM ('DIAGNOSTIC', 'REPAIR', 'BOTH');

ALTER TABLE "ServiceCatalogItem"
  ADD COLUMN "serviceType" "ServiceCatalogServiceType" NOT NULL DEFAULT 'REPAIR';

UPDATE "ServiceCatalogItem"
SET "serviceType" = 'DIAGNOSTIC'
WHERE "itemType" = 'DIAGNOSTIC';

CREATE INDEX "ServiceCatalogItem_serviceType_isActive_reviewStatus_idx"
  ON "ServiceCatalogItem" ("serviceType", "isActive", "reviewStatus");
