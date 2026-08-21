-- Production drift recovery.
-- The original supplier integration migration is recorded as applied, while the
-- corresponding enum types and tables are absent. Recreate them idempotently
-- without rewriting Prisma migration history.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SupplierCode') THEN
    CREATE TYPE "SupplierCode" AS ENUM ('BM_PARTS', 'UNIQUE_TRADE', 'AUTONOVA_D', 'OTHER');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SupplierConnectionStatus') THEN
    CREATE TYPE "SupplierConnectionStatus" AS ENUM ('NOT_CONFIGURED', 'CONFIGURED', 'CONNECTED', 'ERROR', 'DISABLED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SupplierOrderStatus') THEN
    CREATE TYPE "SupplierOrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CONFIRMED', 'PARTIAL', 'FULFILLED', 'CANCELLED', 'ERROR');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "Supplier" (
  "id" TEXT NOT NULL,
  "code" "SupplierCode" NOT NULL,
  "name" TEXT NOT NULL,
  "websiteUrl" TEXT,
  "apiBaseUrl" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "defaultMarkupPercent" DECIMAL(5,2) NOT NULL DEFAULT 23.00,
  "defaultCurrency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SupplierCredential" (
  "id" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "authType" VARCHAR(40) NOT NULL,
  "loginHint" VARCHAR(160),
  "externalClientId" VARCHAR(120),
  "secretRef" JSONB,
  "status" "SupplierConnectionStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
  "lastCheckedAt" TIMESTAMP(3),
  "lastLatencyMs" INTEGER,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplierCredential_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SupplierProductQuote" (
  "id" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "query" VARCHAR(160),
  "externalProductId" VARCHAR(160),
  "article" VARCHAR(120) NOT NULL,
  "brand" VARCHAR(120),
  "name" TEXT,
  "purchasePrice" DECIMAL(14,2),
  "currency" VARCHAR(3),
  "multiplicity" DECIMAL(10,2),
  "available" BOOLEAN NOT NULL DEFAULT false,
  "stock" JSONB,
  "delivery" JSONB,
  "raw" JSONB,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "SupplierProductQuote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SupplierOrder" (
  "id" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "workOrderId" TEXT,
  "externalOrderId" VARCHAR(160),
  "status" "SupplierOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "totalPurchase" DECIMAL(14,2),
  "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
  "items" JSONB NOT NULL,
  "requestPayload" JSONB,
  "responsePayload" JSONB,
  "submittedAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplierOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Supplier_code_key" ON "Supplier"("code");
CREATE INDEX IF NOT EXISTS "Supplier_isActive_priority_idx" ON "Supplier"("isActive", "priority");
CREATE UNIQUE INDEX IF NOT EXISTS "SupplierCredential_supplierId_key" ON "SupplierCredential"("supplierId");
CREATE INDEX IF NOT EXISTS "SupplierCredential_status_idx" ON "SupplierCredential"("status");
CREATE INDEX IF NOT EXISTS "SupplierProductQuote_supplierId_article_idx" ON "SupplierProductQuote"("supplierId", "article");
CREATE INDEX IF NOT EXISTS "SupplierProductQuote_brand_article_idx" ON "SupplierProductQuote"("brand", "article");
CREATE INDEX IF NOT EXISTS "SupplierProductQuote_fetchedAt_idx" ON "SupplierProductQuote"("fetchedAt");
CREATE INDEX IF NOT EXISTS "SupplierProductQuote_expiresAt_idx" ON "SupplierProductQuote"("expiresAt");
CREATE INDEX IF NOT EXISTS "SupplierOrder_supplierId_status_createdAt_idx" ON "SupplierOrder"("supplierId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "SupplierOrder_workOrderId_idx" ON "SupplierOrder"("workOrderId");
CREATE INDEX IF NOT EXISTS "SupplierOrder_externalOrderId_idx" ON "SupplierOrder"("externalOrderId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupplierCredential_supplierId_fkey') THEN
    ALTER TABLE "SupplierCredential"
      ADD CONSTRAINT "SupplierCredential_supplierId_fkey"
      FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupplierProductQuote_supplierId_fkey') THEN
    ALTER TABLE "SupplierProductQuote"
      ADD CONSTRAINT "SupplierProductQuote_supplierId_fkey"
      FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupplierOrder_supplierId_fkey') THEN
    ALTER TABLE "SupplierOrder"
      ADD CONSTRAINT "SupplierOrder_supplierId_fkey"
      FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
