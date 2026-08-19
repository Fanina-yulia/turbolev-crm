ALTER TABLE public."VehicleImageLibraryAsset"
  ADD COLUMN IF NOT EXISTS "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewedByUserId" TEXT;

CREATE INDEX IF NOT EXISTS "VehicleImageLibraryAsset_reviewStatus_updatedAt_idx"
  ON public."VehicleImageLibraryAsset" ("reviewStatus", "updatedAt");
