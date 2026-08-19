from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"pattern not found in {path}: {old[:140]!r}")
    text = text.replace(old, new, 1)
    p.write_text(text)


def replace_all(path: str, old: str, new: str, minimum: int = 1) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count < minimum:
        raise SystemExit(f"expected >= {minimum} occurrences in {path}, found {count}: {old!r}")
    p.write_text(text.replace(old, new))


# 1) Workflow roles must use the same codes as real RBAC.
replace_once(
    "src/domain/workflow/types.ts",
    '''export type WorkflowRole =\n  | "OWNER"\n  | "EXECUTIVE_DIRECTOR"\n  | "SALES"\n  | "SERVICE_MANAGER"\n  | "PARTS_MANAGER"\n  | "MECHANIC"\n  | "QUALITY_CONTROLLER"\n  | "CASHIER_ACCOUNTING"\n  | "ADMIN";''',
    '''export type WorkflowRole =\n  | "OWNER"\n  | "EXECUTIVE_DIRECTOR"\n  | "HEAD_OF_SALES"\n  | "SALES"\n  | "PARTS_SPECIALIST"\n  | "STATION_MANAGER"\n  | "SERVICE_ADVISOR"\n  | "SHIFT_MASTER"\n  | "MECHANIC"\n  | "ACCOUNTANT"\n  | "ADMINISTRATOR";''',
)

replace_once(
    "src/domain/workflow/catalog.ts",
    '''export const WORKFLOW_ROLE_LABELS: Record<WorkflowRole, string> = {\n  OWNER: "Власник",\n  EXECUTIVE_DIRECTOR: "Виконавчий директор",\n  SALES: "Продажі",\n  SERVICE_MANAGER: "Сервіс-менеджмент",\n  PARTS_MANAGER: "Підбір / запчастини",\n  MECHANIC: "Автомеханік",\n  QUALITY_CONTROLLER: "Контроль якості",\n  CASHIER_ACCOUNTING: "Каса / бухгалтерія",\n  ADMIN: "Адміністратор CRM",\n};''',
    '''export const WORKFLOW_ROLE_LABELS: Record<WorkflowRole, string> = {\n  OWNER: "Власник",\n  EXECUTIVE_DIRECTOR: "Виконавчий директор",\n  HEAD_OF_SALES: "Керівник відділу продажів",\n  SALES: "Продажі",\n  PARTS_SPECIALIST: "Підбір / закупівлі",\n  STATION_MANAGER: "Завідувач станцією",\n  SERVICE_ADVISOR: "Сервіс-менеджер",\n  SHIFT_MASTER: "Майстер зміни",\n  MECHANIC: "Автомеханік",\n  ACCOUNTANT: "Бухгалтер / каса",\n  ADMINISTRATOR: "Адміністратор CRM",\n};''',
)
replace_once(
    "src/domain/workflow/catalog.ts",
    'QC_PASSED_BEFORE_READY: "Готовність до видачі тільки після успішного контролю якості",',
    'QC_PASSED_BEFORE_READY: "Перед передачею в оплату контроль якості має бути успішно пройдений",',
)
replace_once(
    "src/domain/workflow/catalog.ts",
    'ZERO_BALANCE_BEFORE_DELIVERY: "Видача автомобіля тільки після закриття обов\'язкового балансу",',
    'ZERO_BALANCE_BEFORE_DELIVERY: "Статус «Готовий до видачі» доступний тільки після повної оплати",',
)

# 2) Canonical workflow responsibilities and payment-before-pickup order.
replace_once(
    "src/domain/workflow/registry.ts",
    '''const SALES = ["SALES"] as const;\nconst SERVICE = ["SERVICE_MANAGER"] as const;\nconst SERVICE_AND_MECHANIC = ["SERVICE_MANAGER", "MECHANIC"] as const;\nconst PARTS = ["PARTS_MANAGER"] as const;\nconst QC = ["QUALITY_CONTROLLER", "SERVICE_MANAGER"] as const;\nconst FINANCE = ["CASHIER_ACCOUNTING", "SERVICE_MANAGER"] as const;''',
    '''const SALES = ["SALES"] as const;\nconst SERVICE = ["SERVICE_ADVISOR"] as const;\nconst SERVICE_AND_MECHANIC = ["SERVICE_ADVISOR", "MECHANIC"] as const;\nconst PARTS = ["SERVICE_ADVISOR", "PARTS_SPECIALIST"] as const;\nconst QC = ["SHIFT_MASTER"] as const;\nconst FINANCE = ["SERVICE_ADVISOR", "ACCOUNTANT"] as const;''',
)
replace_once(
    "src/domain/workflow/registry.ts",
    '"WAITING_PARTS", "READY_FOR_REPAIR", "IN_REPAIR", "WAITING_QC", "READY_FOR_PICKUP", "COMPLETED",',
    '"WAITING_PARTS", "READY_FOR_REPAIR", "IN_REPAIR", "WAITING_QC", "WAITING_PAYMENT", "READY_FOR_PICKUP", "COMPLETED",',
)
replace_once(
    "src/domain/workflow/registry.ts",
    '"WAITING_PARTS", "READY_FOR_REPAIR", "IN_REPAIR", "WAITING_QC", "READY_FOR_PICKUP", "WARRANTY", "PAUSED", "RESERVE",',
    '"WAITING_PARTS", "READY_FOR_REPAIR", "IN_REPAIR", "WAITING_QC", "WAITING_PAYMENT", "READY_FOR_PICKUP", "WARRANTY", "PAUSED", "RESERVE",',
)
replace_all("src/domain/workflow/registry.ts", '["SALES", "SERVICE_MANAGER"]', '["SALES", "SERVICE_ADVISOR"]')
replace_all("src/domain/workflow/registry.ts", '["PARTS_MANAGER", "SERVICE_MANAGER"]', '["PARTS_SPECIALIST", "SERVICE_ADVISOR"]')
replace_all("src/domain/workflow/registry.ts", '["SERVICE_MANAGER", "PARTS_MANAGER"]', '["SERVICE_ADVISOR", "PARTS_SPECIALIST"]')
replace_all("src/domain/workflow/registry.ts", '["SERVICE_MANAGER", "EXECUTIVE_DIRECTOR"]', '["SERVICE_ADVISOR", "EXECUTIVE_DIRECTOR"]')
replace_all("src/domain/workflow/registry.ts", '["PARTS_MANAGER", "MECHANIC"]', '["PARTS_SPECIALIST", "MECHANIC"]')
replace_once(
    "src/domain/workflow/registry.ts",
    '  { code: "WAITING_QC", label: "Очікує контроль якості", stage: "QUALITY_CONTROL", tone: "warning", sortOrder: 280, system: true, blocksResource: true, compatibilityOnly: true },\n  { code: "READY_FOR_PICKUP", label: "Готовий до видачі", stage: "DELIVERY", tone: "success", sortOrder: 290, system: true, blocksResource: true, compatibilityOnly: true },',
    '  { code: "WAITING_QC", label: "Очікує контроль якості", stage: "QUALITY_CONTROL", tone: "warning", sortOrder: 280, system: true, blocksResource: true, compatibilityOnly: true },\n  { code: "WAITING_PAYMENT", label: "Очікує оплату", stage: "PAYMENT", tone: "warning", sortOrder: 285, system: true, blocksResource: true, compatibilityOnly: true },\n  { code: "READY_FOR_PICKUP", label: "Готовий до видачі", stage: "DELIVERY", tone: "success", sortOrder: 290, system: true, blocksResource: true, compatibilityOnly: true },',
)
replace_once(
    "src/domain/workflow/registry.ts",
    '''const diagnosticStatuses: readonly WorkflowStatusDefinition[] = [\n  { code: "PENDING", label: "Очікує діагностики", stage: "DIAGNOSTICS", tone: "warning", sortOrder: 10, system: true, responsibleRoles: SERVICE_AND_MECHANIC },\n  { code: "IN_PROGRESS", label: "Діагностика триває", stage: "DIAGNOSTICS", tone: "accent", sortOrder: 20, system: true, responsibleRoles: SERVICE_AND_MECHANIC },''',
    '''const diagnosticStatuses: readonly WorkflowStatusDefinition[] = [\n  { code: "PENDING", label: "Очікує діагностики", stage: "DIAGNOSTICS", tone: "warning", sortOrder: 10, system: true, responsibleRoles: SERVICE_AND_MECHANIC },\n  { code: "IN_PROGRESS", label: "Діагностика триває", stage: "DIAGNOSTICS", tone: "accent", sortOrder: 20, system: true, responsibleRoles: ["MECHANIC"] },''',
)
replace_once(
    "src/domain/workflow/registry.ts",
    '''const workOrderStatuses: readonly WorkflowStatusDefinition[] = [\n  { code: "PARTS_REVIEW", label: "Опрацювання робіт і деталей", stage: "PARTS", tone: "info", sortOrder: 10, system: true, responsibleRoles: ["SERVICE_ADVISOR", "PARTS_SPECIALIST"] },\n  { code: "WAITING_APPROVAL", label: "Очікує погодження клієнта", stage: "APPROVAL", tone: "warning", sortOrder: 20, system: true, responsibleRoles: SERVICE },\n  { code: "WAITING_PARTS", label: "Очікує запчастини", stage: "PARTS", tone: "warning", sortOrder: 30, system: true, responsibleRoles: ["SERVICE_ADVISOR", "PARTS_SPECIALIST"] },\n  { code: "READY_FOR_REPAIR", label: "Готовий до ремонту", stage: "READY_FOR_REPAIR", tone: "success", sortOrder: 40, system: true, responsibleRoles: SERVICE },\n  { code: "IN_REPAIR", label: "У ремонті", stage: "REPAIR", tone: "accent", sortOrder: 50, system: true, responsibleRoles: SERVICE_AND_MECHANIC },\n  { code: "PAUSED", label: "Призупинений / проблема", stage: "REPAIR", tone: "warning", sortOrder: 60, system: true, responsibleRoles: SERVICE },\n  { code: "WAITING_QC", label: "Очікує контроль якості", stage: "QUALITY_CONTROL", tone: "warning", sortOrder: 70, system: true, responsibleRoles: QC },\n  { code: "REWORK", label: "Повернено на доопрацювання", stage: "REPAIR", tone: "danger", sortOrder: 80, system: true, responsibleRoles: ["SERVICE_MANAGER", "MECHANIC", "QUALITY_CONTROLLER"] },\n  { code: "READY_FOR_PICKUP", label: "Готовий до видачі", stage: "DELIVERY", tone: "success", sortOrder: 90, system: true, responsibleRoles: SERVICE },\n  { code: "WAITING_PAYMENT", label: "Очікує оплату", stage: "PAYMENT", tone: "warning", sortOrder: 100, system: true, responsibleRoles: FINANCE },''',
    '''const workOrderStatuses: readonly WorkflowStatusDefinition[] = [\n  { code: "PARTS_REVIEW", label: "Кошторис / роботи / деталі", stage: "PARTS", tone: "info", sortOrder: 10, system: true, responsibleRoles: PARTS },\n  { code: "WAITING_APPROVAL", label: "Очікує погодження клієнта", stage: "APPROVAL", tone: "warning", sortOrder: 20, system: true, responsibleRoles: SERVICE },\n  { code: "WAITING_PARTS", label: "Очікує запчастини", stage: "PARTS", tone: "warning", sortOrder: 30, system: true, responsibleRoles: PARTS },\n  { code: "READY_FOR_REPAIR", label: "Готовий до ремонту", stage: "READY_FOR_REPAIR", tone: "success", sortOrder: 40, system: true, responsibleRoles: SERVICE },\n  { code: "IN_REPAIR", label: "У ремонті", stage: "REPAIR", tone: "accent", sortOrder: 50, system: true, responsibleRoles: ["MECHANIC"] },\n  { code: "PAUSED", label: "Призупинений / проблема", stage: "REPAIR", tone: "warning", sortOrder: 60, system: true, responsibleRoles: SERVICE_AND_MECHANIC },\n  { code: "WAITING_QC", label: "Очікує контроль якості", stage: "QUALITY_CONTROL", tone: "warning", sortOrder: 70, system: true, responsibleRoles: QC },\n  { code: "REWORK", label: "Повернено на доопрацювання", stage: "REPAIR", tone: "danger", sortOrder: 80, system: true, responsibleRoles: ["MECHANIC", "SHIFT_MASTER", "SERVICE_ADVISOR"] },\n  { code: "WAITING_PAYMENT", label: "Очікує оплату", stage: "PAYMENT", tone: "warning", sortOrder: 90, system: true, responsibleRoles: FINANCE },\n  { code: "READY_FOR_PICKUP", label: "Готовий до видачі", stage: "DELIVERY", tone: "success", sortOrder: 100, system: true, responsibleRoles: SERVICE },''',
)
replace_once(
    "src/domain/workflow/registry.ts",
    '      transition("WAITING_QC", "READY_FOR_PICKUP"), transition("READY_FOR_PICKUP", "COMPLETED", { actions: ["CLOSE_APPOINTMENT"] }),',
    '      transition("WAITING_QC", "WAITING_PAYMENT"), transition("WAITING_PAYMENT", "READY_FOR_PICKUP"), transition("READY_FOR_PICKUP", "COMPLETED", { actions: ["CLOSE_APPOINTMENT"] }),',
)
replace_once(
    "src/domain/workflow/registry.ts",
    '''      transition("WAITING_QC", "READY_FOR_PICKUP", { gates: ["QC_PASSED_BEFORE_READY"], actions: ["SET_VEHICLE_LOCATION_READY"] }), transition("WAITING_QC", "REWORK"),\n      transition("REWORK", "IN_REPAIR"),\n      transition("READY_FOR_PICKUP", "WAITING_PAYMENT"), transition("READY_FOR_PICKUP", "CLOSED", { gates: ["QC_PASSED_BEFORE_READY", "ZERO_BALANCE_BEFORE_DELIVERY"], actions: ["CLOSE_WORK_ORDER"] }),\n      transition("WAITING_PAYMENT", "READY_FOR_PICKUP"), transition("WAITING_PAYMENT", "CLOSED", { gates: ["ZERO_BALANCE_BEFORE_DELIVERY"], actions: ["CLOSE_WORK_ORDER"] }),''',
    '''      transition("WAITING_QC", "WAITING_PAYMENT", { gates: ["QC_PASSED_BEFORE_READY"] }), transition("WAITING_QC", "REWORK"),\n      transition("REWORK", "IN_REPAIR"),\n      transition("WAITING_PAYMENT", "READY_FOR_PICKUP", { gates: ["ZERO_BALANCE_BEFORE_DELIVERY"], actions: ["SET_VEHICLE_LOCATION_READY"] }),\n      transition("READY_FOR_PICKUP", "CLOSED", { gates: ["QC_PASSED_BEFORE_READY", "ZERO_BALANCE_BEFORE_DELIVERY"], actions: ["CLOSE_WORK_ORDER"] }),''',
)

# 3) Planner mirrors real WorkOrder payment state instead of calling it ready too early.
replace_once(
    "src/services/planner.service.ts",
    '  "WAITING_QC",\n  "READY_FOR_PICKUP",',
    '  "WAITING_QC",\n  "WAITING_PAYMENT",\n  "READY_FOR_PICKUP",',
)
replace_once(
    "src/services/planner.service.ts",
    '  "WAITING_QC",\n  "READY_FOR_PICKUP",\n  "COMPLETED",',
    '  "WAITING_QC",\n  "WAITING_PAYMENT",\n  "READY_FOR_PICKUP",\n  "COMPLETED",',
)

# 4) WorkOrder finance finalization happens after QC, before payment; ready zone only after zero balance.
replace_once(
    "src/services/work-orders.service.ts",
    'if (normalizedFrom === "WAITING_QC" && requested === "READY_FOR_PICKUP") {',
    'if (normalizedFrom === "WAITING_QC" && requested === "WAITING_PAYMENT") {',
)
replace_once(
    "src/services/work-orders.service.ts",
    '    WAITING_QC: "WAITING_QC",\n    READY_FOR_PICKUP: "READY_FOR_PICKUP",\n    WAITING_PAYMENT: "READY_FOR_PICKUP",',
    '    WAITING_QC: "WAITING_QC",\n    WAITING_PAYMENT: "WAITING_PAYMENT",\n    READY_FOR_PICKUP: "READY_FOR_PICKUP",',
)

# 5) QC pass means "to payment", never "ready for pickup".
replace_once(
    "app/api/qc/route.ts",
    'if (!workOrderId || !["START", "PASS", "FAIL", "RECHECK", "MOVE_PICKUP", "MOVE_REWORK"].includes(action)) {',
    'if (!workOrderId || !["START", "PASS", "FAIL", "RECHECK", "MOVE_PAYMENT", "MOVE_PICKUP", "MOVE_REWORK"].includes(action)) {',
)
replace_once(
    "app/api/qc/route.ts",
    '    if (action === "MOVE_PICKUP" || action === "MOVE_REWORK") {\n      const target = action === "MOVE_PICKUP" ? "READY_FOR_PICKUP" : "REWORK";',
    '    if (action === "MOVE_PAYMENT" || action === "MOVE_PICKUP" || action === "MOVE_REWORK") {\n      const target = action === "MOVE_REWORK" ? "REWORK" : "WAITING_PAYMENT";',
)
replace_once(
    "app/api/qc/route.ts",
    'workOrder = await transitionWorkOrder(workOrderId, action === "PASS" ? "READY_FOR_PICKUP" : "REWORK", actorName);',
    'workOrder = await transitionWorkOrder(workOrderId, action === "PASS" ? "WAITING_PAYMENT" : "REWORK", actorName);',
)
replace_once(
    "app/qc-queue.tsx",
    '"Пройдено → до видачі"',
    '"Пройдено → до оплати"',
)
replace_once(
    "app/qc-queue.tsx",
    'onClick={() => void act(card, "MOVE_PICKUP")}>Передати до видачі</button>',
    'onClick={() => void act(card, "MOVE_PAYMENT")}>Передати до оплати</button>',
)

# 6) A fully paid WorkOrder automatically becomes ready for pickup.
replace_once(
    "app/api/work-orders/[id]/payments/route.ts",
    'import { NextResponse } from "next/server";\nimport { WorkOrderFinanceValidationError } from "@/src/domain/work-order-finance";',
    'import { NextResponse } from "next/server";\nimport { WorkOrderFinanceValidationError } from "@/src/domain/work-order-finance";\nimport { getPrisma } from "@/src/lib/prisma";\nimport { transitionWorkOrder } from "@/src/services/work-orders.service";',
)
replace_once(
    "app/api/work-orders/[id]/payments/route.ts",
    '''    const result = await recordWorkOrderPayment(id, body, actorName);\n    return NextResponse.json({ ok: true, ...result });''',
    '''    const result = await recordWorkOrderPayment(id, body, actorName);\n    let workOrder = null;\n    let workflowWarning = null;\n    if (result.obligation?.status === "PAID") {\n      const current = await getPrisma().workOrder.findUnique({ where: { id }, select: { status: true } });\n      if (current?.status === "WAITING_PAYMENT") {\n        try {\n          workOrder = await transitionWorkOrder(id, "READY_FOR_PICKUP", actorName);\n        } catch (error) {\n          workflowWarning = error instanceof Error ? error.message : "READY_FOR_PICKUP_TRANSITION_FAILED";\n        }\n      }\n    }\n    return NextResponse.json({ ok: true, ...result, workOrder, workflowWarning });''',
)

# 7) Actual RBAC presets: service advisor can handle parts/procurement; shift master owns QC;
# sales cannot edit final WorkOrder estimate; parts specialist defaults to location scope.
replace_once(
    "src/security/access-matrix-catalog.ts",
    'grant(PERMISSIONS.WORK_ORDERS_READ,"ALL"), grant(PERMISSIONS.WORK_ORDERS_ESTIMATE,"TEAM"),',
    'grant(PERMISSIONS.WORK_ORDERS_READ,"ALL"),',
)
replace_once(
    "src/security/access-matrix-catalog.ts",
    'grant(PERMISSIONS.PLANNER_READ,"LOCATION"), grant(PERMISSIONS.PLANNER_WRITE,"ASSIGNED"), grant(PERMISSIONS.WORK_ORDERS_READ,"ASSIGNED"),\n    grant(PERMISSIONS.WORK_ORDERS_ESTIMATE,"ASSIGNED"), grant(PERMISSIONS.PAYROLL_SELF_READ,"SELF"),',
    'grant(PERMISSIONS.PLANNER_READ,"LOCATION"), grant(PERMISSIONS.PLANNER_WRITE,"ASSIGNED"), grant(PERMISSIONS.WORK_ORDERS_READ,"ASSIGNED"),\n    grant(PERMISSIONS.PAYROLL_SELF_READ,"SELF"),',
)
replace_once(
    "src/security/access-matrix-catalog.ts",
    'grant(PERMISSIONS.OVERVIEW_READ,"LOCATION"), grant(PERMISSIONS.WORK_ORDERS_READ,"LOCATION"), grant(PERMISSIONS.PARTS_READ,"ALL"),\n    grant(PERMISSIONS.PARTS_WRITE,"ALL"), grant(PERMISSIONS.PROCUREMENT_READ,"ALL"), grant(PERMISSIONS.PROCUREMENT_WRITE,"ALL"), grant(PERMISSIONS.PAYROLL_SELF_READ,"SELF"),',
    'grant(PERMISSIONS.OVERVIEW_READ,"LOCATION"), grant(PERMISSIONS.WORK_ORDERS_READ,"LOCATION"), grant(PERMISSIONS.PARTS_READ,"LOCATION"),\n    grant(PERMISSIONS.PARTS_WRITE,"LOCATION"), grant(PERMISSIONS.PROCUREMENT_READ,"LOCATION"), grant(PERMISSIONS.PROCUREMENT_WRITE,"LOCATION"), grant(PERMISSIONS.PAYROLL_SELF_READ,"SELF"),',
)
replace_once(
    "src/security/access-matrix-catalog.ts",
    'grant(PERMISSIONS.WORK_ORDERS_ESTIMATE,"LOCATION"), grant(PERMISSIONS.PRODUCTION_READ,"LOCATION"), grant(PERMISSIONS.QC_READ,"LOCATION"), grant(PERMISSIONS.PARTS_READ,"LOCATION"),\n    grant(PERMISSIONS.PROCUREMENT_READ,"LOCATION"), grant(PERMISSIONS.WARRANTY_READ,"LOCATION"), grant(PERMISSIONS.PAYROLL_SELF_READ,"SELF"),',
    'grant(PERMISSIONS.WORK_ORDERS_ESTIMATE,"LOCATION"), grant(PERMISSIONS.PRODUCTION_READ,"LOCATION"), grant(PERMISSIONS.QC_READ,"LOCATION"), grant(PERMISSIONS.PARTS_READ,"LOCATION"),\n    grant(PERMISSIONS.PARTS_WRITE,"LOCATION"), grant(PERMISSIONS.PROCUREMENT_READ,"LOCATION"), grant(PERMISSIONS.PROCUREMENT_WRITE,"LOCATION"),\n    grant(PERMISSIONS.PAYMENTS_READ,"LOCATION"), grant(PERMISSIONS.WARRANTY_READ,"LOCATION"), grant(PERMISSIONS.WARRANTY_WRITE,"LOCATION"), grant(PERMISSIONS.PAYROLL_SELF_READ,"SELF"),',
)
replace_once(
    "src/security/access-matrix-catalog.ts",
    '''  { code: "MECHANIC", name: "Автомеханік", description: "Призначені діагностики й роботи, виробництво, графік та власна зарплата.", sortOrder: 70, grants: [''',
    '''  { code: "SHIFT_MASTER", name: "Майстер зміни", description: "Контроль завершеного ремонту, QC і повернення авто на доопрацювання в межах своєї станції.", sortOrder: 68, grants: [\n    grant(PERMISSIONS.OVERVIEW_READ,"LOCATION"), grant(PERMISSIONS.PLANNER_READ,"LOCATION"), grant(PERMISSIONS.DIAGNOSTICS_READ,"LOCATION"),\n    grant(PERMISSIONS.WORK_ORDERS_READ,"LOCATION"), grant(PERMISSIONS.PRODUCTION_READ,"LOCATION"), grant(PERMISSIONS.QC_READ,"LOCATION"), grant(PERMISSIONS.QC_WRITE,"LOCATION"),\n    grant(PERMISSIONS.PARTS_READ,"LOCATION"), grant(PERMISSIONS.PERSONNEL_READ,"LOCATION"), grant(PERMISSIONS.PAYROLL_SELF_READ,"SELF"),\n  ]},\n  { code: "MECHANIC", name: "Автомеханік", description: "Призначені діагностики й роботи, виробництво, графік та власна зарплата.", sortOrder: 70, grants: [''',
)

# Shift master gets a QC-first home cabinet.
replace_once(
    "app/role-cabinet.tsx",
    'import { StationOverview } from "./station-overview";\nimport { MechanicMobileCabinet } from "./mechanic-mobile-cabinet";',
    'import { StationOverview } from "./station-overview";\nimport { MechanicMobileCabinet } from "./mechanic-mobile-cabinet";\nimport { QcQueue } from "./qc-queue";',
)
replace_once(
    "app/role-cabinet.tsx",
    '  if (roleCodes.has("OWNER") || roleCodes.has("EXECUTIVE_DIRECTOR") || !specialRole || access?.provisioningState !== "ACTIVE") return <StationOverview />;',
    '  if (roleCodes.has("SHIFT_MASTER") && access?.provisioningState === "ACTIVE") return <QcQueue />;\n  if (roleCodes.has("OWNER") || roleCodes.has("EXECUTIVE_DIRECTOR") || !specialRole || access?.provisioningState !== "ACTIVE") return <StationOverview />;',
)
replace_once(
    "app/role-cabinet.tsx",
    '  WAITING_QC: "Очікує QC",\n  READY_FOR_PICKUP: "Готовий до видачі",',
    '  WAITING_QC: "Очікує QC",\n  WAITING_PAYMENT: "Очікує оплату",\n  READY_FOR_PICKUP: "Готовий до видачі",',
)

# 8) Persistent roles/permissions in production DB.
migration = Path("prisma/migrations/20260820031000_status_role_alignment")
migration.mkdir(parents=True, exist_ok=True)
migration.joinpath("migration.sql").write_text(r'''-- Turbo LEV status/role alignment
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
''')

# 9) Human-readable operating matrix kept with code.
Path("docs/ROLE_STATUS_MATRIX.md").write_text('''# Turbo LEV — матриця статусів і відповідальності\n\nКанонічне правило: сервіс-менеджер веде клієнта і ЗН; механік виконує діагностику/ремонт; майстер зміни проводить QC; готовність до видачі настає тільки після повної оплати.\n\n| Етап / статус | Основна роль | Дія | Наступний статус | Блокер |\n|---|---|---|---|---|\n| Записаний | Сервіс-менеджер / продажі | Підтвердити запис | Приїхав | клієнт не приїхав |\n| Приїхав | Сервіс-менеджер | Оформити авто, призначити діагностику | Очікує діагностики | немає механіка |\n| Діагностика триває | Автомеханік | Виконати перевірки, зафіксувати висновок | Діагностику підтверджено | технічне рішення |\n| Кошторис / роботи / деталі | Сервіс-менеджер (+ підборщик за призначенням) | Сформувати роботи, підібрати деталі, допродати | Очікує погодження | неповний кошторис |\n| Очікує погодження клієнта | Сервіс-менеджер | Погодити з клієнтом | Очікує запчастини / Готовий до ремонту | погодження клієнта |\n| Очікує запчастини | Сервіс-менеджер або підборщик | Замовити/отримати | Готовий до ремонту | деталі відсутні |\n| Готовий до ремонту | Сервіс-менеджер | Передати призначеному механіку | У ремонті | механік/пост/деталі/погодження |\n| У ремонті | Автомеханік | Почати/виконати/завершити роботи | Очікує контроль якості | додаткові роботи/деталі |\n| Призупинений / проблема | Автомеханік + сервіс-менеджер | Усунути блокер | У ремонті / погодження / деталі | причина паузи |\n| Очікує контроль якості | Майстер зміни | Провести QC | Очікує оплату / Доопрацювання | QC не пройдено |\n| Доопрацювання | Автомеханік | Усунути зауваження QC | У ремонті → QC | зауваження майстра зміни |\n| Очікує оплату | Сервіс-менеджер + бухгалтер/каса | Отримати повну оплату | Готовий до видачі | залишок > 0 |\n| Готовий до видачі | Сервіс-менеджер | Видати автомобіль | Закритий / виданий | нульовий баланс + QC |\n| Закритий / виданий | Сервіс-менеджер | Післяпродажний супровід | — | — |\n\n## Ролі\n- **Сервіс-менеджер (SERVICE_ADVISOR):** клієнт, оформлення, кошторис, погодження, допродаж, підбір/закупівля деталей, контроль оплати, видача.\n- **Автомеханік (MECHANIC):** тільки призначені діагностики та роботи; старт/пауза/завершення ремонту.\n- **Майстер зміни (SHIFT_MASTER):** незалежний QC, PASS/FAIL, повернення на доопрацювання.\n- **Підборщик запчастин (PARTS_SPECIALIST):** делегований підбір/закупівлі в межах станції; scope може бути розширений власником.\n- **Бухгалтер (ACCOUNTANT):** проведення оплат і фінансовий облік; сервіс-менеджер бачить стан оплати, але не отримує право проводити фінансові операції.\n- **Завідувач станцією (STATION_MANAGER):** операційний нагляд та право втручання в межах своєї станції.\n- **Власник / виконавчий директор:** повний управлінський доступ, але не є операційною відповідальною роллю конкретного етапу.\n''')

# self-cleanup: the workflow commits only product changes.
Path("scripts/one-off-status-role-alignment.py").unlink(missing_ok=True)
Path(".github/workflows/one-off-status-role-alignment.yml").unlink(missing_ok=True)
