-- Binary storage for Financial Center expense attachments.
-- Kept separate from attachment metadata so existing metadata model remains lightweight.
CREATE TABLE "ExpenseAttachmentBlob" (
  "id" TEXT NOT NULL,
  "attachmentId" VARCHAR(96) NOT NULL,
  "fileData" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExpenseAttachmentBlob_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ExpenseAttachmentBlob_attachmentId_key" ON "ExpenseAttachmentBlob"("attachmentId");
CREATE INDEX "ExpenseAttachmentBlob_attachmentId_idx" ON "ExpenseAttachmentBlob"("attachmentId");
