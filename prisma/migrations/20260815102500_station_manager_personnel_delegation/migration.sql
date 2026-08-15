-- Reconcile the tested production grant with Prisma migration history.
-- Safe to replay: the role/permission pair is unique and this migration only fixes its scope.
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
ON CONFLICT ("roleId", "permissionId")
DO UPDATE SET
  "scope" = 'LOCATION'::"AccessScope",
  "updatedAt" = CURRENT_TIMESTAMP;
