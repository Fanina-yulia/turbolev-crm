-- Structural contract for external tables required by historical migrations.
-- Production data in VehicleRegistryCompact is populated by the MVS import pipeline.
-- CI creates only the empty structure after Prisma reaches the known external dependency.

CREATE TABLE IF NOT EXISTS "VehicleRegistryCompact" (
  "plateKey" BIGINT PRIMARY KEY,
  "vin" VARCHAR(17),
  "brand" VARCHAR(32),
  "model" VARCHAR(48),
  "makeYear" SMALLINT,
  "engineVolumeCm3" INTEGER,
  "fuelType" VARCHAR(24),
  "vehicleTypeRaw" VARCHAR(48),
  "sourceYear" SMALLINT NOT NULL
);
