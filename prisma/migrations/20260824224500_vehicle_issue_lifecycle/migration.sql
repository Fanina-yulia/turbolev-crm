CREATE TYPE "VehicleIssueStatus" AS ENUM (
  'OPEN',
  'DECISION_REQUIRED',
  'QUOTED',
  'WAITING_CUSTOMER',
  'APPROVED',
  'WAITING_PARTS',
  'READY_FOR_REPAIR',
  'IN_REPAIR',
  'RESOLVED',
  'DEFERRED',
  'DISMISSED'
);

CREATE TABLE "VehicleIssue" (
  "id" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "sourceFindingId" TEXT,
  "sourceDiagnosticId" TEXT,
  "sourceTemplateItemId" TEXT,
  "sourcePosition" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "action" TEXT,
  "urgency" TEXT,
  "suggestedWorkName" TEXT,
  "suggestedPartName" TEXT,
  "status" "VehicleIssueStatus" NOT NULL DEFAULT 'DECISION_REQUIRED',
  "workOrderId" TEXT,
  "deferredUntil" TIMESTAMP(3),
  "firstDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "resolvedByUserId" TEXT,
  "resolutionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VehicleIssue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VehicleIssue_sourceFindingId_key" ON "VehicleIssue"("sourceFindingId");
CREATE INDEX "VehicleIssue_vehicleId_status_idx" ON "VehicleIssue"("vehicleId", "status");
CREATE INDEX "VehicleIssue_sourceDiagnosticId_idx" ON "VehicleIssue"("sourceDiagnosticId");
CREATE INDEX "VehicleIssue_workOrderId_idx" ON "VehicleIssue"("workOrderId");
CREATE INDEX "VehicleIssue_sourceTemplateItemId_sourcePosition_idx" ON "VehicleIssue"("sourceTemplateItemId", "sourcePosition");
