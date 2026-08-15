-- Commercial workflow v3: estimate approval snapshots + parts requests.
-- Must run after 20260815044500_workorder_line_items_v3.
-- Additive migration. Existing WorkOrders are not backfilled.

ALTER TABLE "WorkOrderLine"
  ADD COLUMN "requiredForRepair" BOOLEAN NOT NULL DEFAULT true;

CREATE TYPE "WorkOrderEstimateStatus" AS ENUM (
  'DRAFT','SENT','APPROVED','REJECTED','SUPERSEDED','CANCELLED'
);

CREATE TYPE "PartsRequestStatus" AS ENUM (
  'NEW','SELECTING','SELECTED','WAITING_APPROVAL','APPROVED','ORDER_REQUIRED','ORDERED',
  'PARTIALLY_RECEIVED','RECEIVED','INSTALLED','RETURNED','CANCELLED'
);

CREATE TABLE "WorkOrderEstimate" (
  "id" TEXT NOT NULL,
  "workOrderId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" "WorkOrderEstimateStatus" NOT NULL DEFAULT 'DRAFT',
  "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
  "lineFingerprint" VARCHAR(64) NOT NULL,
  "lineSnapshot" JSONB NOT NULL,
  "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "laborTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "partsTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "externalTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "consumablesTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "otherTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "sentAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "approvedByName" VARCHAR(160),
  "approvalSource" VARCHAR(40),
  "approvalNote" TEXT,
  "supersededAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkOrderEstimate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartsRequest" (
  "id" TEXT NOT NULL,
  "workOrderId" TEXT NOT NULL,
  "estimateId" TEXT NOT NULL,
  "status" "PartsRequestStatus" NOT NULL DEFAULT 'NEW',
  "paymentRequired" BOOLEAN NOT NULL DEFAULT false,
  "paymentConfirmedAt" TIMESTAMP(3),
  "selectedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "orderedAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3),
  "installedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartsRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartsRequestItem" (
  "id" TEXT NOT NULL,
  "partsRequestId" TEXT NOT NULL,
  "workOrderLineId" VARCHAR(64) NOT NULL,
  "description" TEXT NOT NULL,
  "article" VARCHAR(120),
  "brand" VARCHAR(120),
  "quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
  "receivedQuantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
  "installedQuantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
  "purchasePrice" DECIMAL(14,2),
  "sellPrice" DECIMAL(14,2),
  "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
  "requiredForRepair" BOOLEAN NOT NULL DEFAULT true,
  "sourcingMode" VARCHAR(32),
  "supplierId" VARCHAR(64),
  "supplierQuoteId" VARCHAR(64),
  "supplierOrderId" VARCHAR(64),
  "externalProductId" VARCHAR(160),
  "etaAt" TIMESTAMP(3),
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartsRequestItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PartsRequestItem_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "PartsRequestItem_received_nonnegative" CHECK ("receivedQuantity" >= 0),
  CONSTRAINT "PartsRequestItem_installed_nonnegative" CHECK ("installedQuantity" >= 0),
  CONSTRAINT "PartsRequestItem_received_lte_quantity" CHECK ("receivedQuantity" <= "quantity"),
  CONSTRAINT "PartsRequestItem_installed_lte_received" CHECK ("installedQuantity" <= "receivedQuantity")
);

CREATE UNIQUE INDEX "WorkOrderEstimate_workOrderId_revision_key"
  ON "WorkOrderEstimate"("workOrderId","revision");
CREATE INDEX "WorkOrderEstimate_workOrderId_status_revision_idx"
  ON "WorkOrderEstimate"("workOrderId","status","revision");
CREATE INDEX "WorkOrderEstimate_lineFingerprint_idx"
  ON "WorkOrderEstimate"("lineFingerprint");
CREATE INDEX "WorkOrderEstimate_status_updatedAt_idx"
  ON "WorkOrderEstimate"("status","updatedAt");

CREATE UNIQUE INDEX "PartsRequest_estimateId_key" ON "PartsRequest"("estimateId");
CREATE INDEX "PartsRequest_workOrderId_status_updatedAt_idx"
  ON "PartsRequest"("workOrderId","status","updatedAt");

CREATE UNIQUE INDEX "PartsRequestItem_partsRequestId_workOrderLineId_key"
  ON "PartsRequestItem"("partsRequestId","workOrderLineId");
CREATE INDEX "PartsRequestItem_partsRequestId_requiredForRepair_idx"
  ON "PartsRequestItem"("partsRequestId","requiredForRepair");
CREATE INDEX "PartsRequestItem_supplierId_idx" ON "PartsRequestItem"("supplierId");
CREATE INDEX "PartsRequestItem_supplierQuoteId_idx" ON "PartsRequestItem"("supplierQuoteId");
CREATE INDEX "PartsRequestItem_supplierOrderId_idx" ON "PartsRequestItem"("supplierOrderId");
CREATE INDEX "PartsRequestItem_article_idx" ON "PartsRequestItem"("article");

ALTER TABLE "WorkOrderEstimate"
  ADD CONSTRAINT "WorkOrderEstimate_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PartsRequest"
  ADD CONSTRAINT "PartsRequest_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PartsRequest"
  ADD CONSTRAINT "PartsRequest_estimateId_fkey"
  FOREIGN KEY ("estimateId") REFERENCES "WorkOrderEstimate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PartsRequestItem"
  ADD CONSTRAINT "PartsRequestItem_partsRequestId_fkey"
  FOREIGN KEY ("partsRequestId") REFERENCES "PartsRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
