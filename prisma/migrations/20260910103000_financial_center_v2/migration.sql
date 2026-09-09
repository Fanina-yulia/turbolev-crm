-- Financial Center V2 planning/control layer.
-- FinancialEvent / FinancialObligation / CashTransaction remain the factual ledger.
-- Create-only migration: no destructive production changes.

CREATE TABLE "FinancialBudget" (
  "id" TEXT NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "metric" VARCHAR(40) NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "categoryId" VARCHAR(80),
  "costCenterId" VARCHAR(80),
  "locationId" VARCHAR(64),
  "status" VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  "notes" TEXT,
  "createdById" VARCHAR(64),
  "approvedById" VARCHAR(64),
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinancialBudget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecurringFinancialRule" (
  "id" TEXT NOT NULL,
  "name" VARCHAR(180) NOT NULL,
  "direction" VARCHAR(16) NOT NULL DEFAULT 'OUTFLOW',
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
  "frequency" VARCHAR(24) NOT NULL DEFAULT 'MONTHLY',
  "intervalCount" INTEGER NOT NULL DEFAULT 1,
  "dayOfMonth" INTEGER,
  "dayOfWeek" INTEGER,
  "startAt" TIMESTAMP(3) NOT NULL,
  "endAt" TIMESTAMP(3),
  "nextOccurrenceAt" TIMESTAMP(3) NOT NULL,
  "categoryId" VARCHAR(80),
  "costCenterId" VARCHAR(80),
  "locationId" VARCHAR(64),
  "counterpartyName" VARCHAR(240),
  "moneyAccountId" VARCHAR(64),
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "autoPost" BOOLEAN NOT NULL DEFAULT false,
  "createdById" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecurringFinancialRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinancialForecastItem" (
  "id" TEXT NOT NULL,
  "direction" VARCHAR(16) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'PLANNED',
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
  "expectedAt" TIMESTAMP(3) NOT NULL,
  "probability" INTEGER NOT NULL DEFAULT 100,
  "categoryId" VARCHAR(80),
  "costCenterId" VARCHAR(80),
  "locationId" VARCHAR(64),
  "moneyAccountId" VARCHAR(64),
  "counterpartyName" VARCHAR(240),
  "sourceEntity" VARCHAR(40),
  "sourceEntityId" VARCHAR(96),
  "actualCashTransactionId" VARCHAR(96),
  "description" TEXT,
  "createdById" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinancialForecastItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinancialApprovalRule" (
  "id" TEXT NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "operationType" VARCHAR(32) NOT NULL DEFAULT 'EXPENSE',
  "minAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "maxAmount" DECIMAL(14,2),
  "locationId" VARCHAR(64),
  "requiredPermission" VARCHAR(96),
  "requiredRole" VARCHAR(96),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 100,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinancialApprovalRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinancialSettings" (
  "id" TEXT NOT NULL,
  "scopeKey" VARCHAR(80) NOT NULL,
  "locationId" VARCHAR(64),
  "defaultCurrency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
  "minimumCashReserve" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "fixedMonthlyCosts" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "targetGrossMarginPercent" DECIMAL(7,2) NOT NULL DEFAULT 40,
  "warningGrossMarginPercent" DECIMAL(7,2) NOT NULL DEFAULT 25,
  "forecastHorizonDays" INTEGER NOT NULL DEFAULT 90,
  "updatedById" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinancialSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExpenseAttachment" (
  "id" TEXT NOT NULL,
  "expenseDocumentId" VARCHAR(96) NOT NULL,
  "fileName" VARCHAR(240) NOT NULL,
  "mimeType" VARCHAR(120) NOT NULL,
  "url" TEXT NOT NULL,
  "sizeBytes" INTEGER,
  "uploadedById" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExpenseAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerAdvance" (
  "id" TEXT NOT NULL,
  "clientId" VARCHAR(64) NOT NULL,
  "workOrderId" VARCHAR(64),
  "amount" DECIMAL(14,2) NOT NULL,
  "appliedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "moneyAccountId" VARCHAR(64) NOT NULL,
  "locationId" VARCHAR(64),
  "cashTransactionId" VARCHAR(96) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'OPEN',
  "description" TEXT,
  "createdById" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerAdvance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FinancialSettings_scopeKey_key" ON "FinancialSettings"("scopeKey");
CREATE UNIQUE INDEX "CustomerAdvance_cashTransactionId_key" ON "CustomerAdvance"("cashTransactionId");

CREATE INDEX "FinancialBudget_periodStart_periodEnd_status_idx" ON "FinancialBudget"("periodStart", "periodEnd", "status");
CREATE INDEX "FinancialBudget_locationId_periodStart_periodEnd_idx" ON "FinancialBudget"("locationId", "periodStart", "periodEnd");
CREATE INDEX "FinancialBudget_categoryId_periodStart_periodEnd_idx" ON "FinancialBudget"("categoryId", "periodStart", "periodEnd");
CREATE INDEX "FinancialBudget_costCenterId_periodStart_periodEnd_idx" ON "FinancialBudget"("costCenterId", "periodStart", "periodEnd");
CREATE INDEX "FinancialBudget_metric_periodStart_periodEnd_idx" ON "FinancialBudget"("metric", "periodStart", "periodEnd");
CREATE INDEX "RecurringFinancialRule_isActive_nextOccurrenceAt_idx" ON "RecurringFinancialRule"("isActive", "nextOccurrenceAt");
CREATE INDEX "RecurringFinancialRule_locationId_isActive_idx" ON "RecurringFinancialRule"("locationId", "isActive");
CREATE INDEX "RecurringFinancialRule_categoryId_isActive_idx" ON "RecurringFinancialRule"("categoryId", "isActive");
CREATE INDEX "FinancialForecastItem_status_expectedAt_idx" ON "FinancialForecastItem"("status", "expectedAt");
CREATE INDEX "FinancialForecastItem_locationId_expectedAt_idx" ON "FinancialForecastItem"("locationId", "expectedAt");
CREATE INDEX "FinancialForecastItem_sourceEntity_sourceEntityId_idx" ON "FinancialForecastItem"("sourceEntity", "sourceEntityId");
CREATE INDEX "FinancialApprovalRule_operationType_isActive_sortOrder_idx" ON "FinancialApprovalRule"("operationType", "isActive", "sortOrder");
CREATE INDEX "FinancialApprovalRule_locationId_isActive_idx" ON "FinancialApprovalRule"("locationId", "isActive");
CREATE INDEX "FinancialSettings_locationId_idx" ON "FinancialSettings"("locationId");
CREATE INDEX "ExpenseAttachment_expenseDocumentId_createdAt_idx" ON "ExpenseAttachment"("expenseDocumentId", "createdAt");
CREATE INDEX "CustomerAdvance_clientId_status_idx" ON "CustomerAdvance"("clientId", "status");
CREATE INDEX "CustomerAdvance_workOrderId_idx" ON "CustomerAdvance"("workOrderId");
CREATE INDEX "CustomerAdvance_locationId_status_idx" ON "CustomerAdvance"("locationId", "status");

-- Safe default global settings. If it already exists (e.g. manual pre-seed), do nothing.
INSERT INTO "FinancialSettings" (
  "id", "scopeKey", "defaultCurrency", "minimumCashReserve", "fixedMonthlyCosts",
  "targetGrossMarginPercent", "warningGrossMarginPercent", "forecastHorizonDays", "updatedAt"
) VALUES (
  'financial_settings_global', 'GLOBAL', 'UAH', 0, 0, 40, 25, 90, CURRENT_TIMESTAMP
) ON CONFLICT ("scopeKey") DO NOTHING;