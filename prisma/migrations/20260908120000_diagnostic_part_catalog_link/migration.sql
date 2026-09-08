ALTER TABLE "DiagnosticPartRecommendation"
  ADD COLUMN "genericArticleId" TEXT;

ALTER TABLE "DiagnosticPartRecommendation"
  ADD COLUMN "catalogCode" VARCHAR(80);

CREATE INDEX "DiagnosticPartRecommendation_genericArticleId_idx"
  ON "DiagnosticPartRecommendation"("genericArticleId");

ALTER TABLE "DiagnosticPartRecommendation"
  ADD CONSTRAINT "DiagnosticPartRecommendation_genericArticleId_fkey"
  FOREIGN KEY ("genericArticleId") REFERENCES "GenericArticle"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
