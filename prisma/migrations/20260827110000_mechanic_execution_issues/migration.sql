CREATE TYPE "WorkExecutionIssueStatus" AS ENUM ('OPEN', 'VIEWED', 'NEEDS_CLARIFICATION', 'RESOLVED', 'CANCELLED');

CREATE TABLE "WorkExecutionIssue" (
  "id" TEXT NOT NULL,
  "assignmentId" VARCHAR(64) NOT NULL,
  "workOrderId" VARCHAR(64) NOT NULL,
  "vehicleId" VARCHAR(64),
  "clientId" VARCHAR(64),
  "mechanicId" VARCHAR(64) NOT NULL,
  "locationId" VARCHAR(64) NOT NULL,
  "reasonCode" VARCHAR(48) NOT NULL,
  "comment" VARCHAR(500),
  "status" "WorkExecutionIssueStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "viewedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "resolvedByUserId" VARCHAR(64),
  "resolutionType" VARCHAR(48),
  "resolutionComment" VARCHAR(500),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkExecutionIssue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkExecutionIssueAttachment" (
  "id" TEXT NOT NULL,
  "issueId" VARCHAR(64) NOT NULL,
  "fileId" VARCHAR(160) NOT NULL,
  "fileType" VARCHAR(80) NOT NULL,
  "fileName" VARCHAR(240) NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "fileData" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" VARCHAR(64) NOT NULL,
  CONSTRAINT "WorkExecutionIssueAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkExecutionIssue_assignmentId_status_key" ON "WorkExecutionIssue"("assignmentId", "status");
CREATE INDEX "WorkExecutionIssue_locationId_status_createdAt_idx" ON "WorkExecutionIssue"("locationId", "status", "createdAt");
CREATE INDEX "WorkExecutionIssue_mechanicId_status_createdAt_idx" ON "WorkExecutionIssue"("mechanicId", "status", "createdAt");
CREATE INDEX "WorkExecutionIssue_workOrderId_createdAt_idx" ON "WorkExecutionIssue"("workOrderId", "createdAt");
CREATE INDEX "WorkExecutionIssueAttachment_issueId_createdAt_idx" ON "WorkExecutionIssueAttachment"("issueId", "createdAt");
ALTER TABLE "WorkExecutionIssueAttachment" ADD CONSTRAINT "WorkExecutionIssueAttachment_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "WorkExecutionIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
