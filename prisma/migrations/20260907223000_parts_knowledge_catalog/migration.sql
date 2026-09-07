CREATE TABLE "GenericArticleAlias" (
    "id" TEXT NOT NULL,
    "genericArticleId" TEXT NOT NULL,
    "aliasRaw" VARCHAR(240) NOT NULL,
    "aliasNormalized" VARCHAR(240) NOT NULL,
    "aliasType" VARCHAR(40) NOT NULL,
    "language" VARCHAR(8) NOT NULL DEFAULT 'uk',
    "provider" VARCHAR(64) NOT NULL DEFAULT '',
    "axisHint" VARCHAR(16),
    "sideHint" VARCHAR(16),
    "subPositionHint" VARCHAR(16),
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "status" "CatalogEntityStatus" NOT NULL DEFAULT 'DRAFT',
    "source" VARCHAR(64) NOT NULL,
    "sourceVersion" VARCHAR(160),
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "approvedByUserId" VARCHAR(128),
    "approvedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "identityKey" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GenericArticleAlias_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GenericArticleRelation" (
    "id" TEXT NOT NULL,
    "fromGenericArticleId" TEXT NOT NULL,
    "toGenericArticleId" TEXT NOT NULL,
    "relationType" VARCHAR(48) NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "status" "CatalogEntityStatus" NOT NULL DEFAULT 'DRAFT',
    "source" VARCHAR(64) NOT NULL,
    "sourceVersion" VARCHAR(160),
    "notes" TEXT,
    "identityKey" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GenericArticleRelation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GenericArticleOperation" (
    "id" TEXT NOT NULL,
    "genericArticleId" TEXT NOT NULL,
    "operationCode" VARCHAR(80) NOT NULL,
    "operationName" VARCHAR(240) NOT NULL,
    "serviceCatalogItemId" TEXT,
    "positionRule" VARCHAR(120),
    "normMinutesOverride" INTEGER,
    "defaultQuantity" DECIMAL(10,3) NOT NULL DEFAULT 1,
    "status" "CatalogEntityStatus" NOT NULL DEFAULT 'DRAFT',
    "source" VARCHAR(64) NOT NULL,
    "sourceVersion" VARCHAR(160),
    "notes" TEXT,
    "identityKey" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GenericArticleOperation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GenericArticleMedia" (
    "id" TEXT NOT NULL,
    "genericArticleId" TEXT NOT NULL,
    "mediaType" VARCHAR(32) NOT NULL,
    "status" "CatalogEntityStatus" NOT NULL DEFAULT 'DRAFT',
    "source" VARCHAR(64) NOT NULL,
    "sourceUrl" TEXT,
    "storageKey" TEXT,
    "rights" TEXT,
    "provenance" JSONB,
    "contentHash" VARCHAR(128),
    "altText" VARCHAR(320),
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "identityKey" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GenericArticleMedia_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartTermObservation" (
    "id" TEXT NOT NULL,
    "rawTerm" VARCHAR(240) NOT NULL,
    "normalizedTerm" VARCHAR(240) NOT NULL,
    "diagnosticFindingId" VARCHAR(128),
    "suggestedGenericArticleId" VARCHAR(128),
    "resolvedGenericArticleId" VARCHAR(128),
    "status" VARCHAR(32) NOT NULL DEFAULT 'NEW',
    "source" VARCHAR(64) NOT NULL,
    "metadata" JSONB,
    "identityKey" VARCHAR(128) NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PartTermObservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "generic_article_alias_identity_key_uq" ON "GenericArticleAlias"("identityKey");
CREATE INDEX "generic_article_alias_lookup_idx" ON "GenericArticleAlias"("aliasNormalized", "status");
CREATE INDEX "generic_article_alias_article_idx" ON "GenericArticleAlias"("genericArticleId", "status");
CREATE INDEX "generic_article_alias_provider_idx" ON "GenericArticleAlias"("provider", "status");

CREATE UNIQUE INDEX "generic_article_relation_identity_key_uq" ON "GenericArticleRelation"("identityKey");
CREATE INDEX "generic_article_relation_from_idx" ON "GenericArticleRelation"("fromGenericArticleId", "relationType", "status");
CREATE INDEX "generic_article_relation_to_idx" ON "GenericArticleRelation"("toGenericArticleId", "relationType", "status");

CREATE UNIQUE INDEX "generic_article_operation_identity_key_uq" ON "GenericArticleOperation"("identityKey");
CREATE INDEX "generic_article_operation_article_idx" ON "GenericArticleOperation"("genericArticleId", "status");
CREATE INDEX "generic_article_operation_service_idx" ON "GenericArticleOperation"("serviceCatalogItemId");

CREATE UNIQUE INDEX "generic_article_media_identity_key_uq" ON "GenericArticleMedia"("identityKey");
CREATE INDEX "generic_article_media_article_idx" ON "GenericArticleMedia"("genericArticleId", "status", "sortOrder");
CREATE INDEX "generic_article_media_hash_idx" ON "GenericArticleMedia"("contentHash");

CREATE UNIQUE INDEX "part_term_observation_identity_key_uq" ON "PartTermObservation"("identityKey");
CREATE INDEX "part_term_observation_lookup_idx" ON "PartTermObservation"("normalizedTerm", "status");
CREATE INDEX "part_term_observation_queue_idx" ON "PartTermObservation"("status", "lastSeenAt");
CREATE INDEX "part_term_observation_suggested_idx" ON "PartTermObservation"("suggestedGenericArticleId");

ALTER TABLE "GenericArticleAlias"
  ADD CONSTRAINT "GenericArticleAlias_genericArticleId_fkey"
  FOREIGN KEY ("genericArticleId") REFERENCES "GenericArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GenericArticleRelation"
  ADD CONSTRAINT "GenericArticleRelation_fromGenericArticleId_fkey"
  FOREIGN KEY ("fromGenericArticleId") REFERENCES "GenericArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GenericArticleRelation"
  ADD CONSTRAINT "GenericArticleRelation_toGenericArticleId_fkey"
  FOREIGN KEY ("toGenericArticleId") REFERENCES "GenericArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GenericArticleOperation"
  ADD CONSTRAINT "GenericArticleOperation_genericArticleId_fkey"
  FOREIGN KEY ("genericArticleId") REFERENCES "GenericArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GenericArticleMedia"
  ADD CONSTRAINT "GenericArticleMedia_genericArticleId_fkey"
  FOREIGN KEY ("genericArticleId") REFERENCES "GenericArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
