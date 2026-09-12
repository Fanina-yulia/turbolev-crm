CREATE TYPE "OperationalBlockerStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'CANCELLED');
CREATE TYPE "OperationalBlockerPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "OperationalBlockerSourceType" AS ENUM ('APPOINTMENT', 'WORK_ORDER', 'WORK_ORDER_LINE', 'VEHICLE', 'DIAGNOSTIC', 'PARTS_REQUEST', 'SUPPLIER_ORDER', 'PAYMENT', 'SYSTEM');

CREATE TABLE "OperationalBlocker" (
  "id" TEXT NOT NULL,
  "code" VARCHAR(64) NOT NULL,
  "status" "OperationalBlockerStatus" NOT NULL DEFAULT 'OPEN',
  "priority" "OperationalBlockerPriority" NOT NULL DEFAULT 'MEDIUM',
  "sourceType" "OperationalBlockerSourceType" NOT NULL,
  "sourceId" VARCHAR(96) NOT NULL,
  "locationId" VARCHAR(64),
  "appointmentId" VARCHAR(64),
  "workOrderId" VARCHAR(64),
  "workOrderLineId" VARCHAR(64),
  "vehicleId" VARCHAR(64),
  "clientId" VARCHAR(64),
  "title" VARCHAR(240) NOT NULL,
  "reason" TEXT NOT NULL,
  "nextAction" TEXT,
  "openedByUserId" VARCHAR(64),
  "openedByName" VARCHAR(160),
  "acknowledgedAt" TIMESTAMP(3),
  "acknowledgedByUserId" VARCHAR(64),
  "resolvedAt" TIMESTAMP(3),
  "resolvedByUserId" VARCHAR(64),
  "resolutionComment" TEXT,
  "dueAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperationalBlocker_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OperationalBlocker_sourceType_sourceId_code_status_key"
  ON "OperationalBlocker"("sourceType", "sourceId", "code", "status");
CREATE INDEX "OperationalBlocker_locationId_status_priority_createdAt_idx"
  ON "OperationalBlocker"("locationId", "status", "priority", "createdAt");
CREATE INDEX "OperationalBlocker_sourceType_sourceId_status_idx"
  ON "OperationalBlocker"("sourceType", "sourceId", "status");
CREATE INDEX "OperationalBlocker_appointmentId_status_idx"
  ON "OperationalBlocker"("appointmentId", "status");
CREATE INDEX "OperationalBlocker_workOrderId_status_idx"
  ON "OperationalBlocker"("workOrderId", "status");
CREATE INDEX "OperationalBlocker_workOrderLineId_status_idx"
  ON "OperationalBlocker"("workOrderLineId", "status");
CREATE INDEX "OperationalBlocker_vehicleId_status_idx"
  ON "OperationalBlocker"("vehicleId", "status");
CREATE INDEX "OperationalBlocker_status_dueAt_idx"
  ON "OperationalBlocker"("status", "dueAt");
