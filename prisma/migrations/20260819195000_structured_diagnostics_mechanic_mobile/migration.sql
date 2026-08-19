CREATE TYPE "DiagnosticReviewState" AS ENUM ('DRAFT', 'SUBMITTED', 'RETURNED', 'CONFIRMED');
CREATE TYPE "DiagnosticInspectionStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');
CREATE TYPE "DiagnosticCheckState" AS ENUM ('NOT_CHECKED', 'OK', 'ATTENTION', 'DEFECT');
CREATE TYPE "DiagnosticFindingAction" AS ENUM ('NONE', 'REPLACE', 'REPAIR', 'ADJUST', 'CLEAN', 'ADDITIONAL_DIAGNOSTICS');
CREATE TYPE "DiagnosticUrgency" AS ENUM ('INFO', 'SOON', 'CRITICAL');
CREATE TYPE "MechanicTextScale" AS ENUM ('S', 'M', 'L', 'XL');
CREATE TYPE "MechanicControlScale" AS ENUM ('COMPACT', 'STANDARD', 'LARGE');
CREATE TYPE "MechanicTextMode" AS ENUM ('STANDARD', 'HIGH_CONTRAST', 'DARK');
CREATE TYPE "MechanicInterfaceContrast" AS ENUM ('NORMAL', 'HIGH');
CREATE TYPE "MechanicSpacing" AS ENUM ('NORMAL', 'SPACIOUS');

CREATE TABLE "DiagnosticAssignment" (
  "id" TEXT NOT NULL,
  "diagnosticRequestId" TEXT NOT NULL,
  "locationId" TEXT,
  "mechanicId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiagnosticAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiagnosticReview" (
  "id" TEXT NOT NULL,
  "diagnosticRequestId" TEXT NOT NULL,
  "state" "DiagnosticReviewState" NOT NULL DEFAULT 'DRAFT',
  "submittedAt" TIMESTAMP(3),
  "returnedAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "reviewerUserId" TEXT,
  "mechanicComment" TEXT,
  "managerComment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiagnosticReview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiagnosticTemplate" (
  "id" TEXT NOT NULL,
  "code" VARCHAR(80) NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 100,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiagnosticTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiagnosticTemplateSection" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "code" VARCHAR(96) NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 100,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiagnosticTemplateSection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiagnosticTemplateItem" (
  "id" TEXT NOT NULL,
  "sectionId" TEXT NOT NULL,
  "code" VARCHAR(128) NOT NULL,
  "name" TEXT NOT NULL,
  "position" VARCHAR(80),
  "measurementUnit" VARCHAR(40),
  "suggestedWorkName" TEXT,
  "suggestedPartName" TEXT,
  "isRequired" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 100,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiagnosticTemplateItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiagnosticInspection" (
  "id" TEXT NOT NULL,
  "diagnosticRequestId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "mechanicId" TEXT,
  "status" "DiagnosticInspectionStatus" NOT NULL DEFAULT 'PENDING',
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiagnosticInspection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiagnosticCheck" (
  "id" TEXT NOT NULL,
  "inspectionId" TEXT NOT NULL,
  "templateItemId" TEXT NOT NULL,
  "state" "DiagnosticCheckState" NOT NULL DEFAULT 'NOT_CHECKED',
  "measurementValue" DECIMAL(14,3),
  "measurementText" VARCHAR(160),
  "note" TEXT,
  "checkedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiagnosticCheck_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiagnosticFinding" (
  "id" TEXT NOT NULL,
  "checkId" TEXT NOT NULL,
  "action" "DiagnosticFindingAction" NOT NULL DEFAULT 'NONE',
  "urgency" "DiagnosticUrgency" NOT NULL DEFAULT 'INFO',
  "findingText" TEXT,
  "suggestedWorkName" TEXT,
  "suggestedPartName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiagnosticFinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiagnosticMedia" (
  "id" TEXT NOT NULL,
  "findingId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" VARCHAR(160) NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "fileData" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiagnosticMedia_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserUiPreference" (
  "userId" TEXT NOT NULL,
  "textScale" "MechanicTextScale" NOT NULL DEFAULT 'M',
  "controlScale" "MechanicControlScale" NOT NULL DEFAULT 'STANDARD',
  "textMode" "MechanicTextMode" NOT NULL DEFAULT 'STANDARD',
  "interfaceContrast" "MechanicInterfaceContrast" NOT NULL DEFAULT 'NORMAL',
  "spacing" "MechanicSpacing" NOT NULL DEFAULT 'NORMAL',
  "largeTouchTargets" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserUiPreference_pkey" PRIMARY KEY ("userId")
);

CREATE UNIQUE INDEX "DiagnosticAssignment_diagnosticRequestId_key" ON "DiagnosticAssignment"("diagnosticRequestId");
CREATE INDEX "DiagnosticAssignment_locationId_updatedAt_idx" ON "DiagnosticAssignment"("locationId", "updatedAt");
CREATE INDEX "DiagnosticAssignment_mechanicId_updatedAt_idx" ON "DiagnosticAssignment"("mechanicId", "updatedAt");
CREATE UNIQUE INDEX "DiagnosticReview_diagnosticRequestId_key" ON "DiagnosticReview"("diagnosticRequestId");
CREATE INDEX "DiagnosticReview_state_updatedAt_idx" ON "DiagnosticReview"("state", "updatedAt");
CREATE INDEX "DiagnosticReview_reviewerUserId_idx" ON "DiagnosticReview"("reviewerUserId");
CREATE UNIQUE INDEX "DiagnosticTemplate_code_key" ON "DiagnosticTemplate"("code");
CREATE INDEX "DiagnosticTemplate_isActive_sortOrder_idx" ON "DiagnosticTemplate"("isActive", "sortOrder");
CREATE UNIQUE INDEX "DiagnosticTemplateSection_templateId_code_key" ON "DiagnosticTemplateSection"("templateId", "code");
CREATE INDEX "DiagnosticTemplateSection_templateId_sortOrder_idx" ON "DiagnosticTemplateSection"("templateId", "sortOrder");
CREATE UNIQUE INDEX "DiagnosticTemplateItem_sectionId_code_key" ON "DiagnosticTemplateItem"("sectionId", "code");
CREATE INDEX "DiagnosticTemplateItem_sectionId_sortOrder_idx" ON "DiagnosticTemplateItem"("sectionId", "sortOrder");
CREATE UNIQUE INDEX "DiagnosticInspection_diagnosticRequestId_templateId_key" ON "DiagnosticInspection"("diagnosticRequestId", "templateId");
CREATE INDEX "DiagnosticInspection_diagnosticRequestId_status_idx" ON "DiagnosticInspection"("diagnosticRequestId", "status");
CREATE INDEX "DiagnosticInspection_mechanicId_status_idx" ON "DiagnosticInspection"("mechanicId", "status");
CREATE UNIQUE INDEX "DiagnosticCheck_inspectionId_templateItemId_key" ON "DiagnosticCheck"("inspectionId", "templateItemId");
CREATE INDEX "DiagnosticCheck_inspectionId_state_idx" ON "DiagnosticCheck"("inspectionId", "state");
CREATE UNIQUE INDEX "DiagnosticFinding_checkId_key" ON "DiagnosticFinding"("checkId");
CREATE INDEX "DiagnosticFinding_urgency_updatedAt_idx" ON "DiagnosticFinding"("urgency", "updatedAt");
CREATE INDEX "DiagnosticMedia_findingId_createdAt_idx" ON "DiagnosticMedia"("findingId", "createdAt");

ALTER TABLE "DiagnosticAssignment" ADD CONSTRAINT "DiagnosticAssignment_diagnosticRequestId_fkey" FOREIGN KEY ("diagnosticRequestId") REFERENCES "DiagnosticRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiagnosticAssignment" ADD CONSTRAINT "DiagnosticAssignment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ServiceLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DiagnosticAssignment" ADD CONSTRAINT "DiagnosticAssignment_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "ServiceMechanic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DiagnosticReview" ADD CONSTRAINT "DiagnosticReview_diagnosticRequestId_fkey" FOREIGN KEY ("diagnosticRequestId") REFERENCES "DiagnosticRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiagnosticReview" ADD CONSTRAINT "DiagnosticReview_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DiagnosticTemplateSection" ADD CONSTRAINT "DiagnosticTemplateSection_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DiagnosticTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiagnosticTemplateItem" ADD CONSTRAINT "DiagnosticTemplateItem_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "DiagnosticTemplateSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiagnosticInspection" ADD CONSTRAINT "DiagnosticInspection_diagnosticRequestId_fkey" FOREIGN KEY ("diagnosticRequestId") REFERENCES "DiagnosticRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiagnosticInspection" ADD CONSTRAINT "DiagnosticInspection_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DiagnosticTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiagnosticInspection" ADD CONSTRAINT "DiagnosticInspection_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "ServiceMechanic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DiagnosticCheck" ADD CONSTRAINT "DiagnosticCheck_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "DiagnosticInspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiagnosticCheck" ADD CONSTRAINT "DiagnosticCheck_templateItemId_fkey" FOREIGN KEY ("templateItemId") REFERENCES "DiagnosticTemplateItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DiagnosticFinding" ADD CONSTRAINT "DiagnosticFinding_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "DiagnosticCheck"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiagnosticMedia" ADD CONSTRAINT "DiagnosticMedia_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "DiagnosticFinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserUiPreference" ADD CONSTRAINT "UserUiPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
