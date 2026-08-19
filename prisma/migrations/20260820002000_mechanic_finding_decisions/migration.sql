ALTER TABLE "MechanicWorkFinding"
  ADD COLUMN "resolutionCode" VARCHAR(40),
  ADD COLUMN "estimateLineId" VARCHAR(64),
  ADD COLUMN "mechanicReply" TEXT,
  ADD COLUMN "mechanicRepliedAt" TIMESTAMP(3);

CREATE INDEX "MechanicWorkFinding_resolutionCode_updatedAt_idx"
  ON "MechanicWorkFinding"("resolutionCode", "updatedAt");
