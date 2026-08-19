CREATE TYPE "ServiceAttachmentOwnerType" AS ENUM ('WORK_ORDER', 'WORK_ORDER_LINE', 'WARRANTY_CLAIM');
CREATE TYPE "ServiceAttachmentKind" AS ENUM ('IMAGE', 'VIDEO', 'DOCUMENT', 'OTHER');

CREATE TABLE "ServiceAttachment" (
  "id" TEXT NOT NULL,
  "workOrderId" VARCHAR(64) NOT NULL,
  "ownerType" "ServiceAttachmentOwnerType" NOT NULL,
  "ownerId" VARCHAR(64) NOT NULL,
  "kind" "ServiceAttachmentKind" NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" VARCHAR(160) NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "sha256" VARCHAR(64) NOT NULL,
  "caption" TEXT,
  "storageProvider" VARCHAR(32) NOT NULL DEFAULT 'DATABASE',
  "storageKey" TEXT,
  "fileData" BYTEA,
  "uploadedByUserId" VARCHAR(64),
  "uploadedByName" VARCHAR(160),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ServiceAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServiceAttachment_workOrderId_createdAt_idx" ON "ServiceAttachment"("workOrderId", "createdAt");
CREATE INDEX "ServiceAttachment_ownerType_ownerId_createdAt_idx" ON "ServiceAttachment"("ownerType", "ownerId", "createdAt");
CREATE INDEX "ServiceAttachment_sha256_idx" ON "ServiceAttachment"("sha256");
