from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'pattern not found in {path}: {old[:180]!r}')
    p.write_text(text.replace(old, new, 1))

# Personnel role assignment catalog.
replace_once(
    'src/services/personnel-access.service.ts',
    '''  "SHIFT_MASTER",\n  "MECHANIC",\n  "ACCOUNTANT",''',
    '''  "SHIFT_MASTER",\n  "MECHANIC",\n  "CASHIER",\n  "ACCOUNTANT",''',
)
replace_once(
    'src/services/personnel-access.service.ts',
    '''  "SHIFT_MASTER",\n  "MECHANIC",\n  "PARTS_SPECIALIST",''',
    '''  "SHIFT_MASTER",\n  "MECHANIC",\n  "CASHIER",\n  "PARTS_SPECIALIST",''',
)

# Least-privilege default role scopes and a separate cashier role.
replace_once(
    'src/security/access-matrix-catalog.ts',
    '''    grant(PERMISSIONS.OVERVIEW_READ,"LOCATION"), grant(PERMISSIONS.WORK_ORDERS_READ,"LOCATION"), grant(PERMISSIONS.PARTS_READ,"ALL"),\n    grant(PERMISSIONS.PARTS_WRITE,"ALL"), grant(PERMISSIONS.PROCUREMENT_READ,"ALL"), grant(PERMISSIONS.PROCUREMENT_WRITE,"ALL"), grant(PERMISSIONS.PAYROLL_SELF_READ,"SELF"),''',
    '''    grant(PERMISSIONS.OVERVIEW_READ,"LOCATION"), grant(PERMISSIONS.WORK_ORDERS_READ,"LOCATION"), grant(PERMISSIONS.PARTS_READ,"LOCATION"),\n    grant(PERMISSIONS.PARTS_WRITE,"LOCATION"), grant(PERMISSIONS.PROCUREMENT_READ,"LOCATION"), grant(PERMISSIONS.PROCUREMENT_WRITE,"LOCATION"), grant(PERMISSIONS.PAYROLL_SELF_READ,"SELF"),''',
)
replace_once(
    'src/security/access-matrix-catalog.ts',
    '''  { code: "ACCOUNTANT", name: "Бухгалтер / каса", description: "Проведення оплат, фінансовий та зарплатний облік по мережі.", sortOrder: 80, grants: [''',
    '''  { code: "CASHIER", name: "Касир", description: "Приймає та проводить оплату по ЗН своєї станції без доступу до зарплат і глобального P&L.", sortOrder: 75, grants: [\n    grant(PERMISSIONS.OVERVIEW_READ,"LOCATION"), grant(PERMISSIONS.WORK_ORDERS_READ,"LOCATION"),\n    grant(PERMISSIONS.PAYMENTS_READ,"LOCATION"), grant(PERMISSIONS.PAYMENTS_WRITE,"LOCATION"), grant(PERMISSIONS.PAYROLL_SELF_READ,"SELF"),\n  ]},\n  { code: "ACCOUNTANT", name: "Бухгалтер", description: "Фінанси, оплати, зарплата та фінансова аналітика по мережі.", sortOrder: 80, grants: [''',
)

# Workflow presentation: cashier is a real operational payment role.
replace_once(
    'src/domain/workflow/types.ts',
    '''  | "MECHANIC"\n  | "ACCOUNTANT"''',
    '''  | "MECHANIC"\n  | "CASHIER"\n  | "ACCOUNTANT"''',
)
replace_once(
    'src/domain/workflow/catalog.ts',
    '''  MECHANIC: "Автомеханік",\n  ACCOUNTANT: "Бухгалтер / каса",''',
    '''  MECHANIC: "Автомеханік",\n  CASHIER: "Касир",\n  ACCOUNTANT: "Бухгалтер",''',
)
replace_once(
    'src/domain/workflow/catalog.ts',
    '''  MECHANIC: WORKFLOW_ROLE_LABELS.MECHANIC,\n  ACCOUNTANT: WORKFLOW_ROLE_LABELS.ACCOUNTANT,''',
    '''  MECHANIC: WORKFLOW_ROLE_LABELS.MECHANIC,\n  CASHIER: WORKFLOW_ROLE_LABELS.CASHIER,\n  ACCOUNTANT: WORKFLOW_ROLE_LABELS.ACCOUNTANT,''',
)
replace_once(
    'src/domain/workflow/operating-policy.ts',
    '''const REWORK = ["SHIFT_MASTER", "MECHANIC", "SERVICE_ADVISOR"] as const satisfies readonly WorkflowRole[];\nconst ACCOUNTANT = ["ACCOUNTANT"] as const satisfies readonly WorkflowRole[];''',
    '''const REWORK = ["SHIFT_MASTER", "MECHANIC", "SERVICE_ADVISOR"] as const satisfies readonly WorkflowRole[];\nconst SERVICE_PAYMENT = ["SERVICE_ADVISOR", "CASHIER", "ACCOUNTANT"] as const satisfies readonly WorkflowRole[];\nconst PAYMENT_OPERATORS = ["CASHIER", "ACCOUNTANT"] as const satisfies readonly WorkflowRole[];''',
)
replace_once(
    'src/domain/workflow/operating-policy.ts',
    '''      responsibleRoles: SERVICE,\n      description: "Сервіс-менеджер контролює закриття балансу; оплату проводить каса/бухгалтерія.",''',
    '''      responsibleRoles: SERVICE_PAYMENT,\n      description: "Сервіс-менеджер контролює клієнта й баланс; оплату проводить касир або бухгалтер.",''',
)
replace_once(
    'src/domain/workflow/operating-policy.ts',
    '''function paymentPolicy(definition: WorkflowDefinition): WorkflowDefinition {\n  const overrides = Object.fromEntries(definition.statuses.map((status) => [status.code, { responsibleRoles: ACCOUNTANT }]));''',
    '''function paymentPolicy(definition: WorkflowDefinition): WorkflowDefinition {\n  const overrides = Object.fromEntries(definition.statuses.map((status) => [status.code, { responsibleRoles: PAYMENT_OPERATORS }]));''',
)

# Extend the pending role-catalog migration safely.
p = Path('prisma/migrations/20260820031500_complete_operational_role_catalog/migration.sql')
text = p.read_text()
text = text.replace('''UPDATE "StaffRole"\nSET "name"='Бухгалтер / каса', "updatedAt"=NOW()\nWHERE code='ACCOUNTANT';\nUPDATE "AccessRole"\nSET "name"='Бухгалтер / каса',\n    "description"='Проведення оплат, фінансовий та зарплатний облік по мережі.',\n    "updatedAt"=NOW()\nWHERE code='ACCOUNTANT';\n''', '')
text += r'''
-- Parts/procurement defaults to the employee's station; Owner can widen scope explicitly later.
UPDATE "AccessRolePermission" arp
SET "scope"='LOCATION'::"AccessScope", "updatedAt"=NOW()
FROM "AccessRole" r, "Permission" p
WHERE arp."roleId"=r.id AND arp."permissionId"=p.id
  AND r.code='PARTS_SPECIALIST'
  AND p.code IN ('PARTS.READ','PARTS.WRITE','PROCUREMENT.READ','PROCUREMENT.WRITE');

-- Cashier is station-scoped and intentionally separated from Accountant/payroll.
INSERT INTO "StaffRole" (
  "id","code","name","category","economicsMode","isActive","sortOrder","createdAt","updatedAt"
)
VALUES (
  'staff_role_cashier','CASHIER','Касир','FINANCE','SUPPORT_CAPACITY',true,75,NOW(),NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"=EXCLUDED."name", "category"=EXCLUDED."category", "economicsMode"=EXCLUDED."economicsMode",
  "isActive"=true, "sortOrder"=EXCLUDED."sortOrder", "updatedAt"=NOW();

INSERT INTO "AccessRole" (
  "id","code","name","description","isSystem","isActive","sortOrder","createdAt","updatedAt"
)
VALUES (
  'access_role_cashier','CASHIER','Касир',
  'Приймає та проводить оплату по ЗН своєї станції без доступу до зарплат і глобального P&L.',
  true,true,75,NOW(),NOW()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"=EXCLUDED."name", "description"=EXCLUDED."description", "isActive"=true,
  "sortOrder"=EXCLUDED."sortOrder", "updatedAt"=NOW();

WITH target_role AS (
  SELECT id FROM "AccessRole" WHERE code='CASHIER'
), target_permissions AS (
  SELECT id,code FROM "Permission" WHERE code IN (
    'OVERVIEW.READ','WORK_ORDERS.READ','PAYMENTS.READ','PAYMENTS.WRITE','PAYROLL.SELF_READ'
  )
)
INSERT INTO "AccessRolePermission" ("id","roleId","permissionId","scope","createdAt","updatedAt")
SELECT
  'arp_cashier_' || LEFT(MD5(p.code),20), r.id, p.id,
  CASE WHEN p.code='PAYROLL.SELF_READ' THEN 'SELF'::"AccessScope" ELSE 'LOCATION'::"AccessScope" END,
  NOW(),NOW()
FROM target_role r CROSS JOIN target_permissions p
ON CONFLICT ("roleId","permissionId") DO UPDATE SET
  "scope"=EXCLUDED."scope", "updatedAt"=NOW();
'''
p.write_text(text)

Path('scripts/one-off-separate-cashier-and-scope-parts.py').unlink(missing_ok=True)
Path('.github/workflows/one-off-separate-cashier-and-scope-parts.yml').unlink(missing_ok=True)
