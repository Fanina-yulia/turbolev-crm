CREATE TABLE IF NOT EXISTS public."VehicleImageLibraryAsset" (
  "id" TEXT PRIMARY KEY,
  "libraryKey" TEXT NOT NULL UNIQUE,
  "make" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "year" INTEGER,
  "bodyType" TEXT,
  "theme" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'OPENAI',
  "providerModel" TEXT,
  "promptVersion" TEXT NOT NULL,
  "promptText" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "imageMimeType" TEXT,
  "imageData" BYTEA,
  "imageSizeBytes" INTEGER,
  "lastError" TEXT,
  "generatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "VehicleImageLibraryAsset_make_model_year_theme_idx"
  ON public."VehicleImageLibraryAsset" ("make", "model", "year", "theme");
CREATE INDEX IF NOT EXISTS "VehicleImageLibraryAsset_status_updatedAt_idx"
  ON public."VehicleImageLibraryAsset" ("status", "updatedAt");

CREATE TABLE IF NOT EXISTS public."VehicleImageGenerationJob" (
  "id" TEXT PRIMARY KEY,
  "libraryKey" TEXT NOT NULL,
  "vehicleId" TEXT,
  "assetId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VehicleImageGenerationJob_vehicleId_fkey"
    FOREIGN KEY ("vehicleId") REFERENCES public."Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "VehicleImageGenerationJob_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES public."VehicleImageLibraryAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "VehicleImageGenerationJob_libraryKey_status_idx"
  ON public."VehicleImageGenerationJob" ("libraryKey", "status");
CREATE INDEX IF NOT EXISTS "VehicleImageGenerationJob_vehicleId_createdAt_idx"
  ON public."VehicleImageGenerationJob" ("vehicleId", "createdAt");