CREATE TABLE "DiagnosticReportShare" (
  "id" TEXT NOT NULL,
  "diagnosticRequestId" TEXT NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL,
  "snapshot" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "requestedPricingAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiagnosticReportShare_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DiagnosticReportShare_tokenHash_key" ON "DiagnosticReportShare"("tokenHash");
CREATE INDEX "DiagnosticReportShare_diagnosticRequestId_createdAt_idx" ON "DiagnosticReportShare"("diagnosticRequestId", "createdAt");
CREATE INDEX "DiagnosticReportShare_revokedAt_expiresAt_idx" ON "DiagnosticReportShare"("revokedAt", "expiresAt");
