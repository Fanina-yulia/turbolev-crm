-- Financial Center V3: audited cash-day closing.
-- Create-only: factual CashTransaction ledger remains unchanged.

CREATE TABLE "FinancialCashClose" (
  "id" TEXT NOT NULL,
  "businessDate" DATE NOT NULL,
  "moneyAccountId" TEXT NOT NULL,
  "locationId" VARCHAR(64),
  "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
  "systemAmount" DECIMAL(14,2) NOT NULL,
  "countedAmount" DECIMAL(14,2) NOT NULL,
  "difference" DECIMAL(14,2) NOT NULL,
  "note" TEXT,
  "closedById" VARCHAR(64),
  "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancialCashClose_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FinancialCashClose_account_businessDate_key"
  ON "FinancialCashClose"("moneyAccountId","businessDate");

CREATE INDEX "FinancialCashClose_locationId_businessDate_idx"
  ON "FinancialCashClose"("locationId","businessDate");

CREATE INDEX "FinancialCashClose_businessDate_idx"
  ON "FinancialCashClose"("businessDate");

ALTER TABLE "FinancialCashClose"
  ADD CONSTRAINT "FinancialCashClose_moneyAccountId_fkey"
  FOREIGN KEY ("moneyAccountId") REFERENCES "MoneyAccount"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
