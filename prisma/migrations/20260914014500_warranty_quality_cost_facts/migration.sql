CREATE TYPE "WarrantyCostCategory" AS ENUM ('LABOR', 'PART', 'EXTERNAL', 'OTHER');

ALTER TABLE "WarrantyClaim"
ADD COLUMN "correctiveWorkOrderId" VARCHAR(120);

CREATE TABLE "WarrantyClaimCostFact" (
  "id" TEXT NOT NULL,
  "warrantyClaimId" TEXT NOT NULL,
  "category" "WarrantyCostCategory" NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
  "sourceEntity" VARCHAR(40),
  "sourceEntityId" VARCHAR(120),
  "supplierId" VARCHAR(120),
  "note" TEXT,
  "recordedByUserId" VARCHAR(64),
  "recordedByName" VARCHAR(160),
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WarrantyClaimCostFact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WarrantyClaim_correctiveWorkOrderId_idx" ON "WarrantyClaim"("correctiveWorkOrderId");
CREATE INDEX "WarrantyClaimCostFact_warrantyClaimId_recordedAt_idx" ON "WarrantyClaimCostFact"("warrantyClaimId", "recordedAt");
CREATE INDEX "WarrantyClaimCostFact_category_recordedAt_idx" ON "WarrantyClaimCostFact"("category", "recordedAt");
CREATE INDEX "WarrantyClaimCostFact_sourceEntity_sourceEntityId_idx" ON "WarrantyClaimCostFact"("sourceEntity", "sourceEntityId");
CREATE INDEX "WarrantyClaimCostFact_supplierId_idx" ON "WarrantyClaimCostFact"("supplierId");

ALTER TABLE "WarrantyClaimCostFact"
ADD CONSTRAINT "WarrantyClaimCostFact_warrantyClaimId_fkey"
FOREIGN KEY ("warrantyClaimId") REFERENCES "WarrantyClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
