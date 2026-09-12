CREATE TYPE "ControlledDocumentType" AS ENUM ('DIAGNOSTIC_CARD', 'COMMERCIAL_PROPOSAL', 'INVOICE', 'COMPLETION_ACT');
CREATE TYPE "ControlledDocumentRevisionStatus" AS ENUM ('ISSUED', 'SUPERSEDED', 'VOIDED');

CREATE TABLE "ControlledDocumentRevision" (
  "id" TEXT NOT NULL,
  "documentKey" VARCHAR(180) NOT NULL,
  "type" "ControlledDocumentType" NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "status" "ControlledDocumentRevisionStatus" NOT NULL DEFAULT 'ISSUED',
  "workOrderId" TEXT,
  "diagnosticRequestId" TEXT,
  "sourceEntityType" VARCHAR(64) NOT NULL,
  "sourceEntityId" VARCHAR(96) NOT NULL,
  "sourceRevision" INTEGER,
  "sourceFingerprint" VARCHAR(64) NOT NULL,
  "templateVersion" INTEGER,
  "templateFingerprint" VARCHAR(64) NOT NULL,
  "contentHash" VARCHAR(64) NOT NULL,
  "fileName" VARCHAR(180),
  "mimeType" VARCHAR(80) NOT NULL DEFAULT 'application/pdf',
  "snapshot" JSONB NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "issuedByName" VARCHAR(160),
  "supersededAt" TIMESTAMP(3),
  "voidedAt" TIMESTAMP(3),
  "voidedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ControlledDocumentRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ControlledDocumentRevision_workOrderId_fkey"
    FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ControlledDocumentRevision_diagnosticRequestId_fkey"
    FOREIGN KEY ("diagnosticRequestId") REFERENCES "DiagnosticRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "cdr_document_key_revision_key"
  ON "ControlledDocumentRevision"("documentKey", "revision");
CREATE UNIQUE INDEX "cdr_document_key_hash_key"
  ON "ControlledDocumentRevision"("documentKey", "contentHash");
CREATE INDEX "cdr_document_status_revision_idx"
  ON "ControlledDocumentRevision"("documentKey", "status", "revision");
CREATE INDEX "cdr_type_status_issued_idx"
  ON "ControlledDocumentRevision"("type", "status", "issuedAt");
CREATE INDEX "cdr_work_order_type_status_idx"
  ON "ControlledDocumentRevision"("workOrderId", "type", "status", "revision");
CREATE INDEX "cdr_diagnostic_type_status_idx"
  ON "ControlledDocumentRevision"("diagnosticRequestId", "type", "status", "revision");
CREATE INDEX "cdr_source_entity_idx"
  ON "ControlledDocumentRevision"("sourceEntityType", "sourceEntityId");
