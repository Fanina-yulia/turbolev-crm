CREATE TYPE "FinancialSettlementType" AS ENUM ('PAYMENT', 'REFUND', 'ADVANCE_RECEIPT', 'ADVANCE_APPLY', 'ADVANCE_REFUND', 'SUPPLIER_PAYMENT');
CREATE TYPE "FinancialSettlementStatus" AS ENUM ('POSTED', 'REVERSED');

CREATE TABLE "FinancialSettlement" (
  "id" TEXT NOT NULL,
  "type" "FinancialSettlementType" NOT NULL,
  "status" "FinancialSettlementStatus" NOT NULL DEFAULT 'POSTED',
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "moneyAccountId" VARCHAR(96),
  "clientId" VARCHAR(64),
  "supplierId" VARCHAR(64),
  "workOrderId" VARCHAR(64),
  "locationId" VARCHAR(64),
  "counterpartyName" VARCHAR(240),
  "cashTransactionId" VARCHAR(96),
  "advanceId" VARCHAR(96),
  "sourceEntity" VARCHAR(48) NOT NULL,
  "sourceEntityId" VARCHAR(128) NOT NULL,
  "reversalOfId" VARCHAR(96),
  "note" TEXT,
  "metadata" JSONB,
  "createdById" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinancialSettlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FinancialSettlement_cashTransactionId_key" ON "FinancialSettlement"("cashTransactionId");
CREATE UNIQUE INDEX "FinancialSettlement_reversalOfId_key" ON "FinancialSettlement"("reversalOfId");
CREATE UNIQUE INDEX "FinancialSettlement_sourceEntity_sourceEntityId_key" ON "FinancialSettlement"("sourceEntity", "sourceEntityId");
CREATE INDEX "FinancialSettlement_type_status_occurredAt_idx" ON "FinancialSettlement"("type", "status", "occurredAt");
CREATE INDEX "FinancialSettlement_locationId_occurredAt_idx" ON "FinancialSettlement"("locationId", "occurredAt");
CREATE INDEX "FinancialSettlement_clientId_occurredAt_idx" ON "FinancialSettlement"("clientId", "occurredAt");
CREATE INDEX "FinancialSettlement_supplierId_occurredAt_idx" ON "FinancialSettlement"("supplierId", "occurredAt");
CREATE INDEX "FinancialSettlement_workOrderId_occurredAt_idx" ON "FinancialSettlement"("workOrderId", "occurredAt");
CREATE INDEX "FinancialSettlement_advanceId_occurredAt_idx" ON "FinancialSettlement"("advanceId", "occurredAt");
CREATE INDEX "FinancialSettlement_cashTransactionId_idx" ON "FinancialSettlement"("cashTransactionId");
CREATE INDEX "FinancialSettlement_reversalOfId_idx" ON "FinancialSettlement"("reversalOfId");

CREATE TABLE "FinancialSettlementAllocation" (
  "id" TEXT NOT NULL,
  "settlementId" TEXT NOT NULL,
  "obligationId" VARCHAR(96) NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancialSettlementAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinancialSettlementAllocation_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "FinancialSettlement"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "FinancialSettlementAllocation_settlementId_obligationId_key" ON "FinancialSettlementAllocation"("settlementId", "obligationId");
CREATE INDEX "FinancialSettlementAllocation_obligationId_createdAt_idx" ON "FinancialSettlementAllocation"("obligationId", "createdAt");