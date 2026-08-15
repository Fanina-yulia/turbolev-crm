-- P0 schema alignment: add the Prisma-managed fallback MVS registry table.
-- The high-volume VehicleRegistryCompact cache remains managed separately by the MVS import pipeline.
CREATE TABLE IF NOT EXISTS "VehicleRegistryEntry" (
    "plateNormalized" VARCHAR(10) NOT NULL,
    "vin" VARCHAR(17),
    "brand" VARCHAR(48),
    "model" VARCHAR(64),
    "makeYear" SMALLINT,
    "engineVolumeCm3" INTEGER,
    "fuelType" VARCHAR(24),
    "bodyType" VARCHAR(40),
    "vehicleKind" VARCHAR(40),
    "grossWeightKg" INTEGER,
    "registrationDate" VARCHAR(16),
    "sourceYear" SMALLINT NOT NULL,
    CONSTRAINT "VehicleRegistryEntry_pkey" PRIMARY KEY ("plateNormalized")
);
