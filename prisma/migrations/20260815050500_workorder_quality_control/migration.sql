-- WorkOrder Full Cycle v4: auditable quality control attempts.
-- Additive and idempotent: production QC may already exist from a verified Neon migration.

DO $$
BEGIN
  CREATE TYPE "WorkOrderQualityStatus" AS ENUM (
    'PENDING','IN_PROGRESS','PASSED','FAILED','RECHECK','CANCELLED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "WorkOrderQualityControl" (
  "id" TEXT NOT NULL,
  "workOrderId" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL,
  "status" "WorkOrderQualityStatus" NOT NULL DEFAULT 'PENDING',
  "checklist" JSONB,
  "resultNote" TEXT,
  "performedByName" VARCHAR(160),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkOrderQualityControl_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WorkOrderQualityControl_workOrderId_attempt_key"
  ON "WorkOrderQualityControl"("workOrderId","attempt");
CREATE INDEX IF NOT EXISTS "WorkOrderQualityControl_workOrderId_status_attempt_idx"
  ON "WorkOrderQualityControl"("workOrderId","status","attempt");
CREATE INDEX IF NOT EXISTS "WorkOrderQualityControl_status_updatedAt_idx"
  ON "WorkOrderQualityControl"("status","updatedAt");

DO $$
BEGIN
  ALTER TABLE "WorkOrderQualityControl"
    ADD CONSTRAINT "WorkOrderQualityControl_workOrderId_fkey"
    FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
