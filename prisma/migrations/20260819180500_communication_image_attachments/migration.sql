CREATE TABLE IF NOT EXISTS "CommunicationAttachment" (
  "id" TEXT NOT NULL,
  "inquiryId" TEXT NOT NULL,
  "messageId" TEXT,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "providerUrl" TEXT NOT NULL,
  "providerTokenHash" TEXT NOT NULL,
  "providerExpiresAt" TIMESTAMP(3) NOT NULL,
  "fileData" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attachedAt" TIMESTAMP(3),
  CONSTRAINT "CommunicationAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CommunicationAttachment_providerTokenHash_key"
  ON "CommunicationAttachment"("providerTokenHash");
CREATE INDEX IF NOT EXISTS "CommunicationAttachment_inquiryId_createdAt_idx"
  ON "CommunicationAttachment"("inquiryId", "createdAt");
CREATE INDEX IF NOT EXISTS "CommunicationAttachment_messageId_idx"
  ON "CommunicationAttachment"("messageId");
CREATE INDEX IF NOT EXISTS "CommunicationAttachment_providerExpiresAt_idx"
  ON "CommunicationAttachment"("providerExpiresAt");
