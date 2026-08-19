-- Mechanic findings raised while executing assigned WorkOrder lines.
CREATE TYPE "MechanicWorkFindingStatus" AS ENUM ('SUBMITTED', 'REVIEWED', 'RESOLVED', 'REJECTED');

CREATE TABLE "MechanicWorkFinding" (
    "id" TEXT NOT NULL,
    "workOrderId" VARCHAR(64) NOT NULL,
    "workOrderLineId" VARCHAR(64) NOT NULL,
    "mechanicUserId" VARCHAR(64) NOT NULL,
    "mechanicResourceId" VARCHAR(64),
    "findingText" TEXT NOT NULL,
    "recommendation" TEXT,
    "urgency" "DiagnosticUrgency" NOT NULL DEFAULT 'INFO',
    "status" "MechanicWorkFindingStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" VARCHAR(64),
    "managerComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MechanicWorkFinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MechanicWorkFindingMedia" (
    "id" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" VARCHAR(160) NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileData" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MechanicWorkFindingMedia_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MechanicWorkFinding_workOrderId_status_createdAt_idx"
ON "MechanicWorkFinding"("workOrderId", "status", "createdAt");

CREATE INDEX "MechanicWorkFinding_workOrderLineId_createdAt_idx"
ON "MechanicWorkFinding"("workOrderLineId", "createdAt");

CREATE INDEX "MechanicWorkFinding_mechanicUserId_createdAt_idx"
ON "MechanicWorkFinding"("mechanicUserId", "createdAt");

CREATE INDEX "MechanicWorkFindingMedia_findingId_createdAt_idx"
ON "MechanicWorkFindingMedia"("findingId", "createdAt");

ALTER TABLE "MechanicWorkFindingMedia"
ADD CONSTRAINT "MechanicWorkFindingMedia_findingId_fkey"
FOREIGN KEY ("findingId") REFERENCES "MechanicWorkFinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
