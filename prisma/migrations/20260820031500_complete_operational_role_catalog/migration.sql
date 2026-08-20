-- Complete Turbo LEV operational role catalog.

INSERT INTO "StaffRole" (
  "id","code","name","category","economicsMode","isActive","sortOrder","createdAt","updatedAt"
)
VALUES (
  'staff_role_marketing','MARKETING','Маркетинг','MARKETING','SUPPORT_CAPACITY',true,35,NOW(),NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"=EXCLUDED."name", "category"=EXCLUDED."category", "economicsMode"=EXCLUDED."economicsMode",
  "isActive"=true, "sortOrder"=EXCLUDED."sortOrder", "updatedAt"=NOW();

INSERT INTO "AccessRole" (
  "id","code","name","description","isSystem","isActive","sortOrder","createdAt","updatedAt"
)
VALUES (
  'access_role_marketing','MARKETING','Маркетинг',
  'Огляд воронки, джерел звернень і операційної аналітики без права змінювати клієнта, ЗН або оплату.',
  true,true,35,NOW(),NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"=EXCLUDED."name", "description"=EXCLUDED."description", "isActive"=true,
  "sortOrder"=EXCLUDED."sortOrder", "updatedAt"=NOW();

WITH target_role AS (
  SELECT id FROM "AccessRole" WHERE code='MARKETING'
), target_permissions AS (
  SELECT id,code FROM "Permission" WHERE code IN (
    'OVERVIEW.READ','COMMUNICATIONS.READ','LEADS.READ','ANALYTICS.READ','PAYROLL.SELF_READ'
  )
)
INSERT INTO "AccessRolePermission" ("id","roleId","permissionId","scope","createdAt","updatedAt")
SELECT
  'arp_marketing_' || LEFT(MD5(p.code),20), r.id, p.id,
  CASE WHEN p.code='PAYROLL.SELF_READ' THEN 'SELF'::"AccessScope" ELSE 'ALL'::"AccessScope" END,
  NOW(),NOW()
FROM target_role r CROSS JOIN target_permissions p
ON CONFLICT ("roleId","permissionId") DO UPDATE SET
  "scope"=EXCLUDED."scope", "updatedAt"=NOW();

UPDATE "StaffRole"
SET "name"='Запчастини / закупівлі / склад', "updatedAt"=NOW()
WHERE code='PARTS_SPECIALIST';
UPDATE "AccessRole"
SET "name"='Запчастини / закупівлі / склад',
    "description"='Підбір, замовлення, отримання та складський контур деталей.',
    "updatedAt"=NOW()
WHERE code='PARTS_SPECIALIST';

UPDATE "StaffRole"
SET "name"='Бухгалтер / каса', "updatedAt"=NOW()
WHERE code='ACCOUNTANT';
UPDATE "AccessRole"
SET "name"='Бухгалтер / каса',
    "description"='Проведення оплат, фінансовий та зарплатний облік по мережі.',
    "updatedAt"=NOW()
WHERE code='ACCOUNTANT';
