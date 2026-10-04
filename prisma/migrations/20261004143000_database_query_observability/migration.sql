-- Database workload observability.
-- pg_stat_statements is supported by Neon and collects normalized statement
-- statistics without application-level SQL logging.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

CREATE TABLE IF NOT EXISTS "DatabaseQueryStatSnapshot" (
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "queryId" VARCHAR(64) NOT NULL,
  "statsResetAt" TIMESTAMP(3),
  "calls" BIGINT NOT NULL,
  "totalExecMs" DECIMAL(20,3) NOT NULL,
  "meanExecMs" DECIMAL(20,3) NOT NULL,
  "rows" BIGINT NOT NULL,
  "sharedBlksHit" BIGINT NOT NULL,
  "sharedBlksRead" BIGINT NOT NULL,
  "queryText" TEXT NOT NULL,
  CONSTRAINT "DatabaseQueryStatSnapshot_pkey" PRIMARY KEY ("capturedAt","queryId")
);

CREATE INDEX IF NOT EXISTS "DatabaseQueryStatSnapshot_queryId_capturedAt_idx"
  ON "DatabaseQueryStatSnapshot" ("queryId","capturedAt");

CREATE INDEX IF NOT EXISTS "DatabaseQueryStatSnapshot_capturedAt_idx"
  ON "DatabaseQueryStatSnapshot" ("capturedAt");
