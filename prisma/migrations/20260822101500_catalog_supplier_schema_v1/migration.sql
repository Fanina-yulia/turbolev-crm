-- CreateEnum
CREATE TYPE "CatalogEntityStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'MERGED', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "ProductIdentifierType" AS ENUM ('GTIN', 'EAN', 'BARCODE', 'INTERNAL_SKU', 'LEGACY_SKU', 'EXTERNAL_CATALOG_ID');

-- CreateEnum
CREATE TYPE "IdentifierVerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'REJECTED', 'CONFLICT');

-- CreateEnum
CREATE TYPE "CrossReferenceType" AS ENUM ('EQUIVALENT', 'REPLACEMENT', 'SUPERSEDES', 'SUPERSEDED_BY', 'KIT_CONTAINS', 'ALTERNATIVE');

-- CreateEnum
CREATE TYPE "AttributeDataType" AS ENUM ('TEXT', 'NUMBER', 'BOOLEAN', 'ENUM');

-- CreateEnum
CREATE TYPE "ProductMediaType" AS ENUM ('IMAGE', 'DRAWING', 'DOCUMENT', 'INSTRUCTION');

-- CreateEnum
CREATE TYPE "ProductMediaStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CatalogImportStatus" AS ENUM ('PENDING', 'RUNNING', 'VALIDATING', 'READY_TO_PUBLISH', 'PUBLISHED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CatalogImportRecordState" AS ENUM ('RECEIVED', 'NORMALIZED', 'MATCHED', 'NEW_CANDIDATE', 'CONFLICT', 'REJECTED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "SupplierImportMode" AS ENUM ('FULL_SNAPSHOT', 'INCREMENTAL', 'API_POLL', 'WEBHOOK_DELTA', 'MANUAL_FILE');

-- CreateEnum
CREATE TYPE "SupplierImportStatus" AS ENUM ('PENDING', 'RUNNING', 'VALIDATING', 'READY_TO_PUBLISH', 'PUBLISHED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupplierPublishStatus" AS ENUM ('NOT_READY', 'READY', 'PUBLISHING', 'PUBLISHED', 'BLOCKED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "SupplierImportRecordState" AS ENUM ('RECEIVED', 'NORMALIZED', 'MATCHED', 'AMBIGUOUS', 'UNMATCHED', 'CONFLICT', 'REJECTED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "SupplierMappingMethod" AS ENUM ('APPROVED_MAPPING', 'TRUSTED_EXTERNAL_ID', 'BRAND_MPN', 'VERIFIED_GTIN', 'ALIAS_SUPERSESSION', 'MANUAL');

-- CreateEnum
CREATE TYPE "SupplierReconciliationStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "SupplierReconciliationReason" AS ENUM ('UNMATCHED', 'AMBIGUOUS', 'IDENTITY_CONFLICT', 'INVALID_IDENTIFIER', 'BRAND_CONFLICT', 'PRICE_ANOMALY', 'STOCK_ANOMALY', 'SCHEMA_ERROR');

-- CreateEnum
CREATE TYPE "SupplierOfferStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'NOT_PRESENT', 'BLOCKED', 'ERROR');

-- CreateEnum
CREATE TYPE "SupplierFreshnessClass" AS ENUM ('FRESH', 'STALE_ALLOWED', 'EXPIRED', 'UNKNOWN_SOURCE_TIME', 'PROVIDER_ERROR_LAST_KNOWN');

-- CreateEnum
CREATE TYPE "SupplierAvailabilityState" AS ENUM ('AVAILABLE', 'LOW_STOCK', 'OUT_OF_STOCK', 'ORDERABLE', 'CHECK_REQUIRED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SupplierQuantityMode" AS ENUM ('EXACT', 'BAND', 'BOOLEAN_ONLY', 'UNKNOWN');

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "canonicalName" VARCHAR(120) NOT NULL,
    "normalizedName" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "status" "CatalogEntityStatus" NOT NULL DEFAULT 'DRAFT',
    "countryCode" VARCHAR(2),
    "websiteUrl" TEXT,
    "merchantName" VARCHAR(160),
    "mergedIntoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandAlias" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "aliasRaw" VARCHAR(160) NOT NULL,
    "aliasNormalized" VARCHAR(160) NOT NULL,
    "source" VARCHAR(64) NOT NULL,
    "confidence" INTEGER,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandExternalReference" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "externalType" VARCHAR(64) NOT NULL,
    "externalId" VARCHAR(180) NOT NULL,
    "sourceVersion" VARCHAR(160),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "BrandExternalReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenericArticle" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "slug" VARCHAR(200) NOT NULL,
    "status" "CatalogEntityStatus" NOT NULL DEFAULT 'DRAFT',
    "mergedIntoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenericArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenericArticleExternalReference" (
    "id" TEXT NOT NULL,
    "genericArticleId" TEXT NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "externalType" VARCHAR(64) NOT NULL,
    "externalId" VARCHAR(180) NOT NULL,
    "sourceVersion" VARCHAR(160),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "GenericArticleExternalReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "name" VARCHAR(180) NOT NULL,
    "slug" VARCHAR(220) NOT NULL,
    "status" "CatalogEntityStatus" NOT NULL DEFAULT 'DRAFT',
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryGenericArticle" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "genericArticleId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,

    CONSTRAINT "CategoryGenericArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductGroup" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "slug" VARCHAR(220) NOT NULL,
    "status" "CatalogEntityStatus" NOT NULL DEFAULT 'DRAFT',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "role" VARCHAR(64),
    "sortOrder" INTEGER NOT NULL DEFAULT 100,

    CONSTRAINT "ProductGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "genericArticleId" TEXT,
    "mpnRaw" VARCHAR(160) NOT NULL,
    "mpnNormalized" VARCHAR(160) NOT NULL,
    "mpnSearchNormalized" VARCHAR(160) NOT NULL,
    "title" VARCHAR(320) NOT NULL,
    "shortTitle" VARCHAR(180),
    "slug" VARCHAR(320),
    "description" TEXT,
    "status" "CatalogEntityStatus" NOT NULL DEFAULT 'DRAFT',
    "countryOfOrigin" VARCHAR(2),
    "weightGrams" INTEGER,
    "mergedIntoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductIdentifier" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" "ProductIdentifierType" NOT NULL,
    "valueRaw" VARCHAR(200) NOT NULL,
    "valueNormalized" VARCHAR(200) NOT NULL,
    "verificationStatus" "IdentifierVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "source" VARCHAR(64) NOT NULL,
    "sourceVersion" VARCHAR(160),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "ProductIdentifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductExternalReference" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "externalType" VARCHAR(64) NOT NULL,
    "externalId" VARCHAR(200) NOT NULL,
    "sourceVersion" VARCHAR(160),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "ProductExternalReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OEReference" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "oeBrand" VARCHAR(120) NOT NULL,
    "oeBrandNormalized" VARCHAR(120) NOT NULL,
    "oeNumberRaw" VARCHAR(160) NOT NULL,
    "oeNumberNormalized" VARCHAR(160) NOT NULL,
    "relationType" VARCHAR(40),
    "source" VARCHAR(64) NOT NULL,
    "sourceVersion" VARCHAR(160),
    "confidence" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OEReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCrossReference" (
    "id" TEXT NOT NULL,
    "fromProductId" TEXT NOT NULL,
    "toProductId" TEXT NOT NULL,
    "type" "CrossReferenceType" NOT NULL,
    "source" VARCHAR(64) NOT NULL,
    "sourceVersion" VARCHAR(160),
    "confidence" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductCrossReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductExternalCrossReference" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "externalBrandRaw" VARCHAR(160),
    "externalBrandNormalized" VARCHAR(160),
    "externalNumberRaw" VARCHAR(180) NOT NULL,
    "externalNumberNormalized" VARCHAR(180) NOT NULL,
    "relationType" VARCHAR(64),
    "source" VARCHAR(64) NOT NULL,
    "sourceVersion" VARCHAR(160),
    "confidence" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductExternalCrossReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAttributeDefinition" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "dataType" "AttributeDataType" NOT NULL,
    "canonicalUnit" VARCHAR(40),
    "isFacet" BOOLEAN NOT NULL DEFAULT false,
    "isFitmentCritical" BOOLEAN NOT NULL DEFAULT false,
    "status" "CatalogEntityStatus" NOT NULL DEFAULT 'DRAFT',
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductAttributeDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAttributeValue" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "attributeDefinitionId" TEXT NOT NULL,
    "valueText" TEXT,
    "valueNormalized" TEXT,
    "valueNumber" DECIMAL(16,4),
    "valueBoolean" BOOLEAN,
    "unit" VARCHAR(40),
    "source" VARCHAR(64) NOT NULL,
    "sourceVersion" VARCHAR(160),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductAttributeValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductMedia" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" "ProductMediaType" NOT NULL,
    "status" "ProductMediaStatus" NOT NULL DEFAULT 'PENDING',
    "source" VARCHAR(64) NOT NULL,
    "sourceUrl" TEXT,
    "storageKey" TEXT,
    "rights" TEXT,
    "provenance" JSONB,
    "contentHash" VARCHAR(128),
    "width" INTEGER,
    "height" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "altText" VARCHAR(320),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogImportBatch" (
    "id" TEXT NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "scope" VARCHAR(100) NOT NULL,
    "sourceVersion" VARCHAR(160),
    "mode" VARCHAR(40) NOT NULL,
    "adapterVersion" VARCHAR(80) NOT NULL,
    "schemaVersion" VARCHAR(80) NOT NULL,
    "checksum" VARCHAR(128),
    "status" "CatalogImportStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "recordsReceived" INTEGER NOT NULL DEFAULT 0,
    "recordsValid" INTEGER NOT NULL DEFAULT 0,
    "recordsPublished" INTEGER NOT NULL DEFAULT 0,
    "recordsConflict" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogImportRecord" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "providerRecordKey" VARCHAR(240) NOT NULL,
    "rawChecksum" VARCHAR(128) NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "normalizedPayload" JSONB,
    "state" "CatalogImportRecordState" NOT NULL DEFAULT 'RECEIVED',
    "matchedProductId" TEXT,
    "identityEvidence" JSONB,
    "errorCodes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogImportRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierImportBatch" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "integrationScope" VARCHAR(100) NOT NULL,
    "mode" "SupplierImportMode" NOT NULL,
    "status" "SupplierImportStatus" NOT NULL DEFAULT 'PENDING',
    "publishStatus" "SupplierPublishStatus" NOT NULL DEFAULT 'NOT_READY',
    "sourceVersion" VARCHAR(160),
    "cursorBefore" TEXT,
    "cursorAfter" TEXT,
    "sourceChecksum" VARCHAR(128),
    "adapterVersion" VARCHAR(80) NOT NULL,
    "schemaVersion" VARCHAR(80) NOT NULL,
    "providerStartedAt" TIMESTAMP(3),
    "providerFinishedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "validatedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "recordsReceived" INTEGER NOT NULL DEFAULT 0,
    "recordsValid" INTEGER NOT NULL DEFAULT 0,
    "recordsMatched" INTEGER NOT NULL DEFAULT 0,
    "recordsAmbiguous" INTEGER NOT NULL DEFAULT 0,
    "recordsUnmatched" INTEGER NOT NULL DEFAULT 0,
    "recordsConflict" INTEGER NOT NULL DEFAULT 0,
    "recordsRejected" INTEGER NOT NULL DEFAULT 0,
    "bytesReceived" BIGINT,
    "semanticFingerprint" VARCHAR(128) NOT NULL,
    "errorCode" VARCHAR(80),
    "errorSummary" TEXT,
    "anomalySummary" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierImportRecord" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "supplierRecordKey" VARCHAR(240) NOT NULL,
    "state" "SupplierImportRecordState" NOT NULL DEFAULT 'RECEIVED',
    "rawChecksum" VARCHAR(128) NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "normalizedPayload" JSONB,
    "externalProductId" VARCHAR(200),
    "supplierArticleRaw" VARCHAR(180),
    "supplierArticleNorm" VARCHAR(180),
    "brandRaw" VARCHAR(160),
    "brandNormalized" VARCHAR(160),
    "mpnCandidateRaw" VARCHAR(180),
    "mpnCandidateNorm" VARCHAR(180),
    "gtinCandidate" VARCHAR(32),
    "currency" VARCHAR(3),
    "purchasePrice" DECIMAL(16,4),
    "quantityMode" "SupplierQuantityMode" NOT NULL DEFAULT 'UNKNOWN',
    "exactQty" DECIMAL(16,3),
    "availabilityBand" VARCHAR(48),
    "supplierAvailabilityRaw" VARCHAR(120),
    "warehouseKey" VARCHAR(120),
    "minOrderQty" DECIMAL(16,3),
    "multiplicity" DECIMAL(16,3),
    "leadTimeMinHours" INTEGER,
    "leadTimeMaxHours" INTEGER,
    "etaFrom" TIMESTAMP(3),
    "etaTo" TIMESTAMP(3),
    "sourceUpdatedAt" TIMESTAMP(3),
    "sourceTimeTrusted" BOOLEAN NOT NULL DEFAULT false,
    "matchedProductId" TEXT,
    "mappingMethod" "SupplierMappingMethod",
    "matchConfidence" INTEGER,
    "identityEvidence" JSONB,
    "errorCodes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierImportRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierIdentityMapping" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "integrationScope" VARCHAR(100) NOT NULL,
    "supplierRecordKey" VARCHAR(240) NOT NULL,
    "productId" TEXT NOT NULL,
    "method" "SupplierMappingMethod" NOT NULL,
    "confidence" INTEGER,
    "evidence" JSONB,
    "sourceVersion" VARCHAR(160),
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "approvedById" VARCHAR(160),
    "approvedAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "disabledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierIdentityMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierReconciliationTask" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "batchId" TEXT,
    "importRecordId" TEXT NOT NULL,
    "status" "SupplierReconciliationStatus" NOT NULL DEFAULT 'OPEN',
    "reason" "SupplierReconciliationReason" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "conflictFields" JSONB,
    "evidence" JSONB,
    "resolutionType" VARCHAR(80),
    "resolvedProductId" TEXT,
    "resolvedById" VARCHAR(160),
    "resolvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierReconciliationTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierReconciliationCandidate" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "reasonCodes" JSONB,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierReconciliationCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierSyncCursor" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "integrationScope" VARCHAR(100) NOT NULL,
    "cursorValue" TEXT,
    "lastSourceVersion" VARCHAR(160),
    "lastSuccessfulBatchId" TEXT,
    "lastFullSnapshotAt" TIMESTAMP(3),
    "lastSuccessfulAt" TIMESTAMP(3),
    "lastPublishedAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorCode" VARCHAR(80),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierSyncCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierFreshnessPolicy" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "integrationScope" VARCHAR(100) NOT NULL,
    "offerClass" VARCHAR(80) NOT NULL DEFAULT 'DEFAULT',
    "freshTtlSeconds" INTEGER NOT NULL,
    "staleAllowedSeconds" INTEGER NOT NULL DEFAULT 0,
    "hardExpirySeconds" INTEGER NOT NULL,
    "checkoutRevalidate" BOOLEAN NOT NULL DEFAULT true,
    "staleDisplayAllowed" BOOLEAN NOT NULL DEFAULT false,
    "providerErrorFallback" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierFreshnessPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierOffer" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "integrationScope" VARCHAR(100) NOT NULL,
    "offerKey" VARCHAR(240) NOT NULL,
    "supplierArticle" VARCHAR(180),
    "externalProductId" VARCHAR(200),
    "warehouseKey" VARCHAR(120),
    "status" "SupplierOfferStatus" NOT NULL DEFAULT 'ACTIVE',
    "purchasePrice" DECIMAL(16,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "quantityMode" "SupplierQuantityMode" NOT NULL DEFAULT 'UNKNOWN',
    "exactQty" DECIMAL(16,3),
    "availabilityBand" VARCHAR(48),
    "availability" "SupplierAvailabilityState" NOT NULL DEFAULT 'UNKNOWN',
    "minOrderQty" DECIMAL(16,3),
    "multiplicity" DECIMAL(16,3),
    "leadTimeMinHours" INTEGER,
    "leadTimeMaxHours" INTEGER,
    "etaFrom" TIMESTAMP(3),
    "etaTo" TIMESTAMP(3),
    "freshnessClass" "SupplierFreshnessClass" NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3),
    "sourceTimeTrusted" BOOLEAN NOT NULL DEFAULT false,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "freshUntil" TIMESTAMP(3) NOT NULL,
    "staleAllowedUntil" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sourceVersion" VARCHAR(160),
    "importBatchId" TEXT,
    "mappingMethod" "SupplierMappingMethod" NOT NULL,
    "mappingConfidence" INTEGER,
    "lastSeenBatchId" TEXT,
    "notPresentSince" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Brand_normalizedName_key" ON "Brand"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_slug_key" ON "Brand"("slug");

-- CreateIndex
CREATE INDEX "Brand_status_canonicalName_idx" ON "Brand"("status", "canonicalName");

-- CreateIndex
CREATE INDEX "Brand_mergedIntoId_idx" ON "Brand"("mergedIntoId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandAlias_aliasNormalized_key" ON "BrandAlias"("aliasNormalized");

-- CreateIndex
CREATE INDEX "BrandAlias_brandId_isApproved_idx" ON "BrandAlias"("brandId", "isApproved");

-- CreateIndex
CREATE INDEX "BrandExternalReference_brandId_idx" ON "BrandExternalReference"("brandId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandExternalReference_provider_externalType_externalId_key" ON "BrandExternalReference"("provider", "externalType", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "GenericArticle_code_key" ON "GenericArticle"("code");

-- CreateIndex
CREATE UNIQUE INDEX "GenericArticle_slug_key" ON "GenericArticle"("slug");

-- CreateIndex
CREATE INDEX "GenericArticle_status_name_idx" ON "GenericArticle"("status", "name");

-- CreateIndex
CREATE INDEX "GenericArticle_mergedIntoId_idx" ON "GenericArticle"("mergedIntoId");

-- CreateIndex
CREATE INDEX "GenericArticleExternalReference_genericArticleId_idx" ON "GenericArticleExternalReference"("genericArticleId");

-- CreateIndex
CREATE UNIQUE INDEX "GenericArticleExternalReference_provider_externalType_exter_key" ON "GenericArticleExternalReference"("provider", "externalType", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE INDEX "Category_parentId_status_sortOrder_idx" ON "Category"("parentId", "status", "sortOrder");

-- CreateIndex
CREATE INDEX "CategoryGenericArticle_genericArticleId_sortOrder_idx" ON "CategoryGenericArticle"("genericArticleId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryGenericArticle_categoryId_genericArticleId_key" ON "CategoryGenericArticle"("categoryId", "genericArticleId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductGroup_slug_key" ON "ProductGroup"("slug");

-- CreateIndex
CREATE INDEX "ProductGroup_status_name_idx" ON "ProductGroup"("status", "name");

-- CreateIndex
CREATE INDEX "ProductGroupMember_productId_idx" ON "ProductGroupMember"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductGroupMember_groupId_productId_key" ON "ProductGroupMember"("groupId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");

-- CreateIndex
CREATE INDEX "Product_mpnSearchNormalized_idx" ON "Product"("mpnSearchNormalized");

-- CreateIndex
CREATE INDEX "Product_genericArticleId_status_idx" ON "Product"("genericArticleId", "status");

-- CreateIndex
CREATE INDEX "Product_brandId_status_idx" ON "Product"("brandId", "status");

-- CreateIndex
CREATE INDEX "Product_status_updatedAt_idx" ON "Product"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Product_mergedIntoId_idx" ON "Product"("mergedIntoId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_brandId_mpnNormalized_key" ON "Product"("brandId", "mpnNormalized");

-- CreateIndex
CREATE INDEX "ProductIdentifier_type_valueNormalized_verificationStatus_idx" ON "ProductIdentifier"("type", "valueNormalized", "verificationStatus");

-- CreateIndex
CREATE INDEX "ProductIdentifier_productId_isPrimary_idx" ON "ProductIdentifier"("productId", "isPrimary");

-- CreateIndex
CREATE UNIQUE INDEX "ProductIdentifier_productId_type_valueNormalized_source_key" ON "ProductIdentifier"("productId", "type", "valueNormalized", "source");

-- CreateIndex
CREATE INDEX "ProductExternalReference_productId_idx" ON "ProductExternalReference"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductExternalReference_provider_externalType_externalId_key" ON "ProductExternalReference"("provider", "externalType", "externalId");

-- CreateIndex
CREATE INDEX "OEReference_oeBrandNormalized_oeNumberNormalized_idx" ON "OEReference"("oeBrandNormalized", "oeNumberNormalized");

-- CreateIndex
CREATE INDEX "OEReference_oeNumberNormalized_idx" ON "OEReference"("oeNumberNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "OEReference_productId_oeBrandNormalized_oeNumberNormalized__key" ON "OEReference"("productId", "oeBrandNormalized", "oeNumberNormalized", "source");

-- CreateIndex
CREATE INDEX "ProductCrossReference_toProductId_type_idx" ON "ProductCrossReference"("toProductId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCrossReference_fromProductId_toProductId_type_source_key" ON "ProductCrossReference"("fromProductId", "toProductId", "type", "source");

-- CreateIndex
CREATE INDEX "ProductExternalCrossReference_externalBrandNormalized_exter_idx" ON "ProductExternalCrossReference"("externalBrandNormalized", "externalNumberNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "ProductExternalCrossReference_productId_externalBrandNormal_key" ON "ProductExternalCrossReference"("productId", "externalBrandNormalized", "externalNumberNormalized", "source");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAttributeDefinition_code_key" ON "ProductAttributeDefinition"("code");

-- CreateIndex
CREATE INDEX "ProductAttributeDefinition_status_isFacet_sortOrder_idx" ON "ProductAttributeDefinition"("status", "isFacet", "sortOrder");

-- CreateIndex
CREATE INDEX "ProductAttributeValue_attributeDefinitionId_valueNormalized_idx" ON "ProductAttributeValue"("attributeDefinitionId", "valueNormalized");

-- CreateIndex
CREATE INDEX "ProductAttributeValue_productId_idx" ON "ProductAttributeValue"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAttributeValue_productId_attributeDefinitionId_sourc_key" ON "ProductAttributeValue"("productId", "attributeDefinitionId", "source");

-- CreateIndex
CREATE INDEX "ProductMedia_productId_status_sortOrder_idx" ON "ProductMedia"("productId", "status", "sortOrder");

-- CreateIndex
CREATE INDEX "ProductMedia_contentHash_idx" ON "ProductMedia"("contentHash");

-- CreateIndex
CREATE INDEX "CatalogImportBatch_provider_scope_status_startedAt_idx" ON "CatalogImportBatch"("provider", "scope", "status", "startedAt");

-- CreateIndex
CREATE INDEX "CatalogImportBatch_sourceVersion_idx" ON "CatalogImportBatch"("sourceVersion");

-- CreateIndex
CREATE INDEX "CatalogImportRecord_batchId_state_idx" ON "CatalogImportRecord"("batchId", "state");

-- CreateIndex
CREATE INDEX "CatalogImportRecord_matchedProductId_state_idx" ON "CatalogImportRecord"("matchedProductId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogImportRecord_batchId_providerRecordKey_key" ON "CatalogImportRecord"("batchId", "providerRecordKey");

-- CreateIndex
CREATE INDEX "SupplierImportBatch_supplierId_integrationScope_status_star_idx" ON "SupplierImportBatch"("supplierId", "integrationScope", "status", "startedAt");

-- CreateIndex
CREATE INDEX "SupplierImportBatch_supplierId_integrationScope_publishStat_idx" ON "SupplierImportBatch"("supplierId", "integrationScope", "publishStatus", "startedAt");

-- CreateIndex
CREATE INDEX "SupplierImportBatch_sourceVersion_idx" ON "SupplierImportBatch"("sourceVersion");

-- CreateIndex
CREATE INDEX "SupplierImportBatch_finishedAt_idx" ON "SupplierImportBatch"("finishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierImportBatch_supplierId_integrationScope_semanticFin_key" ON "SupplierImportBatch"("supplierId", "integrationScope", "semanticFingerprint");

-- CreateIndex
CREATE INDEX "SupplierImportRecord_batchId_state_idx" ON "SupplierImportRecord"("batchId", "state");

-- CreateIndex
CREATE INDEX "SupplierImportRecord_matchedProductId_state_idx" ON "SupplierImportRecord"("matchedProductId", "state");

-- CreateIndex
CREATE INDEX "SupplierImportRecord_brandNormalized_mpnCandidateNorm_idx" ON "SupplierImportRecord"("brandNormalized", "mpnCandidateNorm");

-- CreateIndex
CREATE INDEX "SupplierImportRecord_gtinCandidate_idx" ON "SupplierImportRecord"("gtinCandidate");

-- CreateIndex
CREATE INDEX "SupplierImportRecord_externalProductId_idx" ON "SupplierImportRecord"("externalProductId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierImportRecord_batchId_supplierRecordKey_key" ON "SupplierImportRecord"("batchId", "supplierRecordKey");

-- CreateIndex
CREATE INDEX "SupplierIdentityMapping_productId_isActive_idx" ON "SupplierIdentityMapping"("productId", "isActive");

-- CreateIndex
CREATE INDEX "SupplierIdentityMapping_supplierId_isActive_idx" ON "SupplierIdentityMapping"("supplierId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierIdentityMapping_supplierId_integrationScope_supplie_key" ON "SupplierIdentityMapping"("supplierId", "integrationScope", "supplierRecordKey");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierReconciliationTask_importRecordId_key" ON "SupplierReconciliationTask"("importRecordId");

-- CreateIndex
CREATE INDEX "SupplierReconciliationTask_status_priority_createdAt_idx" ON "SupplierReconciliationTask"("status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "SupplierReconciliationTask_supplierId_status_createdAt_idx" ON "SupplierReconciliationTask"("supplierId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SupplierReconciliationTask_batchId_idx" ON "SupplierReconciliationTask"("batchId");

-- CreateIndex
CREATE INDEX "SupplierReconciliationCandidate_taskId_rank_idx" ON "SupplierReconciliationCandidate"("taskId", "rank");

-- CreateIndex
CREATE INDEX "SupplierReconciliationCandidate_productId_idx" ON "SupplierReconciliationCandidate"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierReconciliationCandidate_taskId_productId_key" ON "SupplierReconciliationCandidate"("taskId", "productId");

-- CreateIndex
CREATE INDEX "SupplierSyncCursor_lastSuccessfulAt_idx" ON "SupplierSyncCursor"("lastSuccessfulAt");

-- CreateIndex
CREATE INDEX "SupplierSyncCursor_lastErrorAt_idx" ON "SupplierSyncCursor"("lastErrorAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierSyncCursor_supplierId_integrationScope_key" ON "SupplierSyncCursor"("supplierId", "integrationScope");

-- CreateIndex
CREATE INDEX "SupplierFreshnessPolicy_isActive_priority_idx" ON "SupplierFreshnessPolicy"("isActive", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierFreshnessPolicy_supplierId_integrationScope_offerCl_key" ON "SupplierFreshnessPolicy"("supplierId", "integrationScope", "offerClass");

-- CreateIndex
CREATE INDEX "SupplierOffer_productId_status_freshnessClass_purchasePrice_idx" ON "SupplierOffer"("productId", "status", "freshnessClass", "purchasePrice");

-- CreateIndex
CREATE INDEX "SupplierOffer_supplierId_status_expiresAt_idx" ON "SupplierOffer"("supplierId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "SupplierOffer_freshnessClass_expiresAt_idx" ON "SupplierOffer"("freshnessClass", "expiresAt");

-- CreateIndex
CREATE INDEX "SupplierOffer_externalProductId_idx" ON "SupplierOffer"("externalProductId");

-- CreateIndex
CREATE INDEX "SupplierOffer_supplierArticle_idx" ON "SupplierOffer"("supplierArticle");

-- CreateIndex
CREATE INDEX "SupplierOffer_lastSeenBatchId_idx" ON "SupplierOffer"("lastSeenBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierOffer_supplierId_integrationScope_offerKey_key" ON "SupplierOffer"("supplierId", "integrationScope", "offerKey");

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandAlias" ADD CONSTRAINT "BrandAlias_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandExternalReference" ADD CONSTRAINT "BrandExternalReference_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenericArticle" ADD CONSTRAINT "GenericArticle_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "GenericArticle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenericArticleExternalReference" ADD CONSTRAINT "GenericArticleExternalReference_genericArticleId_fkey" FOREIGN KEY ("genericArticleId") REFERENCES "GenericArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryGenericArticle" ADD CONSTRAINT "CategoryGenericArticle_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryGenericArticle" ADD CONSTRAINT "CategoryGenericArticle_genericArticleId_fkey" FOREIGN KEY ("genericArticleId") REFERENCES "GenericArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductGroupMember" ADD CONSTRAINT "ProductGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProductGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductGroupMember" ADD CONSTRAINT "ProductGroupMember_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_genericArticleId_fkey" FOREIGN KEY ("genericArticleId") REFERENCES "GenericArticle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductIdentifier" ADD CONSTRAINT "ProductIdentifier_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductExternalReference" ADD CONSTRAINT "ProductExternalReference_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OEReference" ADD CONSTRAINT "OEReference_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCrossReference" ADD CONSTRAINT "ProductCrossReference_fromProductId_fkey" FOREIGN KEY ("fromProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCrossReference" ADD CONSTRAINT "ProductCrossReference_toProductId_fkey" FOREIGN KEY ("toProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductExternalCrossReference" ADD CONSTRAINT "ProductExternalCrossReference_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAttributeValue" ADD CONSTRAINT "ProductAttributeValue_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAttributeValue" ADD CONSTRAINT "ProductAttributeValue_attributeDefinitionId_fkey" FOREIGN KEY ("attributeDefinitionId") REFERENCES "ProductAttributeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMedia" ADD CONSTRAINT "ProductMedia_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogImportRecord" ADD CONSTRAINT "CatalogImportRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CatalogImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogImportRecord" ADD CONSTRAINT "CatalogImportRecord_matchedProductId_fkey" FOREIGN KEY ("matchedProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierImportBatch" ADD CONSTRAINT "SupplierImportBatch_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierImportRecord" ADD CONSTRAINT "SupplierImportRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SupplierImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierImportRecord" ADD CONSTRAINT "SupplierImportRecord_matchedProductId_fkey" FOREIGN KEY ("matchedProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierIdentityMapping" ADD CONSTRAINT "SupplierIdentityMapping_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierIdentityMapping" ADD CONSTRAINT "SupplierIdentityMapping_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierReconciliationTask" ADD CONSTRAINT "SupplierReconciliationTask_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierReconciliationTask" ADD CONSTRAINT "SupplierReconciliationTask_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SupplierImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierReconciliationTask" ADD CONSTRAINT "SupplierReconciliationTask_importRecordId_fkey" FOREIGN KEY ("importRecordId") REFERENCES "SupplierImportRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierReconciliationTask" ADD CONSTRAINT "SupplierReconciliationTask_resolvedProductId_fkey" FOREIGN KEY ("resolvedProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierReconciliationCandidate" ADD CONSTRAINT "SupplierReconciliationCandidate_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "SupplierReconciliationTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierReconciliationCandidate" ADD CONSTRAINT "SupplierReconciliationCandidate_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierSyncCursor" ADD CONSTRAINT "SupplierSyncCursor_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierFreshnessPolicy" ADD CONSTRAINT "SupplierFreshnessPolicy_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOffer" ADD CONSTRAINT "SupplierOffer_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOffer" ADD CONSTRAINT "SupplierOffer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOffer" ADD CONSTRAINT "SupplierOffer_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "SupplierImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

