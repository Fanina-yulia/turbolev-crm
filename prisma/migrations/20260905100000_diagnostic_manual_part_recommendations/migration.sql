CREATE TABLE "DiagnosticPartRecommendation" (
  "id" TEXT NOT NULL,
  "diagnosticRequestId" TEXT NOT NULL,
  "findingId" TEXT,
  "name" VARCHAR(500) NOT NULL,
  "article" VARCHAR(120),
  "brand" VARCHAR(120),
  "position" VARCHAR(120),
  "quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
  "note" TEXT,
  "source" VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
  "status" VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  "dedupeKey" VARCHAR(64) NOT NULL,
  "createdByUserId" TEXT,
  "createdByName" VARCHAR(160),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiagnosticPartRecommendation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DiagnosticPartRecommendation_diagnosticRequestId_dedupeKey_key"
  ON "DiagnosticPartRecommendation"("diagnosticRequestId", "dedupeKey");
CREATE INDEX "DiagnosticPartRecommendation_diagnosticRequestId_status_createdAt_idx"
  ON "DiagnosticPartRecommendation"("diagnosticRequestId", "status", "createdAt");
CREATE INDEX "DiagnosticPartRecommendation_findingId_idx"
  ON "DiagnosticPartRecommendation"("findingId");

ALTER TABLE "DiagnosticPartRecommendation"
  ADD CONSTRAINT "DiagnosticPartRecommendation_diagnosticRequestId_fkey"
  FOREIGN KEY ("diagnosticRequestId") REFERENCES "DiagnosticRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiagnosticPartRecommendation"
  ADD CONSTRAINT "DiagnosticPartRecommendation_findingId_fkey"
  FOREIGN KEY ("findingId") REFERENCES "DiagnosticFinding"("id") ON DELETE SET NULL ON UPDATE CASCADE;
