-- Shared vehicle model templates with reusable color variants.
-- Existing library assets remain valid and can be used as legacy visual references.
ALTER TABLE public."VehicleImageLibraryAsset"
  ADD COLUMN IF NOT EXISTS "templateKey" TEXT,
  ADD COLUMN IF NOT EXISTS "variantKey" TEXT,
  ADD COLUMN IF NOT EXISTS "normalizedColor" TEXT,
  ADD COLUMN IF NOT EXISTS "generationFrom" INTEGER,
  ADD COLUMN IF NOT EXISTS "generationTo" INTEGER,
  ADD COLUMN IF NOT EXISTS "sourceAssetId" TEXT,
  ADD COLUMN IF NOT EXISTS "generationMode" TEXT NOT NULL DEFAULT 'TEXT_GENERATION';

CREATE INDEX IF NOT EXISTS "VehicleImageLibraryAsset_templateKey_status_idx"
  ON public."VehicleImageLibraryAsset" ("templateKey", "status", "updatedAt");

CREATE INDEX IF NOT EXISTS "VehicleImageLibraryAsset_template_color_idx"
  ON public."VehicleImageLibraryAsset" ("templateKey", "normalizedColor");

CREATE INDEX IF NOT EXISTS "VehicleImageLibraryAsset_sourceAssetId_idx"
  ON public."VehicleImageLibraryAsset" ("sourceAssetId");

CREATE UNIQUE INDEX IF NOT EXISTS "VehicleImageLibraryAsset_template_variant_unique"
  ON public."VehicleImageLibraryAsset" ("templateKey", "variantKey")
  WHERE "templateKey" IS NOT NULL AND "variantKey" IS NOT NULL;
