CREATE TABLE IF NOT EXISTS public."IntegrationCredential" (
  "id" text PRIMARY KEY,
  "provider" text NOT NULL UNIQUE,
  "category" text NOT NULL,
  "encryptedPayload" text NOT NULL,
  "maskedSummary" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'CONFIGURED',
  "lastTestAt" timestamp without time zone,
  "lastTestStatus" text,
  "lastTestMessage" text,
  "createdAt" timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "IntegrationCredential_category_idx" ON public."IntegrationCredential"("category");
CREATE INDEX IF NOT EXISTS "IntegrationCredential_status_idx" ON public."IntegrationCredential"("status");
