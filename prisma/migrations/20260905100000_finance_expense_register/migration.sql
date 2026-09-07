-- Finance expense register v1.
-- Keeps the existing FinancialEvent/CashTransaction ledger as the source of truth.

CREATE TYPE "ExpenseDocumentStatus" AS ENUM ('DRAFT','PENDING_APPROVAL','APPROVED','POSTED','REJECTED','REVERSED');
CREATE TYPE "ExpensePaymentStatus" AS ENUM ('UNPAID','PARTIALLY_PAID','PAID','OVERDUE');

CREATE TABLE "ExpenseDocument" (
  "id" TEXT NOT NULL,
  "number" VARCHAR(32) NOT NULL,
  "status" "ExpenseDocumentStatus" NOT NULL DEFAULT 'DRAFT',
  "paymentStatus" "ExpensePaymentStatus" NOT NULL DEFAULT 'UNPAID',
  "amount" DECIMAL(14,2) NOT NULL,
  "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
  "expenseDate" TIMESTAMP(3) NOT NULL,
  "recognizedAt" TIMESTAMP(3) NOT NULL,
  "paymentDate" TIMESTAMP(3),
  "dueAt" TIMESTAMP(3),
  "categoryId" TEXT,
  "costCenterId" TEXT,
  "locationId" VARCHAR(64),
  "supplierId" VARCHAR(64),
  "counterpartyName" VARCHAR(240),
  "moneyAccountId" VARCHAR(64),
  "workOrderId" VARCHAR(64),
  "clientId" VARCHAR(64),
  "vehicleId" VARCHAR(64),
  "supplierOrderId" VARCHAR(64),
  "documentNumber" VARCHAR(120),
  "description" TEXT,
  "notes" TEXT,
  "createdById" VARCHAR(64),
  "approvedById" VARCHAR(64),
  "approvedAt" TIMESTAMP(3),
  "postedAt" TIMESTAMP(3),
  "reversedAt" TIMESTAMP(3),
  "reversalReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExpenseDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExpenseLine" (
  "id" TEXT NOT NULL,
  "expenseDocumentId" TEXT NOT NULL,
  "lineNumber" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "quantity" DECIMAL(14,4),
  "unit" VARCHAR(32),
  "unitPrice" DECIMAL(14,2),
  "categoryId" TEXT,
  "costCenterId" TEXT,
  "workOrderId" VARCHAR(64),
  "supplierId" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExpenseLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExpenseDocument_number_key" ON "ExpenseDocument"("number");
CREATE INDEX "ExpenseDocument_status_expenseDate_idx" ON "ExpenseDocument"("status","expenseDate");
CREATE INDEX "ExpenseDocument_paymentStatus_dueAt_idx" ON "ExpenseDocument"("paymentStatus","dueAt");
CREATE INDEX "ExpenseDocument_categoryId_expenseDate_idx" ON "ExpenseDocument"("categoryId","expenseDate");
CREATE INDEX "ExpenseDocument_locationId_expenseDate_idx" ON "ExpenseDocument"("locationId","expenseDate");
CREATE INDEX "ExpenseDocument_supplierId_expenseDate_idx" ON "ExpenseDocument"("supplierId","expenseDate");
CREATE INDEX "ExpenseDocument_moneyAccountId_idx" ON "ExpenseDocument"("moneyAccountId");
CREATE INDEX "ExpenseDocument_workOrderId_idx" ON "ExpenseDocument"("workOrderId");
CREATE INDEX "ExpenseDocument_supplierOrderId_idx" ON "ExpenseDocument"("supplierOrderId");

CREATE UNIQUE INDEX "ExpenseLine_expenseDocumentId_lineNumber_key" ON "ExpenseLine"("expenseDocumentId","lineNumber");
CREATE INDEX "ExpenseLine_categoryId_idx" ON "ExpenseLine"("categoryId");
CREATE INDEX "ExpenseLine_costCenterId_idx" ON "ExpenseLine"("costCenterId");
CREATE INDEX "ExpenseLine_workOrderId_idx" ON "ExpenseLine"("workOrderId");
CREATE INDEX "ExpenseLine_supplierId_idx" ON "ExpenseLine"("supplierId");

ALTER TABLE "ExpenseLine"
  ADD CONSTRAINT "ExpenseLine_expenseDocumentId_fkey"
  FOREIGN KEY ("expenseDocumentId") REFERENCES "ExpenseDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "FinancialCategory" ("id","code","name","pnlSection","cashFlowSection","isSystem","sortOrder","updatedAt") VALUES
  ('fcat_opex_fuel','OPEX_FUEL','Пальне','OPEX','OPERATING',true,285,CURRENT_TIMESTAMP),
  ('fcat_opex_communications','OPEX_COMMUNICATIONS','Зв’язок та інтернет','OPEX','OPERATING',true,286,CURRENT_TIMESTAMP),
  ('fcat_opex_repairs','OPEX_REPAIRS','Ремонт обладнання','OPEX','OPERATING',true,287,CURRENT_TIMESTAMP),
  ('fcat_opex_accounting','OPEX_ACCOUNTING','Бухгалтерські послуги','OPEX','OPERATING',true,288,CURRENT_TIMESTAMP),
  ('fcat_opex_insurance','OPEX_INSURANCE','Страхування','OPEX','OPERATING',true,289,CURRENT_TIMESTAMP),
  ('fcat_tax_payroll','TAX_PAYROLL','Податки із зарплати','TAX','OPERATING',true,335,CURRENT_TIMESTAMP),
  ('fcat_inventory_purchase','INVENTORY_PURCHASE','Закупівля на склад',NULL,'OPERATING',true,400,CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
