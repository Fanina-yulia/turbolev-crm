-- External-data fixtures required by migrations/smoke tests on a clean CI database.
-- VehicleRegistryCompact is intentionally NOT Prisma-managed: production data is
-- populated by scripts/import-mvs-open-data.py. CI only needs an empty structural
-- fixture so the full Prisma migration history can be replayed from zero.

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
