-- Management Result V1 phase 2/3: people, bonus, forecast and deviation read models.
-- Additive only: no existing production facts are updated or deleted.

CREATE TYPE "EmployeeShiftStatus" AS ENUM ('ON_SHIFT','DAY_OFF','VACATION','SICK','ABSENT','LATE','PARTIAL_SHIFT');
CREATE TYPE "ManagementBonusBasis" AS ENUM ('FACT','ABOVE_BREAK_EVEN','ABOVE_TARGET');
CREATE TYPE "ManagementBonusResultStatus" AS ENUM ('PRELIMINARY','FINAL');
CREATE TYPE "ManagementDeviationSeverity" AS ENUM ('INFO','WARNING','CRITICAL');

CREATE TABLE "EmployeeShift" (
  "id" TEXT NOT NULL,
  "employeeId" VARCHAR(64) NOT NULL,
  "locationId" VARCHAR(64) NOT NULL,
  "day" DATE NOT NULL,
  "startMinute" INTEGER,
  "endMinute" INTEGER,
  "status" "EmployeeShiftStatus" NOT NULL DEFAULT 'ON_SHIFT',
  "note" TEXT,
  "createdById" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmployeeShift_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StationBonusScheme" (
  "id" TEXT NOT NULL,
  "locationId" VARCHAR(64),
  "name" VARCHAR(160) NOT NULL DEFAULT 'Бонус керівника станції',
  "basis" "ManagementBonusBasis" NOT NULL DEFAULT 'ABOVE_BREAK_EVEN',
  "activationThresholdPct" DECIMAL(7,2) NOT NULL DEFAULT 90,
  "basePercent" DECIMAL(7,3) NOT NULL DEFAULT 3,
  "fixedAmount" DECIMAL(14,2),
  "tier2ThresholdPct" DECIMAL(7,2),
  "tier2Percent" DECIMAL(7,3),
  "tier3ThresholdPct" DECIMAL(7,2),
  "tier3Percent" DECIMAL(7,3),
  "minMarginPct" DECIMAL(7,2),
  "maxWarrantyRatePct" DECIMAL(7,2),
  "maxOverdueReceivablePct" DECIMAL(7,2),
  "minDataQualityPct" DECIMAL(7,2),
  "capAmount" DECIMAL(14,2),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "createdById" VARCHAR(64),
  "updatedById" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StationBonusScheme_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StationBonusResult" (
  "id" TEXT NOT NULL,
  "schemeId" VARCHAR(64),
  "planId" VARCHAR(64),
  "locationId" VARCHAR(64) NOT NULL,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "status" "ManagementBonusResultStatus" NOT NULL DEFAULT 'PRELIMINARY',
  "targetAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "factAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "performancePct" DECIMAL(9,2) NOT NULL DEFAULT 0,
  "qualityScorePct" DECIMAL(9,2) NOT NULL DEFAULT 0,
  "payoutAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "details" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finalizedAt" TIMESTAMP(3),
  "finalizedById" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StationBonusResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManagementForecastSnapshot" (
  "id" TEXT NOT NULL,
  "snapshotKey" VARCHAR(180) NOT NULL,
  "planId" VARCHAR(64),
  "locationId" VARCHAR(64),
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "factAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "paceForecast" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "conservativeForecast" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "confirmedForecast" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "weightedForecast" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "baseForecast" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "optimisticForecast" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "gapAmount" DECIMAL(14,2),
  "factors" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ManagementForecastSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManagementDeviation" (
  "id" TEXT NOT NULL,
  "deviationKey" VARCHAR(190) NOT NULL,
  "planId" VARCHAR(64),
  "locationId" VARCHAR(64),
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "code" VARCHAR(64) NOT NULL,
  "severity" "ManagementDeviationSeverity" NOT NULL DEFAULT 'WARNING',
  "impactAmount" DECIMAL(14,2),
  "impactHours" DECIMAL(12,2),
  "impactClients" INTEGER,
  "sourceType" VARCHAR(64),
  "sourceId" VARCHAR(120),
  "description" TEXT NOT NULL,
  "recommendedAction" TEXT,
  "status" VARCHAR(24) NOT NULL DEFAULT 'OPEN',
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" VARCHAR(64),
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ManagementDeviation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmployeeShift_employeeId_locationId_day_key" ON "EmployeeShift"("employeeId","locationId","day");
CREATE INDEX "EmployeeShift_locationId_day_status_idx" ON "EmployeeShift"("locationId","day","status");
CREATE INDEX "EmployeeShift_employeeId_day_idx" ON "EmployeeShift"("employeeId","day");
CREATE INDEX "StationBonusScheme_locationId_isActive_effectiveFrom_effectiveTo_idx" ON "StationBonusScheme"("locationId","isActive","effectiveFrom","effectiveTo");
CREATE INDEX "StationBonusScheme_isActive_effectiveFrom_idx" ON "StationBonusScheme"("isActive","effectiveFrom");
CREATE UNIQUE INDEX "StationBonusResult_locationId_periodStart_periodEnd_status_key" ON "StationBonusResult"("locationId","periodStart","periodEnd","status");
CREATE INDEX "StationBonusResult_planId_locationId_idx" ON "StationBonusResult"("planId","locationId");
CREATE INDEX "StationBonusResult_status_periodStart_periodEnd_idx" ON "StationBonusResult"("status","periodStart","periodEnd");
CREATE UNIQUE INDEX "ManagementForecastSnapshot_snapshotKey_key" ON "ManagementForecastSnapshot"("snapshotKey");
CREATE INDEX "ManagementForecastSnapshot_planId_locationId_periodStart_periodEnd_idx" ON "ManagementForecastSnapshot"("planId","locationId","periodStart","periodEnd");
CREATE INDEX "ManagementForecastSnapshot_locationId_createdAt_idx" ON "ManagementForecastSnapshot"("locationId","createdAt");
CREATE UNIQUE INDEX "ManagementDeviation_deviationKey_key" ON "ManagementDeviation"("deviationKey");
CREATE INDEX "ManagementDeviation_planId_locationId_status_idx" ON "ManagementDeviation"("planId","locationId","status");
CREATE INDEX "ManagementDeviation_locationId_periodStart_periodEnd_severity_idx" ON "ManagementDeviation"("locationId","periodStart","periodEnd","severity");
CREATE INDEX "ManagementDeviation_code_status_detectedAt_idx" ON "ManagementDeviation"("code","status","detectedAt");
