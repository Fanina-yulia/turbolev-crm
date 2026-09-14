-- Management Result V1: additive weekly target / allocation / revision layer.
-- No production facts are changed by this migration.

CREATE TYPE "ManagementPlanStatus" AS ENUM ('DRAFT', 'OWNER_APPROVED', 'EXECUTIVE_DISTRIBUTED', 'STATION_ACCEPTED', 'ACTIVE', 'CLOSED');
CREATE TYPE "ManagementPlanMetric" AS ENUM ('MANAGEMENT_GROSS_PROFIT');
CREATE TYPE "ManagementPlanAllocationLevel" AS ENUM ('LOCATION', 'POST', 'DAY');

CREATE TABLE "ManagementPlan" (
    "id" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "metric" "ManagementPlanMetric" NOT NULL DEFAULT 'MANAGEMENT_GROSS_PROFIT',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
    "minimumAmount" DECIMAL(14,2),
    "targetAmount" DECIMAL(14,2) NOT NULL,
    "stretchAmount" DECIMAL(14,2),
    "breakEvenAmount" DECIMAL(14,2),
    "status" "ManagementPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" VARCHAR(64),
    "approvedById" VARCHAR(64),
    "approvedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ManagementPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManagementPlanAllocation" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "level" "ManagementPlanAllocationLevel" NOT NULL,
    "locationId" VARCHAR(64),
    "postId" VARCHAR(64),
    "day" DATE,
    "targetAmount" DECIMAL(14,2) NOT NULL,
    "capacityMinutes" INTEGER,
    "source" VARCHAR(32) NOT NULL DEFAULT 'AUTO_CAPACITY',
    "createdById" VARCHAR(64),
    "acceptedById" VARCHAR(64),
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ManagementPlanAllocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManagementPlanRevision" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "actorId" VARCHAR(64),
    "actorRole" VARCHAR(64),
    "action" VARCHAR(64) NOT NULL,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ManagementPlanRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ManagementPlan_periodStart_periodEnd_metric_key" ON "ManagementPlan"("periodStart", "periodEnd", "metric");
CREATE INDEX "ManagementPlan_status_periodStart_periodEnd_idx" ON "ManagementPlan"("status", "periodStart", "periodEnd");
CREATE INDEX "ManagementPlanAllocation_planId_level_idx" ON "ManagementPlanAllocation"("planId", "level");
CREATE INDEX "ManagementPlanAllocation_locationId_level_day_idx" ON "ManagementPlanAllocation"("locationId", "level", "day");
CREATE INDEX "ManagementPlanAllocation_postId_day_idx" ON "ManagementPlanAllocation"("postId", "day");
CREATE INDEX "ManagementPlanRevision_planId_createdAt_idx" ON "ManagementPlanRevision"("planId", "createdAt");
CREATE INDEX "ManagementPlanRevision_actorId_createdAt_idx" ON "ManagementPlanRevision"("actorId", "createdAt");
CREATE INDEX "ManagementPlanRevision_action_createdAt_idx" ON "ManagementPlanRevision"("action", "createdAt");

ALTER TABLE "ManagementPlanAllocation"
  ADD CONSTRAINT "ManagementPlanAllocation_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "ManagementPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ManagementPlanRevision"
  ADD CONSTRAINT "ManagementPlanRevision_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "ManagementPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
