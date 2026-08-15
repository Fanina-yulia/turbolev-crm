-- Canonical personnel -> planner mechanic link.
ALTER TABLE "ServiceMechanic"
ADD COLUMN IF NOT EXISTS "employeeId" VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS "ServiceMechanic_locationId_employeeId_key"
ON "ServiceMechanic"("locationId", "employeeId");

CREATE INDEX IF NOT EXISTS "ServiceMechanic_employeeId_idx"
ON "ServiceMechanic"("employeeId");

-- Legacy placeholders remain for appointment history, but are not schedulable resources.
UPDATE "ServiceMechanic"
SET "isActive" = false,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "employeeId" IS NULL
  AND "id" IN ('mechanic_glevakha_1', 'mechanic_glevakha_2');

-- Station manager may manage personnel only through the LOCATION-scoped personnel workflow.
INSERT INTO "AccessRolePermission" ("id", "roleId", "permissionId", "scope", "createdAt", "updatedAt")
SELECT
  'arp_station_personnel_write',
  r."id",
  p."id",
  'LOCATION'::"AccessScope",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "AccessRole" r
JOIN "Permission" p ON p."code" = 'PERSONNEL.WRITE'
WHERE r."code" = 'STATION_MANAGER'
ON CONFLICT ("roleId", "permissionId") DO UPDATE
SET "scope" = 'LOCATION'::"AccessScope",
    "updatedAt" = CURRENT_TIMESTAMP;
