-- Diagnostic Card is the immutable technical document produced from structured diagnostics.
CREATE TYPE "DiagnosticCardRevisionKind" AS ENUM ('REVIEW', 'FINAL');

CREATE SEQUENCE IF NOT EXISTS "diagnostic_card_number_seq" START 1;

CREATE TABLE "DiagnosticCard" (
    "id" TEXT NOT NULL,
    "diagnosticRequestId" TEXT NOT NULL,
    "number" VARCHAR(32) NOT NULL,
    "currentRevision" INTEGER NOT NULL DEFAULT 0,
    "finalizedAt" TIMESTAMP(3),
    "confirmedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiagnosticCard_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiagnosticCardRevision" (
    "id" TEXT NOT NULL,
    "diagnosticCardId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "kind" "DiagnosticCardRevisionKind" NOT NULL,
    "sourceFingerprint" VARCHAR(64) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiagnosticCardRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DiagnosticCard_diagnosticRequestId_key" ON "DiagnosticCard"("diagnosticRequestId");
CREATE UNIQUE INDEX "DiagnosticCard_number_key" ON "DiagnosticCard"("number");
CREATE INDEX "DiagnosticCard_finalizedAt_updatedAt_idx" ON "DiagnosticCard"("finalizedAt", "updatedAt");
CREATE INDEX "DiagnosticCard_confirmedByUserId_idx" ON "DiagnosticCard"("confirmedByUserId");
CREATE UNIQUE INDEX "DiagnosticCardRevision_diagnosticCardId_revision_key" ON "DiagnosticCardRevision"("diagnosticCardId", "revision");
CREATE INDEX "DiagnosticCardRevision_diagnosticCardId_kind_createdAt_idx" ON "DiagnosticCardRevision"("diagnosticCardId", "kind", "createdAt");
CREATE INDEX "DiagnosticCardRevision_sourceFingerprint_idx" ON "DiagnosticCardRevision"("sourceFingerprint");

ALTER TABLE "DiagnosticCard"
ADD CONSTRAINT "DiagnosticCard_diagnosticRequestId_fkey"
FOREIGN KEY ("diagnosticRequestId") REFERENCES "DiagnosticRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DiagnosticCardRevision"
ADD CONSTRAINT "DiagnosticCardRevision_diagnosticCardId_fkey"
FOREIGN KEY ("diagnosticCardId") REFERENCES "DiagnosticCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
