-- Role economics modes separate direct ROI from managed/support evaluation.
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RoleEconomicsMode') THEN
    CREATE TYPE "RoleEconomicsMode" AS ENUM ('DIRECT_ROI','MANAGED_VALUE','SUPPORT_CAPACITY','OWNER');
  END IF;
END
$migration$;

ALTER TYPE "EconomicsStatus" ADD VALUE IF NOT EXISTS 'EFFECTIVE';
ALTER TYPE "EconomicsStatus" ADD VALUE IF NOT EXISTS 'UNDERUTILIZED';
ALTER TYPE "EconomicsStatus" ADD VALUE IF NOT EXISTS 'NEEDS_ATTENTION';

ALTER TABLE "StaffRole"
  ADD COLUMN IF NOT EXISTS "economicsMode" "RoleEconomicsMode" NOT NULL DEFAULT 'SUPPORT_CAPACITY';

UPDATE "StaffRole" SET "economicsMode" = 'OWNER' WHERE "code" = 'OWNER';
UPDATE "StaffRole" SET "economicsMode" = 'MANAGED_VALUE' WHERE "code" IN ('EXECUTIVE_DIRECTOR','HEAD_OF_SALES','STATION_MANAGER');
UPDATE "StaffRole" SET "economicsMode" = 'DIRECT_ROI' WHERE "code" IN ('SALES','PARTS_SPECIALIST','MECHANIC');
UPDATE "StaffRole" SET "economicsMode" = 'SUPPORT_CAPACITY' WHERE "code" IN ('ACCOUNTANT','ADMINISTRATOR');

ALTER TABLE "EmployeeEconomicsSnapshot"
  ADD COLUMN IF NOT EXISTS "economicsMode" "RoleEconomicsMode" NOT NULL DEFAULT 'SUPPORT_CAPACITY';

CREATE TABLE IF NOT EXISTS "RoleDemandSnapshot" (
  "id" TEXT NOT NULL,
  "snapshotKey" VARCHAR(160) NOT NULL,
  "roleId" TEXT NOT NULL,
  "locationId" TEXT,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "metricCode" VARCHAR(96) NOT NULL,
  "demandValue" DECIMAL(18,4) NOT NULL,
  "unit" "KpiValueUnit" NOT NULL,
  "sourceType" VARCHAR(64) NOT NULL,
  "sourceId" VARCHAR(160),
  "dataCompletenessPct" DECIMAL(7,2),
  "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RoleDemandSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RoleDemandSnapshot_snapshotKey_key" ON "RoleDemandSnapshot"("snapshotKey");
CREATE INDEX IF NOT EXISTS "RoleDemandSnapshot_roleId_periodStart_periodEnd_metricCode_idx" ON "RoleDemandSnapshot"("roleId","periodStart","periodEnd","metricCode");
CREATE INDEX IF NOT EXISTS "RoleDemandSnapshot_locationId_periodStart_periodEnd_metricC_idx" ON "RoleDemandSnapshot"("locationId","periodStart","periodEnd","metricCode");

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RoleDemandSnapshot_roleId_fkey') THEN
    ALTER TABLE "RoleDemandSnapshot" ADD CONSTRAINT "RoleDemandSnapshot_roleId_fkey"
      FOREIGN KEY ("roleId") REFERENCES "StaffRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RoleDemandSnapshot_locationId_fkey') THEN
    ALTER TABLE "RoleDemandSnapshot" ADD CONSTRAINT "RoleDemandSnapshot_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "ServiceLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RoleDemandSnapshot_date_order_check') THEN
    ALTER TABLE "RoleDemandSnapshot" ADD CONSTRAINT "RoleDemandSnapshot_date_order_check"
      CHECK ("periodStart" <= "periodEnd");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RoleDemandSnapshot_demand_nonnegative_check') THEN
    ALTER TABLE "RoleDemandSnapshot" ADD CONSTRAINT "RoleDemandSnapshot_demand_nonnegative_check"
      CHECK ("demandValue" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RoleDemandSnapshot_completeness_range_check') THEN
    ALTER TABLE "RoleDemandSnapshot" ADD CONSTRAINT "RoleDemandSnapshot_completeness_range_check"
      CHECK ("dataCompletenessPct" IS NULL OR ("dataCompletenessPct" >= 0 AND "dataCompletenessPct" <= 100));
  END IF;
END
$migration$;
