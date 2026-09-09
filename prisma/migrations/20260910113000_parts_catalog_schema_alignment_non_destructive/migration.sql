-- Non-destructive alignment for parts-catalog objects whose Prisma model evolved
-- after the original 20260909140000 migration.

ALTER TABLE "PartRejectedMatch"
  ALTER COLUMN "name" TYPE VARCHAR(320),
  ALTER COLUMN "createdByUserId" TYPE TEXT;

ALTER TABLE "PartSearchFeedback"
  ALTER COLUMN "createdByUserId" TYPE TEXT;

UPDATE "RepairKit"
SET "source" = 'UNKNOWN'
WHERE "source" IS NULL;

ALTER TABLE "RepairKit"
  ALTER COLUMN "source" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "RepairKitItem_genericArticleId_idx"
  ON "RepairKitItem"("genericArticleId");
