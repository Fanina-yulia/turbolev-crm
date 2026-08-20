-- Turbo Lev operating policy: payment before pickup and real operational role ownership.

ALTER TYPE "PlannerAppointmentStatus" ADD VALUE IF NOT EXISTS 'WAITING_PAYMENT' AFTER 'WAITING_QC';

-- Keep the personnel/job catalog and RBAC catalog aligned.
INSERT INTO "StaffRole" (
  "id", "code", "name", "category", "economicsMode", "isActive", "sortOrder", "createdAt", "updatedAt"
)
VALUES (
  'staff_role_shift_master', 'SHIFT_MASTER', 'Майстер зміни', 'OPERATIONS', 'SUPPORT_CAPACITY', true, 67, NOW(), NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "category" = EXCLUDED."category",
  "economicsMode" = EXCLUDED."economicsMode",
  "isActive" = true,
  "sortOrder" = EXCLUDED."sortOrder",
  "updatedAt" = NOW();

INSERT INTO "AccessRole" (
  "id", "code", "name", "description", "isSystem", "isActive", "sortOrder", "createdAt", "updatedAt"
)
VALUES (
  'access_role_shift_master',
  'SHIFT_MASTER',
  'Майстер зміни',
  'Контроль завершеного ремонту та якості по своїй станції.',
  true,
  true,
  67,
  NOW(),
  NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "isActive" = true,
  "sortOrder" = EXCLUDED."sortOrder",
  "updatedAt" = NOW();

-- Service manager owns the client/vehicle process, may select parts and must see whether payment is closed.
WITH target_role AS (
  SELECT id FROM "AccessRole" WHERE code = 'SERVICE_ADVISOR'
), target_permissions AS (
  SELECT id, code FROM "Permission" WHERE code IN ('PARTS.WRITE', 'PROCUREMENT.WRITE', 'PAYMENTS.READ')
)
INSERT INTO "AccessRolePermission" ("id", "roleId", "permissionId", "scope", "createdAt", "updatedAt")
SELECT
  'arp_sa_' || LEFT(MD5(p.code), 20),
  r.id,
  p.id,
  'LOCATION'::"AccessScope",
  NOW(),
  NOW()
FROM target_role r CROSS JOIN target_permissions p
ON CONFLICT ("roleId", "permissionId") DO UPDATE SET
  "scope" = EXCLUDED."scope",
  "updatedAt" = NOW();

-- Shift master performs QC and has read-only operational context for the station.
WITH target_role AS (
  SELECT id FROM "AccessRole" WHERE code = 'SHIFT_MASTER'
), target_permissions AS (
  SELECT id, code FROM "Permission"
  WHERE code IN (
    'OVERVIEW.READ', 'CLIENTS.READ', 'PLANNER.READ', 'DIAGNOSTICS.READ',
    'WORK_ORDERS.READ', 'PRODUCTION.READ', 'QC.READ', 'QC.WRITE',
    'PARTS.READ', 'WARRANTY.READ'
  )
)
INSERT INTO "AccessRolePermission" ("id", "roleId", "permissionId", "scope", "createdAt", "updatedAt")
SELECT
  'arp_shift_' || LEFT(MD5(p.code), 20),
  r.id,
  p.id,
  'LOCATION'::"AccessScope",
  NOW(),
  NOW()
FROM target_role r CROSS JOIN target_permissions p
ON CONFLICT ("roleId", "permissionId") DO UPDATE SET
  "scope" = EXCLUDED."scope",
  "updatedAt" = NOW();

WITH target_role AS (
  SELECT id FROM "AccessRole" WHERE code = 'SHIFT_MASTER'
), target_permission AS (
  SELECT id, code FROM "Permission" WHERE code = 'PAYROLL.SELF_READ'
)
INSERT INTO "AccessRolePermission" ("id", "roleId", "permissionId", "scope", "createdAt", "updatedAt")
SELECT
  'arp_shift_' || LEFT(MD5(p.code), 20),
  r.id,
  p.id,
  'SELF'::"AccessScope",
  NOW(),
  NOW()
FROM target_role r CROSS JOIN target_permission p
ON CONFLICT ("roleId", "permissionId") DO UPDATE SET
  "scope" = EXCLUDED."scope",
  "updatedAt" = NOW();

-- Mechanics repair and diagnose; QC is explicitly outside their role.
DELETE FROM "AccessRolePermission" arp
USING "AccessRole" r, "Permission" p
WHERE arp."roleId" = r.id
  AND arp."permissionId" = p.id
  AND r.code = 'MECHANIC'
  AND p.code IN ('QC.READ', 'QC.WRITE');

-- Station manager supervises QC but does not execute/sign it by default.
DELETE FROM "AccessRolePermission" arp
USING "AccessRole" r, "Permission" p
WHERE arp."roleId" = r.id
  AND arp."permissionId" = p.id
  AND r.code = 'STATION_MANAGER'
  AND p.code = 'QC.WRITE';

UPDATE "AccessRole"
SET "description" = 'Власник сервісного процесу: оформлення, комунікація, кошторис, погодження, підбір деталей, допродаж і контроль авто до видачі.',
    "updatedAt" = NOW()
WHERE code = 'SERVICE_ADVISOR';

UPDATE "AccessRole"
SET "description" = 'Призначені діагностики та ремонт: старт, пауза, продовження і завершення власних робіт. QC не проводить.',
    "updatedAt" = NOW()
WHERE code = 'MECHANIC';

UPDATE "AccessRole"
SET "description" = 'Керівник операцій станції: бачить весь цикл і QC, але не підміняє Майстра зміни як виконавця QC.',
    "updatedAt" = NOW()
WHERE code = 'STATION_MANAGER';
\n\n-- Sales works with the lead funnel; the final WorkOrder estimate belongs to Service Advisor.\nDELETE FROM "AccessRolePermission" arp\nUSING "AccessRole" r, "Permission" p\nWHERE arp."roleId" = r.id\n  AND arp."permissionId" = p.id\n  AND r.code IN ('SALES', 'HEAD_OF_SALES')\n  AND p.code = 'WORK_ORDERS.ESTIMATE';\n