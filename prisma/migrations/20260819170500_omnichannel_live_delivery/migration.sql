-- Live omnichannel delivery state for Meta and OLX.
-- Replay-safe because production deploys may contain parts of the communications core already.

ALTER TABLE "CommunicationInquiry"
  ADD COLUMN IF NOT EXISTS "integrationAccountId" TEXT,
  ADD COLUMN IF NOT EXISTS "externalThreadId" TEXT,
  ADD COLUMN IF NOT EXISTS "externalParticipantId" TEXT,
  ADD COLUMN IF NOT EXISTS "lastInboundAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastOutboundAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "replyAllowedUntil" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastSyncedAt" TIMESTAMP(3);

ALTER TABLE "CommunicationMessage"
  ADD COLUMN IF NOT EXISTS "providerMessageId" TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryStatus" TEXT NOT NULL DEFAULT 'SENT',
  ADD COLUMN IF NOT EXISTS "errorCode" TEXT,
  ADD COLUMN IF NOT EXISTS "errorMessage" TEXT,
  ADD COLUMN IF NOT EXISTS "attachments" JSONB,
  ADD COLUMN IF NOT EXISTS "providerPayload" JSONB,
  ADD COLUMN IF NOT EXISTS "sentByUserId" TEXT;

CREATE INDEX IF NOT EXISTS "CommunicationInquiry_externalThreadId_idx"
  ON "CommunicationInquiry"("channel", "externalThreadId");
CREATE INDEX IF NOT EXISTS "CommunicationInquiry_replyAllowedUntil_idx"
  ON "CommunicationInquiry"("replyAllowedUntil");
CREATE INDEX IF NOT EXISTS "CommunicationMessage_deliveryStatus_idx"
  ON "CommunicationMessage"("deliveryStatus", "sentAt");
CREATE INDEX IF NOT EXISTS "CommunicationMessage_providerMessageId_idx"
  ON "CommunicationMessage"("providerMessageId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='CommunicationMessage_sentByUserId_fkey') THEN
    ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_sentByUserId_fkey"
      FOREIGN KEY ("sentByUserId") REFERENCES "User"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "CommunicationAccount" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "channel" "CommunicationChannel" NOT NULL,
  "externalAccountId" TEXT NOT NULL,
  "displayName" TEXT,
  "handle" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunicationAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CommunicationAccount_provider_externalAccountId_key"
  ON "CommunicationAccount"("provider", "externalAccountId");

CREATE TABLE IF NOT EXISTS "ExternalContactIdentity" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "channel" "CommunicationChannel" NOT NULL,
  "externalUserId" TEXT NOT NULL,
  "handle" TEXT,
  "displayName" TEXT,
  "clientId" TEXT,
  "leadId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExternalContactIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExternalContactIdentity_provider_externalUserId_key"
  ON "ExternalContactIdentity"("provider", "externalUserId");
CREATE INDEX IF NOT EXISTS "ExternalContactIdentity_clientId_idx"
  ON "ExternalContactIdentity"("clientId");
CREATE INDEX IF NOT EXISTS "ExternalContactIdentity_leadId_idx"
  ON "ExternalContactIdentity"("leadId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ExternalContactIdentity_clientId_fkey') THEN
    ALTER TABLE "ExternalContactIdentity" ADD CONSTRAINT "ExternalContactIdentity_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ExternalContactIdentity_leadId_fkey') THEN
    ALTER TABLE "ExternalContactIdentity" ADD CONSTRAINT "ExternalContactIdentity_leadId_fkey"
      FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "CommunicationSyncState" (
  "provider" TEXT NOT NULL,
  "lastSyncedAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'IDLE',
  "cursor" TEXT,
  "error" TEXT,
  "metadata" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunicationSyncState_pkey" PRIMARY KEY ("provider")
);
