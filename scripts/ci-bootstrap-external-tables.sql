-- External-data fixtures required only when replaying migrations or runtime smokes on a clean CI database.
--
-- VehicleRegistryCompact is intentionally not Prisma-managed. Production populates it
-- through the MVS open-data import pipeline, but the historical
-- 20260820095500_vehicle_registry_color migration augments that table. CI therefore
-- provides an empty structural fixture so the real migration history can be replayed
-- without rewriting an already-applied production migration. The color column is safe
-- to declare here because the historical migration uses ADD COLUMN IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "VehicleRegistryCompact" (
  "plateKey" BIGINT PRIMARY KEY,
  "vin" VARCHAR(17),
  "brand" VARCHAR(32),
  "model" VARCHAR(48),
  "makeYear" SMALLINT,
  "engineVolumeCm3" INTEGER,
  "fuelType" VARCHAR(24),
  "vehicleTypeRaw" VARCHAR(48),
  "sourceYear" SMALLINT NOT NULL,
  "color" VARCHAR(48)
);
