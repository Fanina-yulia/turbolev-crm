-- Keep the catalog fully represented by Prisma so strict drift validation stays meaningful.
DROP INDEX IF EXISTS public."VehicleModelPopularity_rank_unique";
CREATE INDEX IF NOT EXISTS "VehicleModelPopularity_rank_idx"
  ON public."VehicleModelPopularity" ("rank");

DROP INDEX IF EXISTS public."VehicleGenerationReference_resolve_idx";
CREATE INDEX IF NOT EXISTS "VehicleGenerationReference_resolve_idx"
  ON public."VehicleGenerationReference" ("normalizedMake", "normalizedModel", "fromYear", "toYear");

ALTER TABLE public."VehicleGenerationReference"
  DROP CONSTRAINT IF EXISTS "VehicleGenerationReference_years_check",
  DROP CONSTRAINT IF EXISTS "VehicleGenerationReference_confidence_check";
