CREATE TABLE "PartsKnowledgeDualWrite" (
    "id" TEXT NOT NULL,
    "operationKey" VARCHAR(128) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    "crmStatus" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    "googleSheetsStatus" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    "crmError" TEXT,
    "googleSheetsError" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PartsKnowledgeDualWrite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PartsKnowledgeDualWrite_operationKey_key"
  ON "PartsKnowledgeDualWrite"("operationKey");

CREATE INDEX "PartsKnowledgeDualWrite_status_updatedAt_idx"
  ON "PartsKnowledgeDualWrite"("status", "updatedAt");

CREATE INDEX "PartsKnowledgeDualWrite_googleSheetsStatus_updatedAt_idx"
  ON "PartsKnowledgeDualWrite"("googleSheetsStatus", "updatedAt");
