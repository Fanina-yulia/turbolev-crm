from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'pattern not found in {path}: {old[:180]!r}')
    p.write_text(text.replace(old, new, 1))

# Add Marketing to assignable system roles and make it a central/global role.
replace_once(
    'src/services/personnel-access.service.ts',
    '''  "HEAD_OF_SALES",\n  "SALES",\n  "PARTS_SPECIALIST",''',
    '''  "HEAD_OF_SALES",\n  "MARKETING",\n  "SALES",\n  "PARTS_SPECIALIST",''',
)
replace_once(
    'src/services/personnel-access.service.ts',
    '''  "EXECUTIVE_DIRECTOR",\n  "HEAD_OF_SALES",\n  "ACCOUNTANT",''',
    '''  "EXECUTIVE_DIRECTOR",\n  "HEAD_OF_SALES",\n  "MARKETING",\n  "ACCOUNTANT",''',
)

# Complete default RBAC catalog.
replace_once(
    'src/security/access-matrix-catalog.ts',
    '''  { code: "SALES", name: "Продавець", description: "Робота зі своїми та командними лідами, клієнтами і записами.", sortOrder: 40, grants: [''',
    '''  { code: "MARKETING", name: "Маркетинг", description: "Огляд воронки, джерел звернень і операційної аналітики без права змінювати клієнта, ЗН або оплату.", sortOrder: 35, grants: [\n    grant(PERMISSIONS.OVERVIEW_READ,"ALL"), grant(PERMISSIONS.COMMUNICATIONS_READ,"ALL"), grant(PERMISSIONS.LEADS_READ,"ALL"),\n    grant(PERMISSIONS.ANALYTICS_READ,"ALL"), grant(PERMISSIONS.PAYROLL_SELF_READ,"SELF"),\n  ]},\n  { code: "SALES", name: "Продавець", description: "Робота зі своїми та командними лідами, клієнтами і записами.", sortOrder: 40, grants: [''',
)
replace_once(
    'src/security/access-matrix-catalog.ts',
    '{ code: "PARTS_SPECIALIST", name: "Підборщик запчастин", description: "Підбір, закупівлі та робота з постачальниками.", sortOrder: 50, grants: [',
    '{ code: "PARTS_SPECIALIST", name: "Запчастини / закупівлі / склад", description: "Підбір, замовлення, отримання та складський контур деталей.", sortOrder: 50, grants: [',
)
replace_once(
    'src/security/access-matrix-catalog.ts',
    '{ code: "ACCOUNTANT", name: "Бухгалтер", description: "Фінанси, оплати, зарплата та фінансова аналітика по мережі.", sortOrder: 80, grants: [',
    '{ code: "ACCOUNTANT", name: "Бухгалтер / каса", description: "Проведення оплат, фінансовий та зарплатний облік по мережі.", sortOrder: 80, grants: [',
)

# Persistent roles in production DB.
m = Path('prisma/migrations/20260820031500_complete_operational_role_catalog')
m.mkdir(parents=True, exist_ok=True)
m.joinpath('migration.sql').write_text(r'''-- Complete Turbo LEV operational role catalog.

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
''')

Path('scripts/one-off-complete-role-catalog.py').unlink(missing_ok=True)
Path('.github/workflows/one-off-complete-role-catalog.yml').unlink(missing_ok=True)
