CREATE TYPE "InventoryLedgerDirection" AS ENUM ('IN', 'OUT');
CREATE TYPE "InventoryLedgerReason" AS ENUM ('RECEIPT', 'ISSUE', 'RETURN', 'ADJUSTMENT', 'TRANSFER', 'RESERVATION_CONSUME');
CREATE TYPE "InventoryReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED', 'CANCELLED');

CREATE TABLE "InventoryBalance" (
  "id" TEXT NOT NULL,
  "warehouseKey" VARCHAR(64) NOT NULL DEFAULT 'MAIN',
  "serviceLocationId" VARCHAR(64),
  "stockKey" VARCHAR(180) NOT NULL,
  "productId" VARCHAR(64),
  "article" VARCHAR(120),
  "brand" VARCHAR(120),
  "description" VARCHAR(320),
  "unit" VARCHAR(32) NOT NULL DEFAULT 'шт',
  "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
  "onHand" DECIMAL(16,3) NOT NULL DEFAULT 0,
  "reserved" DECIMAL(16,3) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryBalance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryBalance_warehouseKey_stockKey_key" ON "InventoryBalance"("warehouseKey", "stockKey");
CREATE INDEX "InventoryBalance_serviceLocationId_updatedAt_idx" ON "InventoryBalance"("serviceLocationId", "updatedAt");
CREATE INDEX "InventoryBalance_productId_warehouseKey_idx" ON "InventoryBalance"("productId", "warehouseKey");
CREATE INDEX "InventoryBalance_article_brand_idx" ON "InventoryBalance"("article", "brand");
CREATE INDEX "InventoryBalance_onHand_reserved_idx" ON "InventoryBalance"("onHand", "reserved");

CREATE TABLE "InventoryLedgerEntry" (
  "id" TEXT NOT NULL,
  "warehouseKey" VARCHAR(64) NOT NULL DEFAULT 'MAIN',
  "serviceLocationId" VARCHAR(64),
  "stockKey" VARCHAR(180) NOT NULL,
  "productId" VARCHAR(64),
  "article" VARCHAR(120),
  "brand" VARCHAR(120),
  "description" VARCHAR(320),
  "unit" VARCHAR(32) NOT NULL DEFAULT 'шт',
  "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
  "direction" "InventoryLedgerDirection" NOT NULL,
  "reason" "InventoryLedgerReason" NOT NULL,
  "quantity" DECIMAL(16,3) NOT NULL,
  "unitCost" DECIMAL(16,4),
  "balanceAfter" DECIMAL(16,3) NOT NULL,
  "referenceType" VARCHAR(48),
  "referenceId" VARCHAR(96),
  "workOrderId" VARCHAR(64),
  "workOrderLineId" VARCHAR(64),
  "supplierOrderId" VARCHAR(64),
  "supplierId" VARCHAR(64),
  "reasonNote" TEXT,
  "actorUserId" VARCHAR(64),
  "actorName" VARCHAR(160),
  "idempotencyKey" VARCHAR(160),
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  CONSTRAINT "InventoryLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryLedgerEntry_idempotencyKey_key" ON "InventoryLedgerEntry"("idempotencyKey");
CREATE INDEX "InventoryLedgerEntry_warehouseKey_stockKey_occurredAt_idx" ON "InventoryLedgerEntry"("warehouseKey", "stockKey", "occurredAt");
CREATE INDEX "InventoryLedgerEntry_serviceLocationId_occurredAt_idx" ON "InventoryLedgerEntry"("serviceLocationId", "occurredAt");
CREATE INDEX "InventoryLedgerEntry_workOrderId_occurredAt_idx" ON "InventoryLedgerEntry"("workOrderId", "occurredAt");
CREATE INDEX "InventoryLedgerEntry_workOrderLineId_occurredAt_idx" ON "InventoryLedgerEntry"("workOrderLineId", "occurredAt");
CREATE INDEX "InventoryLedgerEntry_supplierOrderId_occurredAt_idx" ON "InventoryLedgerEntry"("supplierOrderId", "occurredAt");
CREATE INDEX "InventoryLedgerEntry_direction_reason_occurredAt_idx" ON "InventoryLedgerEntry"("direction", "reason", "occurredAt");

CREATE TABLE "InventoryReservation" (
  "id" TEXT NOT NULL,
  "warehouseKey" VARCHAR(64) NOT NULL DEFAULT 'MAIN',
  "serviceLocationId" VARCHAR(64),
  "stockKey" VARCHAR(180) NOT NULL,
  "productId" VARCHAR(64),
  "article" VARCHAR(120),
  "brand" VARCHAR(120),
  "workOrderId" VARCHAR(64),
  "workOrderLineId" VARCHAR(64),
  "quantity" DECIMAL(16,3) NOT NULL,
  "status" "InventoryReservationStatus" NOT NULL DEFAULT 'ACTIVE',
  "sourceType" VARCHAR(40) NOT NULL,
  "sourceId" VARCHAR(96) NOT NULL,
  "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "actorUserId" VARCHAR(64),
  "actorName" VARCHAR(160),
  "idempotencyKey" VARCHAR(160),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB,
  CONSTRAINT "InventoryReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryReservation_idempotencyKey_key" ON "InventoryReservation"("idempotencyKey");
CREATE INDEX "InventoryReservation_warehouseKey_stockKey_status_idx" ON "InventoryReservation"("warehouseKey", "stockKey", "status");
CREATE INDEX "InventoryReservation_serviceLocationId_status_idx" ON "InventoryReservation"("serviceLocationId", "status");
CREATE INDEX "InventoryReservation_workOrderId_status_idx" ON "InventoryReservation"("workOrderId", "status");
CREATE INDEX "InventoryReservation_workOrderLineId_status_idx" ON "InventoryReservation"("workOrderLineId", "status");
CREATE INDEX "InventoryReservation_status_updatedAt_idx" ON "InventoryReservation"("status", "updatedAt");
