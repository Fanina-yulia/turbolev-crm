ALTER TABLE "ServiceAppointment"
  ADD COLUMN "requiresDiagnosticFirst" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "WorkOrderCompletionPhotoKind" AS ENUM ('TOOL_FIRST', 'TOOL_SECOND', 'WORKSPACE_CLEAN');

CREATE TABLE "WorkOrderCompletionPhoto" (
  "id" TEXT NOT NULL,
  "workOrderId" TEXT NOT NULL,
  "workOrderLineId" TEXT NOT NULL,
  "kind" "WorkOrderCompletionPhotoKind" NOT NULL,
  "fileName" VARCHAR(255) NOT NULL,
  "mimeType" VARCHAR(160) NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "fileData" BYTEA NOT NULL,
  "createdByUserId" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkOrderCompletionPhoto_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkOrderCompletionPhoto_workOrderLineId_kind_key"
  ON "WorkOrderCompletionPhoto"("workOrderLineId", "kind");
CREATE INDEX "WorkOrderCompletionPhoto_workOrderId_createdAt_idx"
  ON "WorkOrderCompletionPhoto"("workOrderId", "createdAt");

ALTER TABLE "WorkOrderCompletionPhoto"
  ADD CONSTRAINT "WorkOrderCompletionPhoto_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkOrderCompletionPhoto"
  ADD CONSTRAINT "WorkOrderCompletionPhoto_workOrderLineId_fkey"
  FOREIGN KEY ("workOrderLineId") REFERENCES "WorkOrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
