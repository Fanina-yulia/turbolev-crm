CREATE TABLE "WorkExecutionIssueComment" (
  "id" TEXT NOT NULL,
  "issueId" TEXT NOT NULL,
  "authorUserId" VARCHAR(64) NOT NULL,
  "authorName" VARCHAR(160),
  "body" VARCHAR(1000) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkExecutionIssueComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkExecutionIssueComment_issueId_createdAt_idx" ON "WorkExecutionIssueComment"("issueId", "createdAt");
CREATE INDEX "WorkExecutionIssueComment_authorUserId_createdAt_idx" ON "WorkExecutionIssueComment"("authorUserId", "createdAt");

ALTER TABLE "WorkExecutionIssueComment"
  ADD CONSTRAINT "WorkExecutionIssueComment_issueId_fkey"
  FOREIGN KEY ("issueId") REFERENCES "WorkExecutionIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
