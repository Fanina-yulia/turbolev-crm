-- OWNER-only read-only employee cabinet preview.
CREATE TABLE IF NOT EXISTS "OwnerEmployeeViewAsSession" (
    "id" TEXT NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "targetEmployeeId" TEXT,
    "targetRoleCode" VARCHAR(64),
    "locationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    CONSTRAINT "OwnerEmployeeViewAsSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OwnerEmployeeViewAsSession_tokenHash_key" ON "OwnerEmployeeViewAsSession"("tokenHash");
CREATE INDEX IF NOT EXISTS "OwnerEmployeeViewAsSession_ownerUserId_endedAt_expiresAt_idx" ON "OwnerEmployeeViewAsSession"("ownerUserId", "endedAt", "expiresAt");
CREATE INDEX IF NOT EXISTS "OwnerEmployeeViewAsSession_targetUserId_endedAt_expiresAt_idx" ON "OwnerEmployeeViewAsSession"("targetUserId", "endedAt", "expiresAt");
CREATE INDEX IF NOT EXISTS "OwnerEmployeeViewAsSession_expiresAt_idx" ON "OwnerEmployeeViewAsSession"("expiresAt");

INSERT INTO "Permission" ("id", "code", "module", "action", "description", "isSensitive", "createdAt", "updatedAt")
VALUES (
  'perm_owner_employee_view_as',
  'OWNER.EMPLOYEE_VIEW_AS',
  'OWNER',
  'EMPLOYEE_VIEW_AS',
  'Власник може відкрити CRM у read-only режимі з реальними правами та станцією конкретного працівника',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO UPDATE SET
  "module" = EXCLUDED."module",
  "action" = EXCLUDED."action",
  "description" = EXCLUDED."description",
  "isSensitive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "AccessRolePermission" ("id", "roleId", "permissionId", "scope", "createdAt", "updatedAt")
SELECT
  'arp_owner_employee_view_as',
  role."id",
  permission."id",
  'ALL'::"AccessScope",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "AccessRole" role
JOIN "Permission" permission ON permission."code" = 'OWNER.EMPLOYEE_VIEW_AS'
WHERE role."code" = 'OWNER'
ON CONFLICT ("roleId", "permissionId") DO UPDATE SET
  "scope" = 'ALL'::"AccessScope",
  "updatedAt" = CURRENT_TIMESTAMP;
