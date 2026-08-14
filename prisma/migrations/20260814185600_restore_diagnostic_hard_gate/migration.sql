-- Hard Gate #1: ARRIVED creates a DiagnosticRequest; WorkOrder requires a confirmed diagnostic.

-- CreateEnum
CREATE TYPE "DiagnosticRequestStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "DiagnosticRequest" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "leadId" TEXT,
    "status" "DiagnosticRequestStatus" NOT NULL DEFAULT 'PENDING',
    "technicalConclusion" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DiagnosticRequest_pkey" PRIMARY KEY ("id")
);

-- Add the required DiagnosticRequest relation to WorkOrder in a migration-safe way.
ALTER TABLE "WorkOrder" ADD COLUMN "diagnosticRequestId" TEXT;
ALTER TABLE "WorkOrder" ALTER COLUMN "status" SET DEFAULT 'PARTS_REVIEW';

-- Preserve any legacy WorkOrders if this migration is applied to a DB that already contains rows.
-- Each existing WO receives a synthetic confirmed diagnostic so the new invariant stays valid.
INSERT INTO "DiagnosticRequest" (
    "id",
    "clientId",
    "vehicleId",
    "status",
    "technicalConclusion",
    "confirmedAt",
    "createdAt",
    "updatedAt"
)
SELECT
    'legacy_diag_' || md5("id"),
    "clientId",
    "vehicleId",
    'CONFIRMED',
    'Legacy WorkOrder migrated under Hard Gate #1',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "WorkOrder";

UPDATE "WorkOrder"
SET "diagnosticRequestId" = 'legacy_diag_' || md5("id")
WHERE "diagnosticRequestId" IS NULL;

ALTER TABLE "WorkOrder" ALTER COLUMN "diagnosticRequestId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "DiagnosticRequest_clientId_status_idx" ON "DiagnosticRequest"("clientId", "status");
CREATE INDEX "DiagnosticRequest_vehicleId_status_idx" ON "DiagnosticRequest"("vehicleId", "status");
CREATE INDEX "DiagnosticRequest_leadId_idx" ON "DiagnosticRequest"("leadId");
CREATE INDEX "DiagnosticRequest_createdAt_idx" ON "DiagnosticRequest"("createdAt");
CREATE UNIQUE INDEX "WorkOrder_diagnosticRequestId_key" ON "WorkOrder"("diagnosticRequestId");

-- AddForeignKey
ALTER TABLE "DiagnosticRequest" ADD CONSTRAINT "DiagnosticRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiagnosticRequest" ADD CONSTRAINT "DiagnosticRequest_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiagnosticRequest" ADD CONSTRAINT "DiagnosticRequest_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_diagnosticRequestId_fkey" FOREIGN KEY ("diagnosticRequestId") REFERENCES "DiagnosticRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
