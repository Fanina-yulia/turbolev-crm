-- Local synonym catalog for diagnostic part names.
-- It intentionally does not alter DiagnosticFinding display text.
CREATE TABLE "GenericArticleAlias" (
    "id" TEXT NOT NULL,
    "genericArticleId" TEXT NOT NULL,
    "aliasRaw" VARCHAR(240) NOT NULL,
    "aliasNormalized" VARCHAR(240) NOT NULL,
    "source" VARCHAR(64) NOT NULL,
    "confidence" INTEGER,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "createdByName" VARCHAR(160),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenericArticleAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GenericArticleAlias_genericArticleId_aliasNormalized_key"
    ON "GenericArticleAlias"("genericArticleId", "aliasNormalized");
CREATE INDEX "GenericArticleAlias_aliasNormalized_isApproved_idx"
    ON "GenericArticleAlias"("aliasNormalized", "isApproved");
CREATE INDEX "GenericArticleAlias_genericArticleId_isApproved_idx"
    ON "GenericArticleAlias"("genericArticleId", "isApproved");

ALTER TABLE "GenericArticleAlias"
    ADD CONSTRAINT "GenericArticleAlias_genericArticleId_fkey"
    FOREIGN KEY ("genericArticleId") REFERENCES "GenericArticle"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
