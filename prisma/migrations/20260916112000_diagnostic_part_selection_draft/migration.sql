CREATE TABLE "DiagnosticPartSelectionDraft" (
    "id" TEXT NOT NULL,
    "diagnosticRequestId" TEXT NOT NULL,
    "findingId" TEXT,
    "manualPartId" TEXT,
    "selectionKey" VARCHAR(190) NOT NULL,
    "partName" VARCHAR(500) NOT NULL,
    "position" VARCHAR(120),
    "genericArticleId" TEXT,
    "canonicalCode" VARCHAR(80),
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "supplierProvider" VARCHAR(80) NOT NULL,
    "supplierDbId" TEXT,
    "supplierName" VARCHAR(180) NOT NULL,
    "supplierQuoteId" TEXT,
    "externalProductId" VARCHAR(200),
    "article" VARCHAR(120) NOT NULL,
    "brand" VARCHAR(120),
    "warehouse" VARCHAR(180),
    "purchasePrice" DECIMAL(14,2) NOT NULL,
    "sellPrice" DECIMAL(14,2) NOT NULL,
    "markupPercent" DECIMAL(7,2),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
    "fitment" JSONB,
    "offerEvidence" JSONB,
    "manualFields" JSONB,
    "priceOverrideReason" TEXT,
    "createdByUserId" TEXT,
    "createdByName" VARCHAR(160),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiagnosticPartSelectionDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DiagnosticPartSelectionDraft_diagnosticRequestId_selectionK_key"
ON "DiagnosticPartSelectionDraft"("diagnosticRequestId", "selectionKey");

CREATE INDEX "DiagnosticPartSelectionDraft_diagnosticRequestId_updatedAt_idx"
ON "DiagnosticPartSelectionDraft"("diagnosticRequestId", "updatedAt");

CREATE INDEX "DiagnosticPartSelectionDraft_findingId_idx"
ON "DiagnosticPartSelectionDraft"("findingId");

CREATE INDEX "DiagnosticPartSelectionDraft_manualPartId_idx"
ON "DiagnosticPartSelectionDraft"("manualPartId");

CREATE INDEX "DiagnosticPartSelectionDraft_supplierDbId_idx"
ON "DiagnosticPartSelectionDraft"("supplierDbId");
