ALTER TABLE "Vehicle"
  ADD COLUMN "plateNumber" TEXT,
  ADD COLUMN "plateNormalized" TEXT,
  ADD COLUMN "year" INTEGER,
  ADD COLUMN "mileageKm" INTEGER,
  ADD COLUMN "engineName" TEXT,
  ADD COLUMN "engineVolumeCm3" INTEGER,
  ADD COLUMN "fuelType" TEXT,
  ADD COLUMN "bodyType" TEXT,
  ADD COLUMN "grossWeightKg" INTEGER,
  ADD COLUMN "driveType" TEXT,
  ADD COLUMN "vehicleType" TEXT,
  ADD COLUMN "turboLevClass" TEXT,
  ADD COLUMN "priceCoefficient" DECIMAL(4,2) NOT NULL DEFAULT 1.00,
  ADD COLUMN "classificationSource" TEXT,
  ADD COLUMN "classificationConfidence" INTEGER,
  ADD COLUMN "manualClassOverride" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "vehicleDataSource" TEXT,
  ADD COLUMN "vehicleDataConfidence" INTEGER,
  ADD COLUMN "lastVehicleLookupAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Vehicle_plateNumber_key" ON "Vehicle"("plateNumber");
CREATE UNIQUE INDEX "Vehicle_plateNormalized_key" ON "Vehicle"("plateNormalized");
CREATE INDEX "Vehicle_turboLevClass_idx" ON "Vehicle"("turboLevClass");
