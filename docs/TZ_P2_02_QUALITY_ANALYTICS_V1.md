# TURBO LEV CRM — P2-02 Аналітика якості v1

## Мета

Побудувати canonical quality-management read model поверх реальних QC та warranty facts. Жоден KPI не повинен підміняти відсутній факт розрахунковою оцінкою.

## Source of truth

- `WorkOrderQualityControl` — спроба QC, `attempt`, terminal result, час завершення.
- `WarrantyClaim` — гарантійне звернення до конкретної виконаної `WorkOrderLine`.
- `WarrantyClaimCostFact` — immutable факт фактичної гарантійної витрати.
- `WarrantyClaim.correctiveWorkOrderId` — опційне посилання на окремий Work Order, яким усувалась гарантія.
- `WorkOrderLine.mechanicId`, code/description, vehicle/workOrder — attribution до механіка, послуги, авто та первинного ремонту.

## Data model v1

### WarrantyClaimCostFact

Поля:
- `warrantyClaimId`;
- `category`: `LABOR | PART | EXTERNAL | OTHER`;
- `amount`;
- `currency` (v1 operational UI — UAH);
- `sourceEntity/sourceEntityId`;
- `supplierId`;
- `note`;
- `recordedByUserId/recordedByName`;
- `recordedAt`.

Факти не редагуються в аналітичному UI. Коригування проводиться новим фактом. Від’ємний факт дозволений тільки з поясненням.

Міграція additive: новий enum, nullable поле в `WarrantyClaim`, нова таблиця та індекси. Існуючі записи не переписуються і не видаляються.

## KPI

### QC First-pass
`PASSED attempt=1 / terminal attempt=1 × 100`.

### QC Defect rate
`(FAILED або RECHECK) attempt=1 / terminal attempt=1 × 100`.

### Rework rate
`Work Order з terminal QC attempt > 1 / Work Order з terminal QC у періоді × 100`.

### Warranty claims / 100 visits
`claims created in period / closed Work Orders in period × 100`.

### Resolution time
Середній `closedAt - createdAt` тільки для terminal warranty claims із фактичним `closedAt`.

### Repeat defect
У v1 repeat defect — claim, для якого до моменту його створення вже існував попередній claim до тієї самої вихідної `WorkOrderLine`. Це вузьке, але фактичне визначення; воно не намагається семантично вгадувати, що різні роботи є однією несправністю.

### Warranty cost
Сума `WarrantyClaimCostFact` у UAH. KPI повертається тільки при 100% cost coverage claims у вибраному cohort. Якщо хоча б один claim не має cost fact, total cost = `null`, UI показує coverage warning.

Первинна ціна клієнта, `plannedUnitPrice`, `actualUnitPrice`, revenue або первинна собівартість не можуть використовуватися як warranty cost.

## Cohort

Глобальні фільтри Analytics:
- from/to, timezone Europe/Kyiv;
- locationId.

Station scope — перетин `ANALYTICS.READ`, `QC.READ`, `WARRANTY.READ`. Запитаний location не може розширити access context.

## RBAC

Quality analytics вимагає:
- `ANALYTICS.READ`;
- `QC.READ`;
- `WARRANTY.READ`.

Запис warranty cost вимагає `WARRANTY.WRITE` і повторно перевіряє station scope claim та corrective Work Order.

## UI

Розділ `Аналітика → СТО / Виробництво`:
1. QC first-pass;
2. QC defect rate;
3. rework rate;
4. claims / 100 visits;
5. resolution time;
6. repeat defect;
7. warranty cost;
8. cost coverage;
9. claim drill-down до Work Order;
10. hotspots по механіках і роботах;
11. форма запису фактичної warranty cost.

## Non-goals v1

- автоматичне визначення вини механіка;
- семантичне об’єднання різних WorkOrderLine у «ту саму» несправність;
- автоматична оцінка гарантійної вартості;
- supplier blame без фактичного supplier attribution;
- автоматичне створення corrective Work Order.

## Acceptance

1. additive migration проходить clean migration history + drift check;
2. quality API server-side захищений RBAC;
3. warranty cost write server-side захищений `WARRANTY.WRITE`;
4. first-pass/rework рахуються тільки по фактичних QC attempts;
5. repeat defect базується на claim history;
6. warranty cost базується тільки на `WarrantyClaimCostFact`;
7. incomplete cost coverage приховує total warranty cost;
8. claim drill-down відкриває exact Work Order;
9. static contract check входить у production build;
10. Module Scope, Prisma validation, migration history, schema drift, typecheck, production build та Vercel preview — PASS;
11. після merge production deployment — READY;
12. production smoke: root 200, unauth quality endpoint 401, runtime error/fatal = 0.
