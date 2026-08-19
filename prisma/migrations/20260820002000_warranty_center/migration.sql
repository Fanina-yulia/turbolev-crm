CREATE TYPE "WarrantyClaimStatus" AS ENUM ('OPEN', 'REVIEW', 'APPROVED', 'REJECTED', 'CLOSED');

CREATE TABLE "WarrantyClaim" (
    "id" TEXT NOT NULL,
    "workOrderLineId" TEXT NOT NULL,
    "status" "WarrantyClaimStatus" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT NOT NULL,
    "mileageKmAtClaim" INTEGER,
    "resolution" TEXT,
    "openedByUserId" VARCHAR(64),
    "openedByName" VARCHAR(160),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarrantyClaim_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WarrantyClaim_workOrderLineId_status_idx" ON "WarrantyClaim"("workOrderLineId", "status");
CREATE INDEX "WarrantyClaim_status_createdAt_idx" ON "WarrantyClaim"("status", "createdAt");
CREATE INDEX "WarrantyClaim_createdAt_idx" ON "WarrantyClaim"("createdAt");

ALTER TABLE "WarrantyClaim"
ADD CONSTRAINT "WarrantyClaim_workOrderLineId_fkey"
FOREIGN KEY ("workOrderLineId") REFERENCES "WorkOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
