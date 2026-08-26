-- VIN fallback is required when a plate lookup resolves to an incomplete CRM
-- record or when a vehicle has no current Ukrainian registration plate.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "VehicleRegistryCompact_vin_idx"
  ON "VehicleRegistryCompact" ("vin")
  WHERE "vin" IS NOT NULL;

-- Repair existing incomplete CRM cards from the same trusted VIN source. The
-- join is limited to incomplete vehicles, so the new VIN index makes this a
-- targeted lookup instead of a full registry scan.
WITH "bestRegistryVehicle" AS (
  SELECT DISTINCT ON (registry."vin")
    registry."vin",
    registry."brand",
    registry."model",
    registry."makeYear",
    registry."engineVolumeCm3",
    registry."fuelType",
    registry."vehicleTypeRaw"
  FROM "VehicleRegistryCompact" registry
  INNER JOIN "Vehicle" vehicle
    ON vehicle."vin" = registry."vin"
   AND (
     NULLIF(BTRIM(vehicle."brand"), '') IS NULL
     OR NULLIF(BTRIM(vehicle."model"), '') IS NULL
   )
  WHERE registry."vin" IS NOT NULL
    AND NULLIF(BTRIM(registry."brand"), '') IS NOT NULL
    AND NULLIF(BTRIM(registry."model"), '') IS NOT NULL
  ORDER BY registry."vin", registry."sourceYear" DESC
)
UPDATE "Vehicle" vehicle
SET
  "brand" = COALESCE(NULLIF(BTRIM(vehicle."brand"), ''), registry."brand"),
  "model" = COALESCE(NULLIF(BTRIM(vehicle."model"), ''), registry."model"),
  "year" = COALESCE(vehicle."year", registry."makeYear"),
  "engineVolumeCm3" = COALESCE(vehicle."engineVolumeCm3", registry."engineVolumeCm3"),
  "fuelType" = COALESCE(NULLIF(BTRIM(vehicle."fuelType"), ''), registry."fuelType"),
  "bodyType" = COALESCE(NULLIF(BTRIM(vehicle."bodyType"), ''), registry."vehicleTypeRaw"),
  "vehicleDataSource" = 'MVS_INDEX_BY_VIN_BACKFILL',
  "vehicleDataConfidence" = GREATEST(COALESCE(vehicle."vehicleDataConfidence", 0), 96),
  "lastVehicleLookupAt" = NOW(),
  "updatedAt" = NOW()
FROM "bestRegistryVehicle" registry
WHERE vehicle."vin" = registry."vin";
