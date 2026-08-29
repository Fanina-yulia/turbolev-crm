-- Turbo LEV commercial rule: the standard parts markup is 40%.
-- Preserve explicit supplier overrides; migrate only the former system default.
ALTER TABLE "Supplier"
  ALTER COLUMN "defaultMarkupPercent" SET DEFAULT 40.00;

UPDATE "Supplier"
SET "defaultMarkupPercent" = 40.00,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "defaultMarkupPercent" = 23.00;
