CREATE TABLE "VehicleRegistration" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "countryCode" VARCHAR(2) NOT NULL,
    "plateNumber" VARCHAR(24) NOT NULL,
    "plateNormalized" VARCHAR(24) NOT NULL,
    "source" VARCHAR(40),
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VehicleRegistration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VinDecodeCache" (
    "vin" VARCHAR(17) NOT NULL,
    "source" VARCHAR(40) NOT NULL,
    "providerVersion" VARCHAR(24),
    "confidence" INTEGER NOT NULL,
    "vehicle" JSONB NOT NULL,
    "fieldConfidence" JSONB NOT NULL,
    "validation" JSONB NOT NULL,
    "decodedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VinDecodeCache_pkey" PRIMARY KEY ("vin")
);

CREATE INDEX "VehicleRegistration_countryCode_plateNormalized_idx" ON "VehicleRegistration"("countryCode", "plateNormalized");
CREATE INDEX "VehicleRegistration_vehicleId_isCurrent_idx" ON "VehicleRegistration"("vehicleId", "isCurrent");
CREATE INDEX "VinDecodeCache_source_updatedAt_idx" ON "VinDecodeCache"("source", "updatedAt");
CREATE INDEX "VinDecodeCache_expiresAt_idx" ON "VinDecodeCache"("expiresAt");

ALTER TABLE "VehicleRegistration"
ADD CONSTRAINT "VehicleRegistration_vehicleId_fkey"
FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
