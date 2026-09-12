# P1-04 — Складський ledger: повне технічне завдання

## Мета

Перетворити склад з набору supplier JSON і вибраних позицій у фактичний облік: незмінні рухи, поточний залишок, резерв, доступний залишок і контроль списання.

## Модель даних

1. InventoryLedgerEntry — append-only факт руху. Quantity завжди додатна, напрям IN або OUT.
2. InventoryBalance — одна поточна проекція на warehouseKey + stockKey. Поля onHand і reserved.
3. InventoryReservation — поточний резерв для WorkOrder/WorkOrderLine; резерв не змінює onHand.
4. Кожна зміна має AuditEvent, актора, джерело та idempotency key.

## Правила

- Receipt, return та позитивний adjustment збільшують onHand.
- Issue, transfer out та consumption зменшують onHand.
- OUT заборонений, якщо available = onHand - reserved недостатній.
- Consume дозволений для вже зарезервованої кількості та одночасно зменшує onHand і reserved.
- Release/Cancel знімає reserved без руху onHand.
- Конкурентні дії одного stockKey серіалізуються advisory lock.
- Повторний idempotency key повертає первинний факт без дублювання.
- Legacy supplier offers залишаються джерелом пропозицій; тільки InventoryLedgerEntry змінює фактичний склад.

## API

- GET/POST /api/inventory/ledger — журнал, залишки, резерви та проведення руху.
- GET/POST /api/inventory/reservations — список і створення резерву.
- PATCH /api/inventory/reservations/:id — RELEASE, CONSUME або CANCEL.

## Acceptance criteria

1. Receipt 5 шт створює один IN факт і збільшує onHand до 5.
2. Повторний запит з тим самим Idempotency-Key не збільшує залишок вдруге.
3. Issue більшого за available повертає HTTP 409 без створення факту.
4. Reservation збільшує reserved, але не onHand.
5. Release зменшує reserved; Consume створює OUT факт і зменшує обидва залишки.
6. Усі scoped API перевіряють serviceLocationId.
7. Prisma schema, migration drift, contract smoke, policy smoke, module scope та production build проходять у CI.
