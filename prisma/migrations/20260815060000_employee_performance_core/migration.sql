-- Turbo LEV employee performance core v1
-- Compatible with clean DB and production where legacy HR tables already exist.

-- CreateEnum
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StaffAttributionType') THEN
    CREATE TYPE "StaffAttributionType" AS ENUM ('DIRECT', 'MANAGED', 'INFLUENCED');
  END IF;
END
$migration$;

-- CreateEnum
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'KpiDirection') THEN
    CREATE TYPE "KpiDirection" AS ENUM ('HIGHER_BETTER', 'LOWER_BETTER', 'TARGET');
  END IF;
END
$migration$;

-- CreateEnum
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'KpiValueUnit') THEN
    CREATE TYPE "KpiValueUnit" AS ENUM ('COUNT', 'HOURS', 'NORM_HOURS', 'PERCENT', 'UAH', 'SCORE', 'MINUTES', 'DAYS', 'RATIO');
  END IF;
END
$migration$;

-- CreateEnum
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PayrollPeriodStatus') THEN
    CREATE TYPE "PayrollPeriodStatus" AS ENUM ('OPEN', 'REVIEW', 'CLOSED');
  END IF;
END
$migration$;

-- CreateEnum
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SalaryAccrualStatus') THEN
    CREATE TYPE "SalaryAccrualStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');
  END IF;
END
$migration$;

-- CreateEnum
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SalaryAccrualCategory') THEN
    CREATE TYPE "SalaryAccrualCategory" AS ENUM ('BASE', 'LABOR', 'SALES', 'KPI', 'BONUS', 'ALLOWANCE', 'DEDUCTION', 'ADJUSTMENT', 'OTHER');
  END IF;
END
$migration$;

-- CreateEnum
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EmployeeCostCategory') THEN
    CREATE TYPE "EmployeeCostCategory" AS ENUM ('EMPLOYER_TAX', 'WORKPLACE', 'SOFTWARE', 'TOOLS', 'TRAINING', 'TRAVEL', 'OTHER');
  END IF;
END
$migration$;

-- CreateEnum
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PerformanceEventStatus') THEN
    CREATE TYPE "PerformanceEventStatus" AS ENUM ('POSTED', 'REVERSED');
  END IF;
END
$migration$;

-- CreateEnum
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EconomicsStatus') THEN
    CREATE TYPE "EconomicsStatus" AS ENUM ('INSUFFICIENT_DATA', 'BELOW_BREAK_EVEN', 'BREAK_EVEN', 'PROFITABLE', 'CAPACITY_CONSTRAINED');
  END IF;
END
$migration$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "EmployeeProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "birthDate" TIMESTAMP(6),
    "email" TEXT,
    "phone" TEXT,
    "phoneCountry" TEXT,
    "address" TEXT,
    "photoUrl" TEXT,
    "personnelCategory" TEXT,
    "position" TEXT,
    "crmLogin" TEXT,
    "crmPasswordHash" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "baseSalary" DECIMAL(14,2),
    "minimumSalary" DECIMAL(14,2),
    "workPercent" DECIMAL(6,2),
    "partsSalesPercent" DECIMAL(6,2),
    "partsMarginPercent" DECIMAL(6,2),
    "netProfitPercent" DECIMAL(6,2),
    "payrollRuleNote" TEXT,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "EmployeeDocument" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fileUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'MISSING',
    "uploadedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "StaffRole" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" TEXT NOT NULL,
    "category" VARCHAR(64),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "EmployeeRoleAssignment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "locationId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "KpiDefinition" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(96) NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" "KpiValueUnit" NOT NULL,
    "direction" "KpiDirection" NOT NULL DEFAULT 'HIGHER_BETTER',
    "dataSource" VARCHAR(64),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RoleKpiRule" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "kpiDefinitionId" TEXT NOT NULL,
    "weight" DECIMAL(5,2) NOT NULL,
    "defaultTarget" DECIMAL(18,4),
    "yellowThresholdPct" DECIMAL(7,2),
    "redThresholdPct" DECIMAL(7,2),
    "isCore" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleKpiRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "EmployeeKpiResult" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kpiDefinitionId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "actualValue" DECIMAL(18,4) NOT NULL,
    "targetValue" DECIMAL(18,4),
    "score" DECIMAL(7,2),
    "source" VARCHAR(32) NOT NULL DEFAULT 'AUTO',
    "sourceRef" VARCHAR(160),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeKpiResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PayrollPeriod" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(16) NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "status" "PayrollPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedByEmployeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SalaryAccrual" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "payrollPeriodId" TEXT NOT NULL,
    "category" "SalaryAccrualCategory" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "status" "SalaryAccrualStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceType" VARCHAR(64),
    "sourceId" VARCHAR(160),
    "description" TEXT,
    "reversalOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryAccrual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SalaryPayment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "payrollPeriodId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
    "paidAt" TIMESTAMP(3) NOT NULL,
    "cashTransactionId" VARCHAR(64),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "EmployeeCostEntry" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "payrollPeriodId" TEXT,
    "category" "EmployeeCostCategory" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "sourceType" VARCHAR(64),
    "sourceId" VARCHAR(160),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeCostEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PerformanceEvent" (
    "id" TEXT NOT NULL,
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "eventType" VARCHAR(96) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "sourceType" VARCHAR(64) NOT NULL,
    "sourceId" VARCHAR(160) NOT NULL,
    "workOrderId" VARCHAR(64),
    "leadId" VARCHAR(64),
    "locationId" TEXT,
    "status" "PerformanceEventStatus" NOT NULL DEFAULT 'POSTED',
    "reversalOfId" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AttributionLedgerEntry" (
    "id" TEXT NOT NULL,
    "performanceEventId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "attributionType" "StaffAttributionType" NOT NULL,
    "metricCode" VARCHAR(96) NOT NULL,
    "kpiDefinitionId" TEXT,
    "value" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "unit" "KpiValueUnit" NOT NULL,
    "share" DECIMAL(7,4),
    "economicValue" DECIMAL(14,2),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
    "additiveContribution" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "isFrozen" BOOLEAN NOT NULL DEFAULT false,
    "frozenAt" TIMESTAMP(3),
    "payrollPeriodId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttributionLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "EmployeeEconomicsSnapshot" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "payrollPeriodId" TEXT,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "fullCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "directContribution" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "managedValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "influencedValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "breakEvenPct" DECIMAL(9,2),
    "roiPct" DECIMAL(9,2),
    "breakEvenAt" TIMESTAMP(3),
    "capacityUtilization" DECIMAL(7,2),
    "kpiScore" DECIMAL(7,2),
    "status" "EconomicsStatus" NOT NULL DEFAULT 'INSUFFICIENT_DATA',
    "dataCompletenessPct" DECIMAL(7,2),
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeEconomicsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RoleCapacityStandard" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "locationId" TEXT,
    "metricCode" VARCHAR(96) NOT NULL,
    "capacityPerFte" DECIMAL(18,4) NOT NULL,
    "unit" "KpiValueUnit" NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleCapacityStandard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RoleEconomicsSnapshot" (
    "id" TEXT NOT NULL,
    "snapshotKey" VARCHAR(160) NOT NULL,
    "roleId" TEXT NOT NULL,
    "locationId" TEXT,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "actualFte" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "requiredFte" DECIMAL(8,2),
    "fullCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "directContribution" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "managedValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "roiPct" DECIMAL(9,2),
    "utilizationPct" DECIMAL(7,2),
    "kpiScore" DECIMAL(7,2),
    "status" "EconomicsStatus" NOT NULL DEFAULT 'INSUFFICIENT_DATA',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleEconomicsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "EmployeeProfile_userId_key" ON "EmployeeProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "EmployeeProfile_email_key" ON "EmployeeProfile"("email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmployeeProfile_category_idx" ON "EmployeeProfile"("personnelCategory");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmployeeProfile_position_idx" ON "EmployeeProfile"("position");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmployeeDocument_employee_idx" ON "EmployeeDocument"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "StaffRole_code_key" ON "StaffRole"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StaffRole_isActive_sortOrder_idx" ON "StaffRole"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmployeeRoleAssignment_employeeId_startsAt_endsAt_idx" ON "EmployeeRoleAssignment"("employeeId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmployeeRoleAssignment_roleId_startsAt_endsAt_idx" ON "EmployeeRoleAssignment"("roleId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmployeeRoleAssignment_locationId_startsAt_endsAt_idx" ON "EmployeeRoleAssignment"("locationId", "startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "KpiDefinition_code_key" ON "KpiDefinition"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "KpiDefinition_isActive_code_idx" ON "KpiDefinition"("isActive", "code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RoleKpiRule_kpiDefinitionId_idx" ON "RoleKpiRule"("kpiDefinitionId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "RoleKpiRule_roleId_kpiDefinitionId_key" ON "RoleKpiRule"("roleId", "kpiDefinitionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmployeeKpiResult_employeeId_periodStart_periodEnd_idx" ON "EmployeeKpiResult"("employeeId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmployeeKpiResult_kpiDefinitionId_periodStart_periodEnd_idx" ON "EmployeeKpiResult"("kpiDefinitionId", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "EmployeeKpiResult_employeeId_kpiDefinitionId_periodStart_pe_key" ON "EmployeeKpiResult"("employeeId", "kpiDefinitionId", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollPeriod_key_key" ON "PayrollPeriod"("key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PayrollPeriod_status_periodStart_idx" ON "PayrollPeriod"("status", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollPeriod_periodStart_periodEnd_key" ON "PayrollPeriod"("periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SalaryAccrual_reversalOfId_key" ON "SalaryAccrual"("reversalOfId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SalaryAccrual_employeeId_occurredAt_status_idx" ON "SalaryAccrual"("employeeId", "occurredAt", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SalaryAccrual_payrollPeriodId_status_idx" ON "SalaryAccrual"("payrollPeriodId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SalaryAccrual_sourceType_sourceId_idx" ON "SalaryAccrual"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SalaryPayment_cashTransactionId_key" ON "SalaryPayment"("cashTransactionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SalaryPayment_employeeId_paidAt_idx" ON "SalaryPayment"("employeeId", "paidAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SalaryPayment_payrollPeriodId_paidAt_idx" ON "SalaryPayment"("payrollPeriodId", "paidAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmployeeCostEntry_employeeId_occurredAt_idx" ON "EmployeeCostEntry"("employeeId", "occurredAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmployeeCostEntry_payrollPeriodId_category_idx" ON "EmployeeCostEntry"("payrollPeriodId", "category");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmployeeCostEntry_sourceType_sourceId_idx" ON "EmployeeCostEntry"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PerformanceEvent_idempotencyKey_key" ON "PerformanceEvent"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PerformanceEvent_reversalOfId_key" ON "PerformanceEvent"("reversalOfId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PerformanceEvent_eventType_occurredAt_idx" ON "PerformanceEvent"("eventType", "occurredAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PerformanceEvent_sourceType_sourceId_idx" ON "PerformanceEvent"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PerformanceEvent_workOrderId_idx" ON "PerformanceEvent"("workOrderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PerformanceEvent_leadId_idx" ON "PerformanceEvent"("leadId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PerformanceEvent_locationId_occurredAt_idx" ON "PerformanceEvent"("locationId", "occurredAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AttributionLedgerEntry_employeeId_attributionType_createdAt_idx" ON "AttributionLedgerEntry"("employeeId", "attributionType", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AttributionLedgerEntry_metricCode_createdAt_idx" ON "AttributionLedgerEntry"("metricCode", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AttributionLedgerEntry_payrollPeriodId_isFrozen_idx" ON "AttributionLedgerEntry"("payrollPeriodId", "isFrozen");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AttributionLedgerEntry_performanceEventId_employeeId_attrib_key" ON "AttributionLedgerEntry"("performanceEventId", "employeeId", "attributionType", "metricCode");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmployeeEconomicsSnapshot_periodStart_periodEnd_status_idx" ON "EmployeeEconomicsSnapshot"("periodStart", "periodEnd", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmployeeEconomicsSnapshot_payrollPeriodId_status_idx" ON "EmployeeEconomicsSnapshot"("payrollPeriodId", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "EmployeeEconomicsSnapshot_employeeId_periodStart_periodEnd_key" ON "EmployeeEconomicsSnapshot"("employeeId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RoleCapacityStandard_roleId_effectiveFrom_effectiveTo_idx" ON "RoleCapacityStandard"("roleId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RoleCapacityStandard_locationId_effectiveFrom_effectiveTo_idx" ON "RoleCapacityStandard"("locationId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "RoleEconomicsSnapshot_snapshotKey_key" ON "RoleEconomicsSnapshot"("snapshotKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RoleEconomicsSnapshot_roleId_periodStart_periodEnd_idx" ON "RoleEconomicsSnapshot"("roleId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RoleEconomicsSnapshot_locationId_periodStart_periodEnd_idx" ON "RoleEconomicsSnapshot"("locationId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RoleEconomicsSnapshot_status_periodStart_periodEnd_idx" ON "RoleEconomicsSnapshot"("status", "periodStart", "periodEnd");

-- AddForeignKey
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EmployeeProfile_userId_fkey') THEN
    ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EmployeeDocument_employeeId_fkey') THEN
    ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EmployeeRoleAssignment_employeeId_fkey') THEN
    ALTER TABLE "EmployeeRoleAssignment" ADD CONSTRAINT "EmployeeRoleAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EmployeeRoleAssignment_roleId_fkey') THEN
    ALTER TABLE "EmployeeRoleAssignment" ADD CONSTRAINT "EmployeeRoleAssignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StaffRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EmployeeRoleAssignment_locationId_fkey') THEN
    ALTER TABLE "EmployeeRoleAssignment" ADD CONSTRAINT "EmployeeRoleAssignment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ServiceLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RoleKpiRule_roleId_fkey') THEN
    ALTER TABLE "RoleKpiRule" ADD CONSTRAINT "RoleKpiRule_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StaffRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RoleKpiRule_kpiDefinitionId_fkey') THEN
    ALTER TABLE "RoleKpiRule" ADD CONSTRAINT "RoleKpiRule_kpiDefinitionId_fkey" FOREIGN KEY ("kpiDefinitionId") REFERENCES "KpiDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EmployeeKpiResult_employeeId_fkey') THEN
    ALTER TABLE "EmployeeKpiResult" ADD CONSTRAINT "EmployeeKpiResult_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EmployeeKpiResult_kpiDefinitionId_fkey') THEN
    ALTER TABLE "EmployeeKpiResult" ADD CONSTRAINT "EmployeeKpiResult_kpiDefinitionId_fkey" FOREIGN KEY ("kpiDefinitionId") REFERENCES "KpiDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayrollPeriod_closedByEmployeeId_fkey') THEN
    ALTER TABLE "PayrollPeriod" ADD CONSTRAINT "PayrollPeriod_closedByEmployeeId_fkey" FOREIGN KEY ("closedByEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SalaryAccrual_employeeId_fkey') THEN
    ALTER TABLE "SalaryAccrual" ADD CONSTRAINT "SalaryAccrual_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SalaryAccrual_payrollPeriodId_fkey') THEN
    ALTER TABLE "SalaryAccrual" ADD CONSTRAINT "SalaryAccrual_payrollPeriodId_fkey" FOREIGN KEY ("payrollPeriodId") REFERENCES "PayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SalaryAccrual_reversalOfId_fkey') THEN
    ALTER TABLE "SalaryAccrual" ADD CONSTRAINT "SalaryAccrual_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "SalaryAccrual"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SalaryPayment_employeeId_fkey') THEN
    ALTER TABLE "SalaryPayment" ADD CONSTRAINT "SalaryPayment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SalaryPayment_payrollPeriodId_fkey') THEN
    ALTER TABLE "SalaryPayment" ADD CONSTRAINT "SalaryPayment_payrollPeriodId_fkey" FOREIGN KEY ("payrollPeriodId") REFERENCES "PayrollPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EmployeeCostEntry_employeeId_fkey') THEN
    ALTER TABLE "EmployeeCostEntry" ADD CONSTRAINT "EmployeeCostEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EmployeeCostEntry_payrollPeriodId_fkey') THEN
    ALTER TABLE "EmployeeCostEntry" ADD CONSTRAINT "EmployeeCostEntry_payrollPeriodId_fkey" FOREIGN KEY ("payrollPeriodId") REFERENCES "PayrollPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PerformanceEvent_locationId_fkey') THEN
    ALTER TABLE "PerformanceEvent" ADD CONSTRAINT "PerformanceEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ServiceLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PerformanceEvent_reversalOfId_fkey') THEN
    ALTER TABLE "PerformanceEvent" ADD CONSTRAINT "PerformanceEvent_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "PerformanceEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AttributionLedgerEntry_performanceEventId_fkey') THEN
    ALTER TABLE "AttributionLedgerEntry" ADD CONSTRAINT "AttributionLedgerEntry_performanceEventId_fkey" FOREIGN KEY ("performanceEventId") REFERENCES "PerformanceEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AttributionLedgerEntry_employeeId_fkey') THEN
    ALTER TABLE "AttributionLedgerEntry" ADD CONSTRAINT "AttributionLedgerEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AttributionLedgerEntry_kpiDefinitionId_fkey') THEN
    ALTER TABLE "AttributionLedgerEntry" ADD CONSTRAINT "AttributionLedgerEntry_kpiDefinitionId_fkey" FOREIGN KEY ("kpiDefinitionId") REFERENCES "KpiDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AttributionLedgerEntry_payrollPeriodId_fkey') THEN
    ALTER TABLE "AttributionLedgerEntry" ADD CONSTRAINT "AttributionLedgerEntry_payrollPeriodId_fkey" FOREIGN KEY ("payrollPeriodId") REFERENCES "PayrollPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EmployeeEconomicsSnapshot_employeeId_fkey') THEN
    ALTER TABLE "EmployeeEconomicsSnapshot" ADD CONSTRAINT "EmployeeEconomicsSnapshot_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EmployeeEconomicsSnapshot_payrollPeriodId_fkey') THEN
    ALTER TABLE "EmployeeEconomicsSnapshot" ADD CONSTRAINT "EmployeeEconomicsSnapshot_payrollPeriodId_fkey" FOREIGN KEY ("payrollPeriodId") REFERENCES "PayrollPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RoleCapacityStandard_roleId_fkey') THEN
    ALTER TABLE "RoleCapacityStandard" ADD CONSTRAINT "RoleCapacityStandard_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StaffRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RoleCapacityStandard_locationId_fkey') THEN
    ALTER TABLE "RoleCapacityStandard" ADD CONSTRAINT "RoleCapacityStandard_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ServiceLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RoleEconomicsSnapshot_roleId_fkey') THEN
    ALTER TABLE "RoleEconomicsSnapshot" ADD CONSTRAINT "RoleEconomicsSnapshot_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StaffRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- AddForeignKey
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RoleEconomicsSnapshot_locationId_fkey') THEN
    ALTER TABLE "RoleEconomicsSnapshot" ADD CONSTRAINT "RoleEconomicsSnapshot_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ServiceLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$migration$;


-- Database-level invariants for attribution and KPI configuration.
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AttributionLedgerEntry_share_range_check') THEN
    ALTER TABLE "AttributionLedgerEntry" ADD CONSTRAINT "AttributionLedgerEntry_share_range_check"
      CHECK ("share" IS NULL OR ("share" >= 0 AND "share" <= 1));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AttributionLedgerEntry_additive_direct_check') THEN
    ALTER TABLE "AttributionLedgerEntry" ADD CONSTRAINT "AttributionLedgerEntry_additive_direct_check"
      CHECK (NOT "additiveContribution" OR "attributionType" = 'DIRECT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayrollPeriod_date_order_check') THEN
    ALTER TABLE "PayrollPeriod" ADD CONSTRAINT "PayrollPeriod_date_order_check"
      CHECK ("periodStart" <= "periodEnd");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RoleKpiRule_weight_range_check') THEN
    ALTER TABLE "RoleKpiRule" ADD CONSTRAINT "RoleKpiRule_weight_range_check"
      CHECK ("weight" >= 0 AND "weight" <= 100);
  END IF;
END
$migration$;

-- Seed agreed role/KPI catalog. KPI targets and salary formulas intentionally remain unset.
INSERT INTO "StaffRole" ("id","code","name","category","isActive","sortOrder","createdAt","updatedAt") VALUES
('role-owner','OWNER','Власник','MANAGEMENT',true,10,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('role-executive-director','EXECUTIVE_DIRECTOR','Виконавчий директор','MANAGEMENT',true,20,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('role-head-of-sales','HEAD_OF_SALES','Керівник відділу продажів','SALES',true,30,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('role-sales','SALES','Продавець','SALES',true,40,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('role-parts-specialist','PARTS_SPECIALIST','Підборщик запчастин','PARTS',true,50,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('role-station-manager','STATION_MANAGER','Завідувач станцією','SERVICE',true,60,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('role-mechanic','MECHANIC','Автомеханік','SERVICE',true,70,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('role-accountant','ACCOUNTANT','Бухгалтер','FINANCE',true,80,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('role-administrator','ADMINISTRATOR','Адміністратор','ADMIN',true,90,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "KpiDefinition" ("id","code","name","description","unit","direction","dataSource","isActive","createdAt","updatedAt") VALUES
('kpi-mechanic-norm-hours','MECHANIC_NORM_HOURS','Виробіток нормо-годин',NULL,'NORM_HOURS','HIGHER_BETTER','WORK_ORDER',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-mechanic-utilization','MECHANIC_UTILIZATION','Завантаження механіка',NULL,'PERCENT','HIGHER_BETTER','PRODUCTION',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-mechanic-efficiency','MECHANIC_EFFICIENCY','Ефективність механіка',NULL,'PERCENT','HIGHER_BETTER','PRODUCTION',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-mechanic-labor-contribution','MECHANIC_LABOR_CONTRIBUTION','Прямий contribution по роботах',NULL,'UAH','HIGHER_BETTER','ATTRIBUTION',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-mechanic-qc-first-pass','MECHANIC_QC_FIRST_PASS','QC з першого разу',NULL,'PERCENT','HIGHER_BETTER','QUALITY_CONTROL',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-mechanic-comeback-rate','MECHANIC_COMEBACK_RATE','Повернення після ремонту',NULL,'PERCENT','LOWER_BETTER','WARRANTY',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-mechanic-on-time','MECHANIC_ON_TIME','Виконання робіт у строк',NULL,'PERCENT','HIGHER_BETTER','PRODUCTION',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-sales-lead-contact','SALES_LEAD_CONTACT','Lead → Contact',NULL,'PERCENT','HIGHER_BETTER','LEADS',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-sales-contact-booking','SALES_CONTACT_BOOKING','Contact → Booking',NULL,'PERCENT','HIGHER_BETTER','LEADS',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-sales-booking-arrival','SALES_BOOKING_ARRIVAL','Booking → Arrival',NULL,'PERCENT','HIGHER_BETTER','PLANNER',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-sales-estimate-approval','SALES_ESTIMATE_APPROVAL','Погодження кошторисів',NULL,'PERCENT','HIGHER_BETTER','ESTIMATE',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-sales-direct-contribution','SALES_DIRECT_CONTRIBUTION','Прямий contribution продажів',NULL,'UAH','HIGHER_BETTER','ATTRIBUTION',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-sales-first-contact-sla','SALES_FIRST_CONTACT_SLA','SLA першого контакту',NULL,'PERCENT','HIGHER_BETTER','LEADS',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-sales-lost-discipline','SALES_LOST_DISCIPLINE','Дисципліна LOST',NULL,'PERCENT','HIGHER_BETTER','LEADS',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-hos-managed-gp-plan','HOS_MANAGED_GP_PLAN','Managed GP відділу vs план',NULL,'PERCENT','HIGHER_BETTER','ANALYTICS',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-hos-lead-booking','HOS_LEAD_BOOKING','Lead → Booking команди',NULL,'PERCENT','HIGHER_BETTER','LEADS',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-hos-booking-arrival','HOS_BOOKING_ARRIVAL','Booking → Arrival команди',NULL,'PERCENT','HIGHER_BETTER','PLANNER',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-hos-estimate-approval','HOS_ESTIMATE_APPROVAL','Погодження кошторисів команди',NULL,'PERCENT','HIGHER_BETTER','ESTIMATE',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-hos-gp-per-fte','HOS_GP_PER_FTE','GP на одного продавця',NULL,'UAH','HIGHER_BETTER','FINANCE',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-hos-team-sla','HOS_TEAM_SLA','SLA команди продажів',NULL,'PERCENT','HIGHER_BETTER','LEADS',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-hos-forecast-accuracy','HOS_FORECAST_ACCURACY','Точність прогнозу продажів',NULL,'PERCENT','HIGHER_BETTER','ANALYTICS',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-hos-team-development','HOS_TEAM_DEVELOPMENT','Індекс розвитку команди',NULL,'PERCENT','HIGHER_BETTER','ANALYTICS',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-parts-request-sla','PARTS_REQUEST_SLA','SLA підбору запчастин',NULL,'PERCENT','HIGHER_BETTER','PARTS',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-parts-first-quote-time','PARTS_FIRST_QUOTE_TIME','Час до першої пропозиції',NULL,'MINUTES','LOWER_BETTER','PARTS',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-parts-fit-accuracy','PARTS_FIT_ACCURACY','Точність підбору',NULL,'PERCENT','HIGHER_BETTER','PARTS',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-parts-return-rate','PARTS_RETURN_RATE','Повернення через помилку підбору',NULL,'PERCENT','LOWER_BETTER','PARTS',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-parts-margin-quality','PARTS_MARGIN_QUALITY','Якість маржі запчастин',NULL,'PERCENT','HIGHER_BETTER','FINANCE',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-parts-procurement-saving','PARTS_PROCUREMENT_SAVING','Підтверджена економія закупівлі',NULL,'UAH','HIGHER_BETTER','ATTRIBUTION',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-parts-on-time-availability','PARTS_ON_TIME_AVAILABILITY','Запчастини вчасно',NULL,'PERCENT','HIGHER_BETTER','PARTS',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-station-post-utilization','STATION_POST_UTILIZATION','Завантаження постів',NULL,'PERCENT','HIGHER_BETTER','PRODUCTION',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-station-mechanic-utilization','STATION_MECHANIC_UTILIZATION','Завантаження механіків',NULL,'PERCENT','HIGHER_BETTER','PRODUCTION',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-station-revenue-per-post','STATION_REVENUE_PER_POST','Виручка на пост',NULL,'UAH','HIGHER_BETTER','FINANCE',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-station-gp-per-post','STATION_GP_PER_POST','GP на пост',NULL,'UAH','HIGHER_BETTER','FINANCE',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-station-cycle-time','STATION_CYCLE_TIME','Cycle time ремонту',NULL,'HOURS','LOWER_BETTER','WORK_ORDER',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-station-on-time','STATION_ON_TIME','Замовлення завершені в строк',NULL,'PERCENT','HIGHER_BETTER','PRODUCTION',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-station-qc-first-pass','STATION_QC_FIRST_PASS','QC з першого разу по станції',NULL,'PERCENT','HIGHER_BETTER','QUALITY_CONTROL',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-station-comeback-rate','STATION_COMEBACK_RATE','Повернення по станції',NULL,'PERCENT','LOWER_BETTER','WARRANTY',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-accounting-closing-timeliness','ACCOUNTING_CLOSING_TIMELINESS','Своєчасність закриття періоду',NULL,'PERCENT','HIGHER_BETTER','FINANCE',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-accounting-reconciliation-accuracy','ACCOUNTING_RECONCILIATION_ACCURACY','Точність звірок',NULL,'PERCENT','HIGHER_BETTER','FINANCE',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-accounting-cashflow-completeness','ACCOUNTING_CASHFLOW_COMPLETENESS','Повнота Cash Flow',NULL,'PERCENT','HIGHER_BETTER','FINANCE',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-accounting-ar-overdue-rate','ACCOUNTING_AR_OVERDUE_RATE','Прострочена дебіторка',NULL,'PERCENT','LOWER_BETTER','FINANCE',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-accounting-ap-overdue-rate','ACCOUNTING_AP_OVERDUE_RATE','Прострочена кредиторка',NULL,'PERCENT','LOWER_BETTER','FINANCE',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-accounting-error-rate','ACCOUNTING_ERROR_RATE','Рівень фінансових помилок',NULL,'PERCENT','LOWER_BETTER','FINANCE',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-accounting-forecast-accuracy','ACCOUNTING_FORECAST_ACCURACY','Точність Cash Flow forecast',NULL,'PERCENT','HIGHER_BETTER','FINANCE',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-accounting-compliance-incidents','ACCOUNTING_COMPLIANCE_INCIDENTS','Критичні фінансові порушення',NULL,'COUNT','LOWER_BETTER','FINANCE',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-exec-revenue-plan','EXEC_REVENUE_PLAN','Виконання плану Revenue',NULL,'PERCENT','HIGHER_BETTER','FINANCE',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-exec-gp-plan','EXEC_GP_PLAN','Виконання плану Gross Profit',NULL,'PERCENT','HIGHER_BETTER','FINANCE',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-exec-operating-profit-plan','EXEC_OPERATING_PROFIT_PLAN','Виконання плану Operating Profit',NULL,'PERCENT','HIGHER_BETTER','FINANCE',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-exec-gross-margin','EXEC_GROSS_MARGIN','Gross Margin',NULL,'PERCENT','HIGHER_BETTER','FINANCE',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-exec-operating-cash-plan','EXEC_OPERATING_CASH_PLAN','Виконання плану Operating Cash',NULL,'PERCENT','HIGHER_BETTER','FINANCE',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-exec-gp-per-fte','EXEC_GP_PER_FTE','GP на FTE',NULL,'UAH','HIGHER_BETTER','ANALYTICS',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-exec-capacity-utilization','EXEC_CAPACITY_UTILIZATION','Завантаження потужностей',NULL,'PERCENT','HIGHER_BETTER','ANALYTICS',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-exec-operational-quality','EXEC_OPERATIONAL_QUALITY','Операційна якість / SLA',NULL,'SCORE','HIGHER_BETTER','ANALYTICS',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-admin-data-completeness','ADMIN_DATA_COMPLETENESS','Повнота даних',NULL,'PERCENT','HIGHER_BETTER','CRM',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-admin-duplicate-error-rate','ADMIN_DUPLICATE_ERROR_RATE','Дублікати та помилки',NULL,'PERCENT','LOWER_BETTER','CRM',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-admin-task-sla','ADMIN_TASK_SLA','SLA адміністративних задач',NULL,'PERCENT','HIGHER_BETTER','CRM',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-admin-status-discipline','ADMIN_STATUS_DISCIPLINE','Дисципліна статусів',NULL,'PERCENT','HIGHER_BETTER','CRM',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-admin-workorder-document-completeness','ADMIN_WORKORDER_DOCUMENT_COMPLETENESS','Повнота документів WorkOrder',NULL,'PERCENT','HIGHER_BETTER','WORK_ORDER',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('kpi-admin-internal-response-sla','ADMIN_INTERNAL_RESPONSE_SLA','SLA внутрішньої відповіді',NULL,'PERCENT','HIGHER_BETTER','CRM',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RoleKpiRule" ("id","roleId","kpiDefinitionId","weight","defaultTarget","yellowThresholdPct","redThresholdPct","isCore","createdAt","updatedAt") VALUES
('rkr-mechanic-mechanic-norm-hours','role-mechanic','kpi-mechanic-norm-hours',20.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-mechanic-mechanic-utilization','role-mechanic','kpi-mechanic-utilization',15.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-mechanic-mechanic-efficiency','role-mechanic','kpi-mechanic-efficiency',15.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-mechanic-mechanic-labor-contribution','role-mechanic','kpi-mechanic-labor-contribution',20.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-mechanic-mechanic-qc-first-pass','role-mechanic','kpi-mechanic-qc-first-pass',10.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-mechanic-mechanic-comeback-rate','role-mechanic','kpi-mechanic-comeback-rate',10.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-mechanic-mechanic-on-time','role-mechanic','kpi-mechanic-on-time',10.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-sales-sales-lead-contact','role-sales','kpi-sales-lead-contact',10.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-sales-sales-contact-booking','role-sales','kpi-sales-contact-booking',20.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-sales-sales-booking-arrival','role-sales','kpi-sales-booking-arrival',15.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-sales-sales-estimate-approval','role-sales','kpi-sales-estimate-approval',15.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-sales-sales-direct-contribution','role-sales','kpi-sales-direct-contribution',25.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-sales-sales-first-contact-sla','role-sales','kpi-sales-first-contact-sla',10.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-sales-sales-lost-discipline','role-sales','kpi-sales-lost-discipline',5.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-head-of-sales-hos-managed-gp-plan','role-head-of-sales','kpi-hos-managed-gp-plan',25.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-head-of-sales-hos-lead-booking','role-head-of-sales','kpi-hos-lead-booking',15.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-head-of-sales-hos-booking-arrival','role-head-of-sales','kpi-hos-booking-arrival',10.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-head-of-sales-hos-estimate-approval','role-head-of-sales','kpi-hos-estimate-approval',10.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-head-of-sales-hos-gp-per-fte','role-head-of-sales','kpi-hos-gp-per-fte',15.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-head-of-sales-hos-team-sla','role-head-of-sales','kpi-hos-team-sla',10.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-head-of-sales-hos-forecast-accuracy','role-head-of-sales','kpi-hos-forecast-accuracy',10.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-head-of-sales-hos-team-development','role-head-of-sales','kpi-hos-team-development',5.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-parts-specialist-parts-request-sla','role-parts-specialist','kpi-parts-request-sla',15.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-parts-specialist-parts-first-quote-time','role-parts-specialist','kpi-parts-first-quote-time',10.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-parts-specialist-parts-fit-accuracy','role-parts-specialist','kpi-parts-fit-accuracy',20.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-parts-specialist-parts-return-rate','role-parts-specialist','kpi-parts-return-rate',15.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-parts-specialist-parts-margin-quality','role-parts-specialist','kpi-parts-margin-quality',15.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-parts-specialist-parts-procurement-saving','role-parts-specialist','kpi-parts-procurement-saving',10.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-parts-specialist-parts-on-time-availability','role-parts-specialist','kpi-parts-on-time-availability',15.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-station-manager-station-post-utilization','role-station-manager','kpi-station-post-utilization',15.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-station-manager-station-mechanic-utilization','role-station-manager','kpi-station-mechanic-utilization',10.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-station-manager-station-revenue-per-post','role-station-manager','kpi-station-revenue-per-post',15.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-station-manager-station-gp-per-post','role-station-manager','kpi-station-gp-per-post',20.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-station-manager-station-cycle-time','role-station-manager','kpi-station-cycle-time',10.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-station-manager-station-on-time','role-station-manager','kpi-station-on-time',10.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-station-manager-station-qc-first-pass','role-station-manager','kpi-station-qc-first-pass',10.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-station-manager-station-comeback-rate','role-station-manager','kpi-station-comeback-rate',10.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-accountant-accounting-closing-timeliness','role-accountant','kpi-accounting-closing-timeliness',15.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-accountant-accounting-reconciliation-accuracy','role-accountant','kpi-accounting-reconciliation-accuracy',15.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-accountant-accounting-cashflow-completeness','role-accountant','kpi-accounting-cashflow-completeness',15.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-accountant-accounting-ar-overdue-rate','role-accountant','kpi-accounting-ar-overdue-rate',15.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-accountant-accounting-ap-overdue-rate','role-accountant','kpi-accounting-ap-overdue-rate',10.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-accountant-accounting-error-rate','role-accountant','kpi-accounting-error-rate',10.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-accountant-accounting-forecast-accuracy','role-accountant','kpi-accounting-forecast-accuracy',10.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-accountant-accounting-compliance-incidents','role-accountant','kpi-accounting-compliance-incidents',10.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-executive-director-exec-revenue-plan','role-executive-director','kpi-exec-revenue-plan',10.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-executive-director-exec-gp-plan','role-executive-director','kpi-exec-gp-plan',20.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-executive-director-exec-operating-profit-plan','role-executive-director','kpi-exec-operating-profit-plan',20.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-executive-director-exec-gross-margin','role-executive-director','kpi-exec-gross-margin',10.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-executive-director-exec-operating-cash-plan','role-executive-director','kpi-exec-operating-cash-plan',10.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-executive-director-exec-gp-per-fte','role-executive-director','kpi-exec-gp-per-fte',10.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-executive-director-exec-capacity-utilization','role-executive-director','kpi-exec-capacity-utilization',10.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-executive-director-exec-operational-quality','role-executive-director','kpi-exec-operational-quality',10.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-administrator-admin-data-completeness','role-administrator','kpi-admin-data-completeness',25.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-administrator-admin-duplicate-error-rate','role-administrator','kpi-admin-duplicate-error-rate',20.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-administrator-admin-task-sla','role-administrator','kpi-admin-task-sla',15.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-administrator-admin-status-discipline','role-administrator','kpi-admin-status-discipline',15.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-administrator-admin-workorder-document-completeness','role-administrator','kpi-admin-workorder-document-completeness',15.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('rkr-administrator-admin-internal-response-sla','role-administrator','kpi-admin-internal-response-sla',10.00,NULL,NULL,NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("roleId","kpiDefinitionId") DO NOTHING;
