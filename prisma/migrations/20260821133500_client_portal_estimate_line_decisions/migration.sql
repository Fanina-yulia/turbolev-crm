CREATE TYPE "ClientEstimateLineDecisionValue" AS ENUM ('APPROVE', 'REJECT');

CREATE TABLE "ClientEstimateLineDecision" (
  "id" TEXT NOT NULL,
  "estimateId" VARCHAR(64) NOT NULL,
  "workOrderId" VARCHAR(64) NOT NULL,
  "clientId" VARCHAR(64) NOT NULL,
  "vehicleId" VARCHAR(64) NOT NULL,
  "sessionId" VARCHAR(64),
  "estimateRevision" INTEGER NOT NULL,
  "estimateFingerprint" VARCHAR(64) NOT NULL,
  "lineId" VARCHAR(64) NOT NULL,
  "decision" "ClientEstimateLineDecisionValue" NOT NULL,
  "lineSnapshot" JSONB NOT NULL,
  "note" TEXT,
  "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientEstimateLineDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientEstimateLineDecision_estimateId_lineId_key"
  ON "ClientEstimateLineDecision"("estimateId", "lineId");
CREATE INDEX "ClientEstimateLineDecision_clientId_vehicleId_decidedAt_idx"
  ON "ClientEstimateLineDecision"("clientId", "vehicleId", "decidedAt");
CREATE INDEX "ClientEstimateLineDecision_workOrderId_estimateId_idx"
  ON "ClientEstimateLineDecision"("workOrderId", "estimateId");
CREATE INDEX "ClientEstimateLineDecision_sessionId_decidedAt_idx"
  ON "ClientEstimateLineDecision"("sessionId", "decidedAt");
