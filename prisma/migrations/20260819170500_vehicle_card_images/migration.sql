-- Vehicle card images and exterior color metadata.
CREATE TYPE "VehicleImageStatus" AS ENUM ('PENDING', 'READY', 'NOT_FOUND', 'ERROR', 'MANUAL');
CREATE TYPE "VehicleColorSource" AS ENUM ('USER', 'VIN', 'REGISTRY', 'PROVIDER', 'THEME', 'UNKNOWN');

ALTER TABLE "Vehicle"
  ADD COLUMN "exteriorColorName" TEXT,
  ADD COLUMN "exteriorColorHex" VARCHAR(16),
  ADD COLUMN "exteriorPaintCode" VARCHAR(48),
  ADD COLUMN "exteriorColorSource" "VehicleColorSource",
  ADD COLUMN "exteriorColorConfirmed" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "VehicleImageAsset" (
  "id" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "make" TEXT,
  "model" TEXT,
  "year" INTEGER,
  "trim" TEXT,
  "bodyType" TEXT,
  "angle" TEXT NOT NULL,
  "requestedColor" TEXT,
  "providerPaintId" TEXT,
  "sourceUrl" TEXT,
  "cachedUrl" TEXT,
  "status" "VehicleImageStatus" NOT NULL DEFAULT 'PENDING',
  "matchConfidence" INTEGER,
  "matchReason" TEXT,
  "signature" TEXT NOT NULL,
  "fetchedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VehicleImageAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VehicleImageAsset_vehicleId_signature_key" ON "VehicleImageAsset"("vehicleId", "signature");
CREATE INDEX "VehicleImageAsset_vehicleId_status_idx" ON "VehicleImageAsset"("vehicleId", "status");
CREATE INDEX "VehicleImageAsset_expiresAt_idx" ON "VehicleImageAsset"("expiresAt");

ALTER TABLE "VehicleImageAsset"
  ADD CONSTRAINT "VehicleImageAsset_vehicleId_fkey"
  FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
