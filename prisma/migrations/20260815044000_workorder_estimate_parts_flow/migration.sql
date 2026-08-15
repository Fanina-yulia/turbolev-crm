-- CreateEnum
CREATE TYPE "WorkOrderEstimateStatus" AS ENUM ('DRAFT', 'SENT', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkOrderEstimateLineType" AS ENUM ('LABOR', 'PART', 'EXTERNAL', 'OTHER');

-- CreateEnum
CREATE TYPE "PartsRequestStatus" AS ENUM ('NEW', 'SELECTING', 'SELECTED', 'WAITING_APPROVAL', 'APPROVED', 'ORDER_REQUIRED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'INSTALLED', 'RETURNED', 'CANCELLED');

-- CreateTable
CREATE TABLE "WorkOrderEstimate" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" "WorkOrderEstimateStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "laborTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "partsTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "externalTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
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

-- CreateTable
CREATE TABLE "WorkOrderEstimateLine" (
    "id" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "type" "WorkOrderEstimateLineType" NOT NULL,
    "description" TEXT NOT NULL,
    "article" VARCHAR(120),
    "brand" VARCHAR(120),
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(14,2),
    "requiredForRepair" BOOLEAN NOT NULL DEFAULT true,
    "supplierQuoteId" VARCHAR(64),
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrderEstimateLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "PartsRequestItem" (
    "id" TEXT NOT NULL,
    "partsRequestId" TEXT NOT NULL,
    "estimateLineId" VARCHAR(64),
    "description" TEXT NOT NULL,
    "article" VARCHAR(120),
    "brand" VARCHAR(120),
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "receivedQuantity" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "installedQuantity" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "purchasePrice" DECIMAL(14,2),
    "sellPrice" DECIMAL(14,2),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
    "requiredForRepair" BOOLEAN NOT NULL DEFAULT true,
    "sourcingMode" VARCHAR(32),
    "supplierId" VARCHAR(64),
    "supplierOrderId" VARCHAR(64),
    "externalProductId" VARCHAR(160),
    "etaAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartsRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrderEstimate_workOrderId_revision_key" ON "WorkOrderEstimate"("workOrderId", "revision");
CREATE INDEX "WorkOrderEstimate_workOrderId_status_revision_idx" ON "WorkOrderEstimate"("workOrderId", "status", "revision");
CREATE INDEX "WorkOrderEstimate_status_updatedAt_idx" ON "WorkOrderEstimate"("status", "updatedAt");

CREATE INDEX "WorkOrderEstimateLine_estimateId_sortOrder_idx" ON "WorkOrderEstimateLine"("estimateId", "sortOrder");
CREATE INDEX "WorkOrderEstimateLine_type_article_idx" ON "WorkOrderEstimateLine"("type", "article");
CREATE INDEX "WorkOrderEstimateLine_supplierQuoteId_idx" ON "WorkOrderEstimateLine"("supplierQuoteId");

CREATE UNIQUE INDEX "PartsRequest_estimateId_key" ON "PartsRequest"("estimateId");
CREATE INDEX "PartsRequest_workOrderId_status_updatedAt_idx" ON "PartsRequest"("workOrderId", "status", "updatedAt");

CREATE UNIQUE INDEX "PartsRequestItem_partsRequestId_estimateLineId_key" ON "PartsRequestItem"("partsRequestId", "estimateLineId");
CREATE INDEX "PartsRequestItem_partsRequestId_requiredForRepair_idx" ON "PartsRequestItem"("partsRequestId", "requiredForRepair");
CREATE INDEX "PartsRequestItem_supplierId_idx" ON "PartsRequestItem"("supplierId");
CREATE INDEX "PartsRequestItem_supplierOrderId_idx" ON "PartsRequestItem"("supplierOrderId");
CREATE INDEX "PartsRequestItem_article_idx" ON "PartsRequestItem"("article");

-- AddForeignKey
ALTER TABLE "WorkOrderEstimate" ADD CONSTRAINT "WorkOrderEstimate_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkOrderEstimateLine" ADD CONSTRAINT "WorkOrderEstimateLine_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "WorkOrderEstimate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartsRequest" ADD CONSTRAINT "PartsRequest_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartsRequest" ADD CONSTRAINT "PartsRequest_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "WorkOrderEstimate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartsRequestItem" ADD CONSTRAINT "PartsRequestItem_partsRequestId_fkey" FOREIGN KEY ("partsRequestId") REFERENCES "PartsRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
