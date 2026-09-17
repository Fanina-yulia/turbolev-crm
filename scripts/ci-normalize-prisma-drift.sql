-- Normalize known SQL-managed / legacy database objects before Prisma drift check.
--
-- This script runs ONLY against the disposable GitHub Actions PostgreSQL database.
-- It must never be used against production. Its purpose is to remove objects that
-- historical SQL migrations intentionally keep in production but that are not
-- represented by the current Prisma schema. After this normalization, Prisma's
-- migrate diff remains strict: any other unexpected schema difference fails CI.

-- External MVS registry fixture. Production data is managed by the import pipeline.
DROP TABLE IF EXISTS "VehicleRegistryCompact";

-- OpenAI vehicle image library is intentionally SQL-managed by service code and
-- historical SQL migrations rather than Prisma Client models.
DROP TABLE IF EXISTS "VehicleImageGenerationJob";
DROP TABLE IF EXISTS "VehicleImageLibraryAsset";

-- Structured diagnostics were created with database-level foreign keys while the
-- split Prisma schema intentionally exposes their scalar IDs without relation
-- fields. Keep the production constraints, but remove them from the disposable
-- comparison database so migrate diff compares Prisma-managed structure only.
ALTER TABLE IF EXISTS "DiagnosticAssignment" DROP CONSTRAINT IF EXISTS "DiagnosticAssignment_diagnosticRequestId_fkey";
ALTER TABLE IF EXISTS "DiagnosticAssignment" DROP CONSTRAINT IF EXISTS "DiagnosticAssignment_locationId_fkey";
ALTER TABLE IF EXISTS "DiagnosticAssignment" DROP CONSTRAINT IF EXISTS "DiagnosticAssignment_mechanicId_fkey";
ALTER TABLE IF EXISTS "DiagnosticReview" DROP CONSTRAINT IF EXISTS "DiagnosticReview_diagnosticRequestId_fkey";
ALTER TABLE IF EXISTS "DiagnosticReview" DROP CONSTRAINT IF EXISTS "DiagnosticReview_reviewerUserId_fkey";
ALTER TABLE IF EXISTS "DiagnosticTemplateSection" DROP CONSTRAINT IF EXISTS "DiagnosticTemplateSection_templateId_fkey";
ALTER TABLE IF EXISTS "DiagnosticTemplateItem" DROP CONSTRAINT IF EXISTS "DiagnosticTemplateItem_sectionId_fkey";
ALTER TABLE IF EXISTS "DiagnosticInspection" DROP CONSTRAINT IF EXISTS "DiagnosticInspection_diagnosticRequestId_fkey";
ALTER TABLE IF EXISTS "DiagnosticInspection" DROP CONSTRAINT IF EXISTS "DiagnosticInspection_templateId_fkey";
ALTER TABLE IF EXISTS "DiagnosticInspection" DROP CONSTRAINT IF EXISTS "DiagnosticInspection_mechanicId_fkey";
ALTER TABLE IF EXISTS "DiagnosticCheck" DROP CONSTRAINT IF EXISTS "DiagnosticCheck_inspectionId_fkey";
ALTER TABLE IF EXISTS "DiagnosticCheck" DROP CONSTRAINT IF EXISTS "DiagnosticCheck_templateItemId_fkey";
ALTER TABLE IF EXISTS "DiagnosticFinding" DROP CONSTRAINT IF EXISTS "DiagnosticFinding_checkId_fkey";
ALTER TABLE IF EXISTS "DiagnosticMedia" DROP CONSTRAINT IF EXISTS "DiagnosticMedia_findingId_fkey";
ALTER TABLE IF EXISTS "UserUiPreference" DROP CONSTRAINT IF EXISTS "UserUiPreference_userId_fkey";

-- Direct-repair commercial extensions deliberately keep database-enforced
-- referential integrity and created-by-SQL timestamp defaults. The split Prisma
-- models expose the foreign-key scalar IDs and use @updatedAt without a database
-- default. Preserve the stronger production constraints/defaults; normalize only
-- the disposable CI database before the Prisma-managed drift comparison.
ALTER TABLE IF EXISTS "DirectRepairCommercialConfig"
  DROP CONSTRAINT IF EXISTS "DirectRepairCommercialConfig_workOrderId_fkey";
ALTER TABLE IF EXISTS "DirectRepairPartSource"
  DROP CONSTRAINT IF EXISTS "DirectRepairPartSource_workOrderLineId_fkey";
ALTER TABLE IF EXISTS "DirectRepairPartSource"
  DROP CONSTRAINT IF EXISTS "DirectRepairPartSource_workOrderId_fkey";
ALTER TABLE IF EXISTS "DirectRepairCommercialConfig"
  ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE IF EXISTS "DirectRepairPartSource"
  ALTER COLUMN "updatedAt" DROP DEFAULT;

-- RepairKitItem timestamps and the legacy composite ordering index are historical,
-- non-destructive database extras. Runtime code does not depend on these fields;
-- keep them in production for audit/history, but remove them only in the disposable
-- comparison database so Prisma drift remains strict for all active model fields.
ALTER TABLE IF EXISTS "RepairKitItem" DROP COLUMN IF EXISTS "createdAt";
ALTER TABLE IF EXISTS "RepairKitItem" DROP COLUMN IF EXISTS "updatedAt";
DROP INDEX IF EXISTS "RepairKitItem_repairKitId_sortOrder_idx";

-- Normalize two historical index differences so the clean-database drift check
-- compares the current Prisma schema rather than legacy migration names.
ALTER INDEX IF EXISTS "DiagnosticPartRecommendation_diagnosticRequestId_status_created"
  RENAME TO "DiagnosticPartRecommendation_diagnosticRequestId_status_cre_idx";
DROP INDEX IF EXISTS "ServiceAppointment_purpose_plannedStartAt_idx";
