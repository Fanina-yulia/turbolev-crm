-- A PDF is an immutable export of one DiagnosticCardRevision. The share table
-- stores only a SHA-256 token hash so a leaked database row cannot be used as
-- a public download URL.
CREATE TABLE "DiagnosticCardPdf" (
    "id" TEXT NOT NULL,
    "diagnosticCardId" TEXT NOT NULL,
    "diagnosticCardRevisionId" TEXT NOT NULL,
    "fileName" VARCHAR(180) NOT NULL,
    "mimeType" VARCHAR(80) NOT NULL DEFAULT 'application/pdf',
    "fileSize" INTEGER NOT NULL,
    "fileData" BYTEA NOT NULL,
    "generatedByUserId" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiagnosticCardPdf_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiagnosticCardPdfShare" (
    "id" TEXT NOT NULL,
    "pdfId" TEXT NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiagnosticCardPdfShare_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DiagnosticCardPdf_diagnosticCardRevisionId_key"
  ON "DiagnosticCardPdf" ("diagnosticCardRevisionId");
CREATE INDEX "DiagnosticCardPdf_diagnosticCardId_generatedAt_idx"
  ON "DiagnosticCardPdf" ("diagnosticCardId", "generatedAt");
CREATE UNIQUE INDEX "DiagnosticCardPdfShare_tokenHash_key"
  ON "DiagnosticCardPdfShare" ("tokenHash");
CREATE INDEX "DiagnosticCardPdfShare_pdfId_createdAt_idx"
  ON "DiagnosticCardPdfShare" ("pdfId", "createdAt");
CREATE INDEX "DiagnosticCardPdfShare_revokedAt_expiresAt_idx"
  ON "DiagnosticCardPdfShare" ("revokedAt", "expiresAt");

ALTER TABLE "DiagnosticCardPdf"
ADD CONSTRAINT "DiagnosticCardPdf_diagnosticCardId_fkey"
FOREIGN KEY ("diagnosticCardId") REFERENCES "DiagnosticCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DiagnosticCardPdf"
ADD CONSTRAINT "DiagnosticCardPdf_diagnosticCardRevisionId_fkey"
FOREIGN KEY ("diagnosticCardRevisionId") REFERENCES "DiagnosticCardRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DiagnosticCardPdfShare"
ADD CONSTRAINT "DiagnosticCardPdfShare_pdfId_fkey"
FOREIGN KEY ("pdfId") REFERENCES "DiagnosticCardPdf"("id") ON DELETE CASCADE ON UPDATE CASCADE;
