CREATE TABLE "PartSearchRun" (
    "id" TEXT NOT NULL,
    "vehicleId" VARCHAR(160),
    "vin" VARCHAR(40),
    "plate" VARCHAR(40),
    "query" VARCHAR(240) NOT NULL,
    "canonicalCode" VARCHAR(80),
    "axis" VARCHAR(16),
    "side" VARCHAR(16),
    "algorithmVersion" VARCHAR(64) NOT NULL DEFAULT 'EVIDENCE_FIRST_V3',
    "status" VARCHAR(32) NOT NULL DEFAULT 'RUNNING',
    "evidenceDriven" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "totalDurationMs" INTEGER,
    "rawOfferCount" INTEGER NOT NULL DEFAULT 0,
    "acceptedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartSearchRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartSearchDecision" (
    "id" TEXT NOT NULL,
    "searchRunId" TEXT NOT NULL,
    "supplierId" VARCHAR(64),
    "externalProductId" VARCHAR(180),
    "brand" VARCHAR(120),
    "article" VARCHAR(180),
    "name" VARCHAR(320) NOT NULL,
    "detectedCanonicalCode" VARCHAR(80),
    "decision" VARCHAR(24) NOT NULL,
    "evidenceTier" VARCHAR(48) NOT NULL,
    "reasonCode" VARCHAR(64),
    "reason" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartSearchDecision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PartSearchRun_vehicleId_createdAt_idx" ON "PartSearchRun"("vehicleId", "createdAt");
CREATE INDEX "PartSearchRun_canonicalCode_createdAt_idx" ON "PartSearchRun"("canonicalCode", "createdAt");
CREATE INDEX "PartSearchRun_status_createdAt_idx" ON "PartSearchRun"("status", "createdAt");
CREATE INDEX "PartSearchRun_algorithmVersion_createdAt_idx" ON "PartSearchRun"("algorithmVersion", "createdAt");
CREATE INDEX "PartSearchDecision_searchRunId_decision_idx" ON "PartSearchDecision"("searchRunId", "decision");
CREATE INDEX "PartSearchDecision_supplierId_article_idx" ON "PartSearchDecision"("supplierId", "article");
CREATE INDEX "PartSearchDecision_reasonCode_createdAt_idx" ON "PartSearchDecision"("reasonCode", "createdAt");
CREATE INDEX "PartSearchDecision_detectedCanonicalCode_createdAt_idx" ON "PartSearchDecision"("detectedCanonicalCode", "createdAt");

ALTER TABLE "PartSearchDecision"
ADD CONSTRAINT "PartSearchDecision_searchRunId_fkey"
FOREIGN KEY ("searchRunId") REFERENCES "PartSearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
