from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"pattern not found in {path}: {old[:180]!r}")
    p.write_text(text.replace(old, new, 1))

# Service advisor may actually order parts; sales may not change final WorkOrder estimate.
replace_once(
    "src/security/operating-role-policy.ts",
    '''        add: [\n          grant(PERMISSIONS.PARTS_WRITE, "LOCATION"),\n          grant(PERMISSIONS.PAYMENTS_READ, "LOCATION"),\n        ],''',
    '''        add: [\n          grant(PERMISSIONS.PARTS_WRITE, "LOCATION"),\n          grant(PERMISSIONS.PROCUREMENT_WRITE, "LOCATION"),\n          grant(PERMISSIONS.PAYMENTS_READ, "LOCATION"),\n        ],''',
)
replace_once(
    "src/security/operating-role-policy.ts",
    '''    if (role.code === "MECHANIC") {''',
    '''    if (role.code === "HEAD_OF_SALES" || role.code === "SALES") {\n      return patchRole(role, {\n        description: role.code === "HEAD_OF_SALES"\n          ? "Керує воронкою продажів і командою. Фінальний кошторис Замовлення-наряду формує сервіс-менеджер."\n          : "Працює зі зверненнями, лідами й записом. Фінальний кошторис Замовлення-наряду формує сервіс-менеджер.",\n        remove: [PERMISSIONS.WORK_ORDERS_ESTIMATE],\n      });\n    }\n    if (role.code === "MECHANIC") {''',
)

# Persist the same permissions in production DB.
replace_once(
    "prisma/migrations/20260820024500_status_role_alignment/migration.sql",
    '''  SELECT id, code FROM "Permission" WHERE code IN ('PARTS.WRITE', 'PAYMENTS.READ')''',
    '''  SELECT id, code FROM "Permission" WHERE code IN ('PARTS.WRITE', 'PROCUREMENT.WRITE', 'PAYMENTS.READ')''',
)
with Path("prisma/migrations/20260820024500_status_role_alignment/migration.sql").open("a") as fh:
    fh.write(r'''\n\n-- Sales works with the lead funnel; the final WorkOrder estimate belongs to Service Advisor.\nDELETE FROM "AccessRolePermission" arp\nUSING "AccessRole" r, "Permission" p\nWHERE arp."roleId" = r.id\n  AND arp."permissionId" = p.id\n  AND r.code IN ('SALES', 'HEAD_OF_SALES')\n  AND p.code = 'WORK_ORDERS.ESTIMATE';\n''')

# QC UI and compatibility action must say/payment, not ready-for-pickup.
replace_once(
    "app/api/qc/route.ts",
    '''if (!workOrderId || !["START", "PASS", "FAIL", "RECHECK", "MOVE_PICKUP", "MOVE_REWORK"].includes(action)) {''',
    '''if (!workOrderId || !["START", "PASS", "FAIL", "RECHECK", "MOVE_PAYMENT", "MOVE_PICKUP", "MOVE_REWORK"].includes(action)) {''',
)
replace_once(
    "app/api/qc/route.ts",
    '''    if (action === "MOVE_PICKUP" || action === "MOVE_REWORK") {\n      const target = action === "MOVE_PICKUP" ? "READY_FOR_PICKUP" : "REWORK";''',
    '''    if (action === "MOVE_PAYMENT" || action === "MOVE_PICKUP" || action === "MOVE_REWORK") {\n      const target = action === "MOVE_REWORK" ? "REWORK" : "WAITING_PAYMENT";''',
)
replace_once("app/qc-queue.tsx", '"Пройдено → до видачі"', '"Пройдено → до оплати"')
replace_once(
    "app/qc-queue.tsx",
    'onClick={() => void act(card, "MOVE_PICKUP")}>Передати до видачі</button>',
    'onClick={() => void act(card, "MOVE_PAYMENT")}>Передати до оплати</button>',
)

# Shift master opens directly into the QC queue from the role-aware overview.
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

# Human-readable operating contract.
Path("docs/ROLE_STATUS_MATRIX.md").write_text('''# Turbo LEV — статуси та відповідальні ролі\n\nКанонічне правило: **сервіс-менеджер веде клієнта й Замовлення-наряд; механік виконує діагностику та ремонт; Майстер зміни проводить QC; повна оплата передує статусу «Готовий до видачі».**\n\n| Статус | Основна роль | Обов’язкова дія | Наступний нормальний статус |\n|---|---|---|---|\n| Записаний | Продажі / сервіс-менеджер | Підтвердити запис | Приїхав |\n| Приїхав | Сервіс-менеджер | Оформити авто, призначити механіка | Очікує діагностики |\n| Механік проводить діагностику | Автомеханік | Зафіксувати перевірки й технічний висновок | Діагностику прийнято |\n| Кошторис і підбір | Сервіс-менеджер (+ підборщик за призначенням) | Роботи, деталі, допродаж | Очікує погодження |\n| Очікує погодження клієнта | Сервіс-менеджер | Погодити з клієнтом | Очікує запчастини / Готовий до ремонту |\n| Очікує запчастини | Сервіс-менеджер або підборщик | Підібрати, замовити, отримати | Готовий до ремонту |\n| Готовий до ремонту | Сервіс-менеджер | Передати призначеному механіку | У ремонті |\n| У ремонті | Автомеханік | Старт / пауза / завершення призначених робіт | Очікує контроль майстра зміни |\n| Пауза / проблема | Механік + сервіс-менеджер | Усунути блокер | У ремонті / погодження / деталі |\n| Очікує контроль майстра зміни | Майстер зміни | QC PASS/FAIL | Очікує повну оплату / Доопрацювання |\n| Доопрацювання | Механік | Усунути зауваження | У ремонті → QC |\n| Очікує повну оплату | Сервіс-менеджер (контроль) + бухгалтер/каса (проведення) | Закрити баланс | Готовий до видачі |\n| Готовий до видачі | Сервіс-менеджер | Видати автомобіль | Закритий / виданий |\n\n## Межі ролей\n- **SERVICE_ADVISOR:** оформлення, комунікація, фінальний кошторис, погодження, допродаж, підбір і замовлення деталей, контроль оплати, видача.\n- **MECHANIC:** тільки призначені діагностики й ремонт; не проводить QC і не погоджує кошторис з клієнтом.\n- **SHIFT_MASTER:** проводить і підписує QC; не проводить оплату і не змінює кошторис.\n- **PARTS_SPECIALIST:** делегований підбір/закупівлі.\n- **ACCOUNTANT:** проводить оплату; не змінює сервісний статус вручну.\n- **STATION_MANAGER:** операційний контроль станції, але не підміняє Майстра зміни як виконавця QC.\n- **SALES / HEAD_OF_SALES:** воронка, клієнт до запису, попередній прорахунок; фінальний кошторис ЗН — не їхня зона.\n''')

Path("scripts/one-off-status-role-finalize.py").unlink(missing_ok=True)
Path(".github/workflows/one-off-status-role-finalize.yml").unlink(missing_ok=True)
