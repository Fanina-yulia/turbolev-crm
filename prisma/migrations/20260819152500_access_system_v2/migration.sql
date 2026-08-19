-- Turbo LEV Access System v2
-- Adds Service Advisor role, mechanic diagnostic write access,
-- and persistent employee document binary storage.

ALTER TABLE "EmployeeDocument" ADD COLUMN IF NOT EXISTS "fileName" TEXT;
ALTER TABLE "EmployeeDocument" ADD COLUMN IF NOT EXISTS "mimeType" VARCHAR(160);
ALTER TABLE "EmployeeDocument" ADD COLUMN IF NOT EXISTS "fileSize" INTEGER;
ALTER TABLE "EmployeeDocument" ADD COLUMN IF NOT EXISTS "fileData" BYTEA;

INSERT INTO "StaffRole" ("id","code","name","category","economicsMode","isActive","sortOrder","createdAt","updatedAt")
VALUES ('staff_service_advisor','SERVICE_ADVISOR','Сервіс-менеджер','Майстри','DIRECT_ROI',true,65,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name"=EXCLUDED."name",
  "category"=EXCLUDED."category",
  "isActive"=true,
  "sortOrder"=65,
  "updatedAt"=CURRENT_TIMESTAMP;

INSERT INTO "AccessRole" ("id","code","name","description","isSystem","isActive","sortOrder","createdAt","updatedAt")
VALUES ('access_service_advisor','SERVICE_ADVISOR','Сервіс-менеджер','Приймання клієнта, діагностика, кошторис, погодження та супровід ремонту в межах своєї станції.',true,true,65,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name"=EXCLUDED."name",
  "description"=EXCLUDED."description",
  "isActive"=true,
  "sortOrder"=65,
  "updatedAt"=CURRENT_TIMESTAMP;

-- Make sure a mechanic can actually fill an assigned diagnostic, but still cannot confirm it.
INSERT INTO "AccessRolePermission" ("id","roleId","permissionId","scope","createdAt","updatedAt")
SELECT 'arp_mechanic_diagnostics_write', r."id", p."id", 'ASSIGNED'::"AccessScope", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "AccessRole" r, "Permission" p
WHERE r."code"='MECHANIC' AND p."code"='DIAGNOSTICS.WRITE'
ON CONFLICT ("roleId","permissionId") DO UPDATE SET "scope"='ASSIGNED'::"AccessScope", "updatedAt"=CURRENT_TIMESTAMP;

-- Service advisor default grants. Existing administrators can later tune scopes in Roles & Access.
WITH grants(code, scope) AS (
  VALUES
    ('OVERVIEW.READ','LOCATION'),
    ('COMMUNICATIONS.READ','LOCATION'),('COMMUNICATIONS.WRITE','LOCATION'),
    ('LEADS.READ','LOCATION'),('LEADS.WRITE','LOCATION'),
    ('CLIENTS.READ','LOCATION'),('CLIENTS.WRITE','LOCATION'),
    ('PLANNER.READ','LOCATION'),('PLANNER.WRITE','LOCATION'),
    ('DIAGNOSTICS.READ','LOCATION'),('DIAGNOSTICS.WRITE','LOCATION'),('DIAGNOSTICS.CONFIRM','LOCATION'),
    ('WORK_ORDERS.READ','LOCATION'),('WORK_ORDERS.WRITE','LOCATION'),('WORK_ORDERS.ESTIMATE','LOCATION'),
    ('PRODUCTION.READ','LOCATION'),('QC.READ','LOCATION'),
    ('PARTS.READ','LOCATION'),('PROCUREMENT.READ','LOCATION'),
    ('WARRANTY.READ','LOCATION'),('PAYROLL.SELF_READ','SELF')
)
INSERT INTO "AccessRolePermission" ("id","roleId","permissionId","scope","createdAt","updatedAt")
SELECT 'arp_service_advisor_' || replace(lower(g.code),'.','_'), r."id", p."id", g.scope::"AccessScope", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM grants g
JOIN "AccessRole" r ON r."code"='SERVICE_ADVISOR'
JOIN "Permission" p ON p."code"=g.code
ON CONFLICT ("roleId","permissionId") DO UPDATE SET "scope"=EXCLUDED."scope", "updatedAt"=CURRENT_TIMESTAMP;
