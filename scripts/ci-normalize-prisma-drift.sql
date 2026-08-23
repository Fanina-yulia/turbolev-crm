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

-- Vehicle fitment Phase B follows the same split-schema pattern: Prisma exposes
-- scalar canonical IDs while PostgreSQL enforces cross-file referential integrity.
-- Remove only those SQL-managed FKs in disposable CI before Prisma drift diff.
ALTER TABLE IF EXISTS "VehicleCatalogLink" DROP CONSTRAINT IF EXISTS "vehicle_catalog_link_vehicle_fk";
ALTER TABLE IF EXISTS "VehicleCatalogLink" DROP CONSTRAINT IF EXISTS "vehicle_catalog_link_reference_fk";
ALTER TABLE IF EXISTS "VehicleFitment" DROP CONSTRAINT IF EXISTS "vehicle_fitment_product_fk";
ALTER TABLE IF EXISTS "VehicleFitment" DROP CONSTRAINT IF EXISTS "vehicle_fitment_reference_fk";
ALTER TABLE IF EXISTS "VehicleFitment" DROP CONSTRAINT IF EXISTS "vehicle_fitment_generic_article_fk";
ALTER TABLE IF EXISTS "VehicleFitmentCriterion" DROP CONSTRAINT IF EXISTS "vehicle_fitment_criterion_fitment_fk";
