-- Financial Core v3: canonical WorkOrder line items.
-- Additive migration. Existing WorkOrders are not backfilled and no financial facts are posted.

CREATE TYPE "WorkOrderLineType" AS ENUM ('LABOR','PART','EXTERNAL','CONSUMABLE','OTHER');
CREATE TYPE "WorkOrderLineStatus" AS ENUM ('DRAFT','APPROVED','IN_PROGRESS','COMPLETED','CANCELLED');

CREATE TABLE "WorkOrderLine" (
  "id" TEXT NOT NULL,
  "workOrderId" TEXT NOT NULL,
  "type" "WorkOrderLineType" NOT NULL,
  "status" "WorkOrderLineStatus" NOT NULL DEFAULT 'DRAFT',
  "description" TEXT NOT NULL,
  "code" VARCHAR(120),
  "article" VARCHAR(120),
  "brand" VARCHAR(120),
  "unit" VARCHAR(32) NOT NULL DEFAULT 'шт',
  "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
  "plannedQuantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
  "plannedUnitPrice" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "plannedUnitCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "plannedDiscount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "actualQuantity" DECIMAL(12,3),
  "actualUnitPrice" DECIMAL(14,2),
  "actualUnitCost" DECIMAL(14,2),
  "actualDiscount" DECIMAL(14,2),
  "laborHours" DECIMAL(8,2),
  "mechanicId" TEXT,
  "supplierId" TEXT,
  "supplierQuoteId" TEXT,
  "supplierOrderId" TEXT,
  "catalogItemId" TEXT,
  "sourceEntity" VARCHAR(40),
  "sourceEntityId" VARCHAR(96),
  "sortOrder" INTEGER NOT NULL DEFAULT 100,
  "approvedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkOrderLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkOrderLine_planned_quantity_positive" CHECK ("plannedQuantity" > 0),
  CONSTRAINT "WorkOrderLine_planned_amounts_nonnegative" CHECK (
    "plannedUnitPrice" >= 0 AND "plannedUnitCost" >= 0 AND "plannedDiscount" >= 0
  ),
  CONSTRAINT "WorkOrderLine_planned_discount_lte_revenue" CHECK (
    "plannedDiscount" <= "plannedQuantity" * "plannedUnitPrice"
  ),
  CONSTRAINT "WorkOrderLine_actual_quantity_positive" CHECK (
    "actualQuantity" IS NULL OR "actualQuantity" > 0
  ),
  CONSTRAINT "WorkOrderLine_actual_amounts_nonnegative" CHECK (
    ("actualUnitPrice" IS NULL OR "actualUnitPrice" >= 0) AND
    ("actualUnitCost" IS NULL OR "actualUnitCost" >= 0) AND
    ("actualDiscount" IS NULL OR "actualDiscount" >= 0)
  ),
  CONSTRAINT "WorkOrderLine_actual_discount_lte_revenue" CHECK (
    "actualDiscount" IS NULL OR
    "actualDiscount" <= COALESCE("actualQuantity", "plannedQuantity") * COALESCE("actualUnitPrice", "plannedUnitPrice")
  )
);

CREATE INDEX "WorkOrderLine_workOrderId_status_sortOrder_idx"
  ON "WorkOrderLine"("workOrderId","status","sortOrder");
CREATE INDEX "WorkOrderLine_workOrderId_type_idx"
  ON "WorkOrderLine"("workOrderId","type");
CREATE INDEX "WorkOrderLine_supplierId_idx" ON "WorkOrderLine"("supplierId");
CREATE INDEX "WorkOrderLine_supplierQuoteId_idx" ON "WorkOrderLine"("supplierQuoteId");
CREATE INDEX "WorkOrderLine_supplierOrderId_idx" ON "WorkOrderLine"("supplierOrderId");
CREATE INDEX "WorkOrderLine_mechanicId_idx" ON "WorkOrderLine"("mechanicId");
CREATE INDEX "WorkOrderLine_catalogItemId_idx" ON "WorkOrderLine"("catalogItemId");
CREATE INDEX "WorkOrderLine_sourceEntity_sourceEntityId_idx"
  ON "WorkOrderLine"("sourceEntity","sourceEntityId");

ALTER TABLE "WorkOrderLine"
  ADD CONSTRAINT "WorkOrderLine_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
