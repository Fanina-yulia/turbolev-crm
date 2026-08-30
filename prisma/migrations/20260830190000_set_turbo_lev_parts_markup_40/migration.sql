-- Turbo LEV default parts markup: purchase price × 1.40.
-- Keep supplier-specific overrides that are different from the old schema default.
UPDATE "Supplier"
SET "defaultMarkupPercent" = 40.00
WHERE "defaultMarkupPercent" = 23.00;
