-- Bring the existing production communications tables under Prisma migration management.
-- This migration is replay-safe because these objects already exist in production.

DO $$ BEGIN
  CREATE TYPE "CommunicationChannel" AS ENUM ('FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'BINOTEL', 'OLX', 'WEBSITE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "InquiryState" AS ENUM ('NEW', 'IN_WORK', 'CONVERTED', 'LINKED', 'SPAM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "MessageDirection" AS ENUM ('IN', 'OUT', 'SYSTEM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "CommunicationInquiry" (
  "id" TEXT NOT NULL,
  "externalId" TEXT,
  "channel" "CommunicationChannel" NOT NULL,
  "state" "InquiryState" NOT NULL DEFAULT 'NEW',
  "name" TEXT,
  "phone" TEXT,
  "phoneNormalized" TEXT,
  "handle" TEXT,
  "subject" TEXT NOT NULL,
  "preview" TEXT NOT NULL,
  "vehicle" TEXT,
  "plate" TEXT,
  "plateNormalized" TEXT,
  "unread" BOOLEAN NOT NULL DEFAULT true,
  "answered" BOOLEAN NOT NULL DEFAULT false,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "sourceDetail" TEXT,
  "campaign" TEXT,
  "utm" TEXT,
  "leadId" TEXT,
  "assignedUserId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunicationInquiry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CommunicationMessage" (
  "id" TEXT NOT NULL,
  "inquiryId" TEXT NOT NULL,
  "externalId" TEXT,
  "direction" "MessageDirection" NOT NULL,
  "text" TEXT NOT NULL,
  "sentAt" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunicationMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WebhookEvent" (
  "id" TEXT NOT NULL,
  "channel" "CommunicationChannel" NOT NULL,
  "externalEventId" TEXT NOT NULL,
  "eventType" TEXT,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "processedAt" TIMESTAMP(3),
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='CommunicationInquiry_channel_externalId_key') THEN
    ALTER TABLE "CommunicationInquiry" ADD CONSTRAINT "CommunicationInquiry_channel_externalId_key" UNIQUE ("channel", "externalId");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='CommunicationMessage_inquiry_externalId_key') THEN
    ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_inquiry_externalId_key" UNIQUE ("inquiryId", "externalId");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='WebhookEvent_channel_externalEventId_key') THEN
    ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_channel_externalEventId_key" UNIQUE ("channel", "externalEventId");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='CommunicationInquiry_leadId_fkey') THEN
    ALTER TABLE "CommunicationInquiry" ADD CONSTRAINT "CommunicationInquiry_leadId_fkey"
      FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='CommunicationInquiry_assignedUserId_fkey') THEN
    ALTER TABLE "CommunicationInquiry" ADD CONSTRAINT "CommunicationInquiry_assignedUserId_fkey"
      FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='CommunicationMessage_inquiryId_fkey') THEN
    ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_inquiryId_fkey"
      FOREIGN KEY ("inquiryId") REFERENCES "CommunicationInquiry"("id") ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "CommunicationInquiry_channel_receivedAt_idx"
  ON "CommunicationInquiry"("channel", "receivedAt");
CREATE INDEX IF NOT EXISTS "CommunicationInquiry_state_receivedAt_idx"
  ON "CommunicationInquiry"("state", "receivedAt");
CREATE INDEX IF NOT EXISTS "CommunicationInquiry_phoneNormalized_idx"
  ON "CommunicationInquiry"("phoneNormalized");
CREATE INDEX IF NOT EXISTS "CommunicationInquiry_plateNormalized_idx"
  ON "CommunicationInquiry"("plateNormalized");
CREATE INDEX IF NOT EXISTS "CommunicationInquiry_assignedUserId_state_idx"
  ON "CommunicationInquiry"("assignedUserId", "state");
CREATE INDEX IF NOT EXISTS "CommunicationMessage_inquiryId_sentAt_idx"
  ON "CommunicationMessage"("inquiryId", "sentAt");
CREATE INDEX IF NOT EXISTS "WebhookEvent_status_createdAt_idx"
  ON "WebhookEvent"("status", "createdAt");
