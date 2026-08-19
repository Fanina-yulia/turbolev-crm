-- Turbo LEV status/role alignment
-- Service advisor owns the customer/WO flow; mechanic owns assigned repair;
-- shift master owns QC; vehicle is ready for pickup only after full payment.

INSERT INTO "StaffRole" ("id","code","name","category","economicsMode","isActive","sortOrder","createdAt","updatedAt")
VALUES ('staff_shift_master','SHIFT_MASTER','Майстер зміни','Майстри','SUPPORT',true,68,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name"=EXCLUDED."name", "category"=EXCLUDED."category", "isActive"=true,
  "sortOrder"=EXCLUDED."sortOrder", "updatedAt"=CURRENT_TIMESTAMP;

INSERT INTO "AccessRole" ("id","code","name","description","isSystem","isActive","sortOrder","createdAt","updatedAt")
VALUES ('access_shift_master','SHIFT_MASTER','Майстер зміни','Контроль завершеного ремонту, QC і повернення авто на доопрацювання в межах своєї станції.',true,true,68,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name"=EXCLUDED."name", "description"=EXCLUDED."description", "isActive"=true,
  "sortOrder"=EXCLUDED."sortOrder", "updatedAt"=CURRENT_TIMESTAMP;

WITH grants(code, scope) AS (
  VALUES
    ('OVERVIEW.READ','LOCATION'),('PLANNER.READ','LOCATION'),('DIAGNOSTICS.READ','LOCATION'),
    ('WORK_ORDERS.READ','LOCATION'),('PRODUCTION.READ','LOCATION'),
    ('QC.READ','LOCATION'),('QC.WRITE','LOCATION'),('PARTS.READ','LOCATION'),
    ('PERSONNEL.READ','LOCATION'),('PAYROLL.SELF_READ','SELF')
)
INSERT INTO "AccessRolePermission" ("id","roleId","permissionId","scope","createdAt","updatedAt")
SELECT 'arp_shift_master_' || replace(lower(g.code),'.','_'), r."id", p."id", g.scope::"AccessScope", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM grants g
JOIN "AccessRole" r ON r."code"='SHIFT_MASTER'
JOIN "Permission" p ON p."code"=g.code
ON CONFLICT ("roleId","permissionId") DO UPDATE SET "scope"=EXCLUDED."scope", "updatedAt"=CURRENT_TIMESTAMP;

-- Service manager: customer communication, final estimate/approval, parts/procurement and warranty coordination.
WITH grants(code, scope) AS (
  VALUES
    ('PARTS.WRITE','LOCATION'),('PROCUREMENT.WRITE','LOCATION'),
    ('PAYMENTS.READ','LOCATION'),('WARRANTY.WRITE','LOCATION')
)
INSERT INTO "AccessRolePermission" ("id","roleId","permissionId","scope","createdAt","updatedAt")
SELECT 'arp_service_advisor_' || replace(lower(g.code),'.','_'), r."id", p."id", g.scope::"AccessScope", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM grants g
JOIN "AccessRole" r ON r."code"='SERVICE_ADVISOR'
JOIN "Permission" p ON p."code"=g.code
ON CONFLICT ("roleId","permissionId") DO UPDATE SET "scope"=EXCLUDED."scope", "updatedAt"=CURRENT_TIMESTAMP;

-- Parts specialist is station-scoped by default. Owners can explicitly widen scope in Roles & Access.
UPDATE "AccessRolePermission" arp
SET "scope"='LOCATION'::"AccessScope", "updatedAt"=CURRENT_TIMESTAMP
FROM "AccessRole" r, "Permission" p
WHERE arp."roleId"=r."id" AND arp."permissionId"=p."id"
  AND r."code"='PARTS_SPECIALIST'
  AND p."code" IN ('PARTS.READ','PARTS.WRITE','PROCUREMENT.READ','PROCUREMENT.WRITE');

-- Sales may quote a lead, but the final WorkOrder estimate belongs to the service manager.
DELETE FROM "AccessRolePermission" arp
USING "AccessRole" r, "Permission" p
WHERE arp."roleId"=r."id" AND arp."permissionId"=p."id"
  AND r."code" IN ('SALES','HEAD_OF_SALES') AND p."code"='WORK_ORDERS.ESTIMATE';
