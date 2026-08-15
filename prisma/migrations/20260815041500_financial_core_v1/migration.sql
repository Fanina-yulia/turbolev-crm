-- Financial Core v1
-- Management accounting foundation: P&L accrual events, AR/AP obligations and actual cash movements.

CREATE TYPE "FinancialPnlSection" AS ENUM ('REVENUE','COGS','OPEX','OTHER_INCOME','OTHER_EXPENSE','TAX');
CREATE TYPE "FinancialEventStatus" AS ENUM ('DRAFT','POSTED','REVERSED');
CREATE TYPE "FinancialObligationDirection" AS ENUM ('RECEIVABLE','PAYABLE');
CREATE TYPE "FinancialObligationStatus" AS ENUM ('OPEN','PARTIALLY_PAID','PAID','OVERDUE','CANCELLED');
CREATE TYPE "MoneyAccountType" AS ENUM ('CASH','BANK','CARD','ACQUIRING','OTHER');
CREATE TYPE "CashTransactionKind" AS ENUM ('INFLOW','OUTFLOW','TRANSFER');
CREATE TYPE "CashTransactionStatus" AS ENUM ('DRAFT','POSTED','REVERSED');
CREATE TYPE "CashFlowSection" AS ENUM ('OPERATING','INVESTING','FINANCING','INTERNAL_TRANSFER');
CREATE TYPE "FinanceSnapshotKind" AS ENUM ('PLANNED','ACTUAL');

CREATE TABLE "MoneyAccount" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "MoneyAccountType" NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
  "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "openingBalanceAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locationId" VARCHAR(64),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 100,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MoneyAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinancialCategory" (
  "id" TEXT NOT NULL,
  "code" VARCHAR(80) NOT NULL,
  "name" TEXT NOT NULL,
  "pnlSection" "FinancialPnlSection",
  "cashFlowSection" "CashFlowSection",
  "parentId" TEXT,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 100,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinancialCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CostCenter" (
  "id" TEXT NOT NULL,
  "code" VARCHAR(80) NOT NULL,
  "name" TEXT NOT NULL,
  "locationId" VARCHAR(64),
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 100,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CostCenter_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinancialEvent" (
  "id" TEXT NOT NULL,
  "status" "FinancialEventStatus" NOT NULL DEFAULT 'DRAFT',
  "pnlSection" "FinancialPnlSection" NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
  "recognizedAt" TIMESTAMP(3) NOT NULL,
  "categoryId" TEXT,
  "costCenterId" TEXT,
  "workOrderId" VARCHAR(64),
  "clientId" VARCHAR(64),
  "vehicleId" VARCHAR(64),
  "supplierId" VARCHAR(64),
  "employeeId" VARCHAR(64),
  "locationId" VARCHAR(64),
  "sourceEntity" VARCHAR(40),
  "sourceEntityId" VARCHAR(96),
  "description" TEXT,
  "metadata" JSONB,
  "reversalOfId" TEXT,
  "createdById" VARCHAR(64),
  "postedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinancialEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinancialEvent_amount_nonnegative" CHECK ("amount" >= 0)
);

CREATE TABLE "FinancialObligation" (
  "id" TEXT NOT NULL,
  "direction" "FinancialObligationDirection" NOT NULL,
  "status" "FinancialObligationStatus" NOT NULL DEFAULT 'OPEN',
  "amount" DECIMAL(14,2) NOT NULL,
  "settledAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueAt" TIMESTAMP(3),
  "settledAt" TIMESTAMP(3),
  "categoryId" TEXT,
  "costCenterId" TEXT,
  "sourceEventId" TEXT,
  "workOrderId" VARCHAR(64),
  "clientId" VARCHAR(64),
  "supplierId" VARCHAR(64),
  "locationId" VARCHAR(64),
  "counterpartyName" TEXT,
  "sourceEntity" VARCHAR(40),
  "sourceEntityId" VARCHAR(96),
  "description" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinancialObligation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinancialObligation_amount_nonnegative" CHECK ("amount" >= 0),
  CONSTRAINT "FinancialObligation_settled_nonnegative" CHECK ("settledAmount" >= 0),
  CONSTRAINT "FinancialObligation_settled_lte_amount" CHECK ("settledAmount" <= "amount")
);

CREATE TABLE "CashTransaction" (
  "id" TEXT NOT NULL,
  "kind" "CashTransactionKind" NOT NULL,
  "status" "CashTransactionStatus" NOT NULL DEFAULT 'DRAFT',
  "flowSection" "CashFlowSection" NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "fromAccountId" TEXT,
  "toAccountId" TEXT,
  "categoryId" TEXT,
  "costCenterId" TEXT,
  "obligationId" TEXT,
  "workOrderId" VARCHAR(64),
  "clientId" VARCHAR(64),
  "supplierId" VARCHAR(64),
  "locationId" VARCHAR(64),
  "sourceEntity" VARCHAR(40),
  "sourceEntityId" VARCHAR(96),
  "description" TEXT,
  "metadata" JSONB,
  "reversalOfId" TEXT,
  "createdById" VARCHAR(64),
  "postedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CashTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CashTransaction_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "CashTransaction_account_shape" CHECK (
    ("kind" = 'INFLOW' AND "fromAccountId" IS NULL AND "toAccountId" IS NOT NULL) OR
    ("kind" = 'OUTFLOW' AND "fromAccountId" IS NOT NULL AND "toAccountId" IS NULL) OR
    ("kind" = 'TRANSFER' AND "fromAccountId" IS NOT NULL AND "toAccountId" IS NOT NULL AND "fromAccountId" <> "toAccountId")
  ),
  CONSTRAINT "CashTransaction_transfer_section" CHECK (
    ("kind" = 'TRANSFER' AND "flowSection" = 'INTERNAL_TRANSFER') OR
    ("kind" <> 'TRANSFER' AND "flowSection" <> 'INTERNAL_TRANSFER')
  )
);

CREATE TABLE "WorkOrderFinanceSnapshot" (
  "id" TEXT NOT NULL,
  "workOrderId" VARCHAR(64) NOT NULL,
  "kind" "FinanceSnapshotKind" NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
  "laborRevenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "partsRevenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "externalRevenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "otherRevenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "refundAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "partsCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "laborCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "externalCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "consumablesCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "otherDirectCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "grossRevenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "directCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "grossProfit" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "grossMarginPercent" DECIMAL(7,2),
  "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkOrderFinanceSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FinancialCategory_code_key" ON "FinancialCategory"("code");
CREATE INDEX "FinancialCategory_pnlSection_isActive_idx" ON "FinancialCategory"("pnlSection","isActive");
CREATE INDEX "FinancialCategory_cashFlowSection_isActive_idx" ON "FinancialCategory"("cashFlowSection","isActive");
CREATE INDEX "FinancialCategory_parentId_sortOrder_idx" ON "FinancialCategory"("parentId","sortOrder");

CREATE UNIQUE INDEX "CostCenter_code_key" ON "CostCenter"("code");
CREATE INDEX "CostCenter_locationId_idx" ON "CostCenter"("locationId");
CREATE INDEX "CostCenter_isActive_sortOrder_idx" ON "CostCenter"("isActive","sortOrder");

CREATE INDEX "MoneyAccount_isActive_sortOrder_idx" ON "MoneyAccount"("isActive","sortOrder");
CREATE INDEX "MoneyAccount_locationId_idx" ON "MoneyAccount"("locationId");
CREATE INDEX "MoneyAccount_currency_idx" ON "MoneyAccount"("currency");

CREATE UNIQUE INDEX "FinancialEvent_reversalOfId_key" ON "FinancialEvent"("reversalOfId");
CREATE INDEX "FinancialEvent_status_recognizedAt_idx" ON "FinancialEvent"("status","recognizedAt");
CREATE INDEX "FinancialEvent_pnlSection_recognizedAt_idx" ON "FinancialEvent"("pnlSection","recognizedAt");
CREATE INDEX "FinancialEvent_categoryId_recognizedAt_idx" ON "FinancialEvent"("categoryId","recognizedAt");
CREATE INDEX "FinancialEvent_costCenterId_recognizedAt_idx" ON "FinancialEvent"("costCenterId","recognizedAt");
CREATE INDEX "FinancialEvent_workOrderId_idx" ON "FinancialEvent"("workOrderId");
CREATE INDEX "FinancialEvent_clientId_idx" ON "FinancialEvent"("clientId");
CREATE INDEX "FinancialEvent_vehicleId_idx" ON "FinancialEvent"("vehicleId");
CREATE INDEX "FinancialEvent_supplierId_idx" ON "FinancialEvent"("supplierId");
CREATE INDEX "FinancialEvent_locationId_idx" ON "FinancialEvent"("locationId");
CREATE INDEX "FinancialEvent_sourceEntity_sourceEntityId_idx" ON "FinancialEvent"("sourceEntity","sourceEntityId");

CREATE INDEX "FinancialObligation_direction_status_dueAt_idx" ON "FinancialObligation"("direction","status","dueAt");
CREATE INDEX "FinancialObligation_categoryId_idx" ON "FinancialObligation"("categoryId");
CREATE INDEX "FinancialObligation_costCenterId_idx" ON "FinancialObligation"("costCenterId");
CREATE INDEX "FinancialObligation_sourceEventId_idx" ON "FinancialObligation"("sourceEventId");
CREATE INDEX "FinancialObligation_workOrderId_idx" ON "FinancialObligation"("workOrderId");
CREATE INDEX "FinancialObligation_clientId_idx" ON "FinancialObligation"("clientId");
CREATE INDEX "FinancialObligation_supplierId_idx" ON "FinancialObligation"("supplierId");
CREATE INDEX "FinancialObligation_locationId_idx" ON "FinancialObligation"("locationId");
CREATE INDEX "FinancialObligation_sourceEntity_sourceEntityId_idx" ON "FinancialObligation"("sourceEntity","sourceEntityId");

CREATE UNIQUE INDEX "CashTransaction_reversalOfId_key" ON "CashTransaction"("reversalOfId");
CREATE INDEX "CashTransaction_status_occurredAt_idx" ON "CashTransaction"("status","occurredAt");
CREATE INDEX "CashTransaction_kind_occurredAt_idx" ON "CashTransaction"("kind","occurredAt");
CREATE INDEX "CashTransaction_flowSection_occurredAt_idx" ON "CashTransaction"("flowSection","occurredAt");
CREATE INDEX "CashTransaction_fromAccountId_occurredAt_idx" ON "CashTransaction"("fromAccountId","occurredAt");
CREATE INDEX "CashTransaction_toAccountId_occurredAt_idx" ON "CashTransaction"("toAccountId","occurredAt");
CREATE INDEX "CashTransaction_categoryId_idx" ON "CashTransaction"("categoryId");
CREATE INDEX "CashTransaction_costCenterId_idx" ON "CashTransaction"("costCenterId");
CREATE INDEX "CashTransaction_obligationId_idx" ON "CashTransaction"("obligationId");
CREATE INDEX "CashTransaction_workOrderId_idx" ON "CashTransaction"("workOrderId");
CREATE INDEX "CashTransaction_clientId_idx" ON "CashTransaction"("clientId");
CREATE INDEX "CashTransaction_supplierId_idx" ON "CashTransaction"("supplierId");
CREATE INDEX "CashTransaction_locationId_idx" ON "CashTransaction"("locationId");
CREATE INDEX "CashTransaction_sourceEntity_sourceEntityId_idx" ON "CashTransaction"("sourceEntity","sourceEntityId");

CREATE UNIQUE INDEX "WorkOrderFinanceSnapshot_workOrderId_kind_key" ON "WorkOrderFinanceSnapshot"("workOrderId","kind");
CREATE INDEX "WorkOrderFinanceSnapshot_kind_calculatedAt_idx" ON "WorkOrderFinanceSnapshot"("kind","calculatedAt");
CREATE INDEX "WorkOrderFinanceSnapshot_workOrderId_idx" ON "WorkOrderFinanceSnapshot"("workOrderId");

ALTER TABLE "FinancialCategory" ADD CONSTRAINT "FinancialCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "FinancialCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinancialEvent" ADD CONSTRAINT "FinancialEvent_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinancialCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinancialEvent" ADD CONSTRAINT "FinancialEvent_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinancialEvent" ADD CONSTRAINT "FinancialEvent_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "FinancialEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinancialObligation" ADD CONSTRAINT "FinancialObligation_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinancialCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinancialObligation" ADD CONSTRAINT "FinancialObligation_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinancialObligation" ADD CONSTRAINT "FinancialObligation_sourceEventId_fkey" FOREIGN KEY ("sourceEventId") REFERENCES "FinancialEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_fromAccountId_fkey" FOREIGN KEY ("fromAccountId") REFERENCES "MoneyAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "MoneyAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinancialCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "FinancialObligation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "CashTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- System categories. These are management-accounting dictionaries, not financial facts.
INSERT INTO "FinancialCategory" ("id","code","name","pnlSection","cashFlowSection","isSystem","sortOrder","updatedAt") VALUES
('fcat_rev_labor','REV_LABOR','Роботи','REVENUE','OPERATING',true,10,CURRENT_TIMESTAMP),
('fcat_rev_parts','REV_PARTS','Продаж запчастин','REVENUE','OPERATING',true,20,CURRENT_TIMESTAMP),
('fcat_rev_diagnostics','REV_DIAGNOSTICS','Діагностика','REVENUE','OPERATING',true,30,CURRENT_TIMESTAMP),
('fcat_rev_external','REV_EXTERNAL','Сторонні роботи — продаж','REVENUE','OPERATING',true,40,CURRENT_TIMESTAMP),
('fcat_rev_other','REV_OTHER','Інші операційні доходи','REVENUE','OPERATING',true,50,CURRENT_TIMESTAMP),
('fcat_cogs_parts','COGS_PARTS','Собівартість запчастин','COGS','OPERATING',true,110,CURRENT_TIMESTAMP),
('fcat_cogs_labor','COGS_LABOR','Пряма оплата праці механіків','COGS','OPERATING',true,120,CURRENT_TIMESTAMP),
('fcat_cogs_external','COGS_EXTERNAL','Сторонні роботи — собівартість','COGS','OPERATING',true,130,CURRENT_TIMESTAMP),
('fcat_cogs_consumables','COGS_CONSUMABLES','Витратні матеріали','COGS','OPERATING',true,140,CURRENT_TIMESTAMP),
('fcat_opex_admin_payroll','OPEX_ADMIN_PAYROLL','Зарплата адміністрації','OPEX','OPERATING',true,210,CURRENT_TIMESTAMP),
('fcat_opex_marketing','OPEX_MARKETING','Маркетинг і реклама','OPEX','OPERATING',true,220,CURRENT_TIMESTAMP),
('fcat_opex_rent','OPEX_RENT','Оренда','OPEX','OPERATING',true,230,CURRENT_TIMESTAMP),
('fcat_opex_utilities','OPEX_UTILITIES','Комунальні послуги','OPEX','OPERATING',true,240,CURRENT_TIMESTAMP),
('fcat_opex_it','OPEX_IT','IT, CRM та підписки','OPEX','OPERATING',true,250,CURRENT_TIMESTAMP),
('fcat_opex_bank','OPEX_BANK','Банківські комісії та еквайринг','OPEX','OPERATING',true,260,CURRENT_TIMESTAMP),
('fcat_opex_transport','OPEX_TRANSPORT','Транспорт і доставка','OPEX','OPERATING',true,270,CURRENT_TIMESTAMP),
('fcat_opex_household','OPEX_HOUSEHOLD','Господарські витрати','OPEX','OPERATING',true,280,CURRENT_TIMESTAMP),
('fcat_other_income','OTHER_INCOME','Інші доходи','OTHER_INCOME','OPERATING',true,310,CURRENT_TIMESTAMP),
('fcat_other_expense','OTHER_EXPENSE','Інші витрати','OTHER_EXPENSE','OPERATING',true,320,CURRENT_TIMESTAMP),
('fcat_tax','TAX','Податки','TAX','OPERATING',true,330,CURRENT_TIMESTAMP),
('fcat_capex_equipment','CAPEX_EQUIPMENT','Обладнання та інвестиції','INVESTING'::"CashFlowSection"::text::"CashFlowSection",NULL,true,410,CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Correct CAPEX row because it intentionally has no P&L section.
UPDATE "FinancialCategory"
SET "pnlSection" = NULL, "cashFlowSection" = 'INVESTING'
WHERE "code" = 'CAPEX_EQUIPMENT';

INSERT INTO "FinancialCategory" ("id","code","name","pnlSection","cashFlowSection","isSystem","sortOrder","updatedAt") VALUES
('fcat_fin_loan_in','FIN_LOAN_IN','Отримання позики',NULL,'FINANCING',true,420,CURRENT_TIMESTAMP),
('fcat_fin_loan_out','FIN_LOAN_OUT','Повернення позики',NULL,'FINANCING',true,430,CURRENT_TIMESTAMP),
('fcat_owner_contribution','OWNER_CONTRIBUTION','Внесок власника',NULL,'FINANCING',true,440,CURRENT_TIMESTAMP),
('fcat_owner_withdrawal','OWNER_WITHDRAWAL','Виплата власнику',NULL,'FINANCING',true,450,CURRENT_TIMESTAMP),
('fcat_internal_transfer','INTERNAL_TRANSFER','Внутрішній переказ',NULL,'INTERNAL_TRANSFER',true,460,CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "CostCenter" ("id","code","name","locationId","isSystem","sortOrder","updatedAt")
VALUES ('cc_glevakha','STO_GLEVAKHA','СТО Глеваха','loc_glevakha',true,10,CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
