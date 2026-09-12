# P1-03 — Vehicle Location: повне технічне завдання

## Мета

Винести фізичне місце автомобіля в окрему операційну сутність. Статус запису, статус Work Order і фізична локація не змішуються: статус описує процес, а VehicleLocation відповідає на питання «де зараз автомобіль».

## Функціональні вимоги

1. Для одного автомобіля існує одна поточна проекція VehicleLocation.
2. Кожна зміна місця створює незмінну VehicleLocationEvent і AuditEvent.
3. Підтримуються зони: OUTSIDE, RECEPTION, QUEUE, POST, PARKING, WAITING_PARTS, QUALITY_CONTROL, READY_ZONE, DELIVERED.
4. Для POST обов’язково перевіряються активність поста, належність до локації та відсутність іншого автомобіля на посту.
5. Операції захищені транзакцією, advisory lock автомобіля/поста та idempotency key.
6. При ARRIVED автомобіль потрапляє в RECEPTION; при IN_REPAIR — на POST або в QUEUE; при WAITING_QC — у QUALITY_CONTROL; при READY_FOR_PICKUP/WAITING_PAYMENT — у READY_ZONE; при COMPLETED — у DELIVERED; при CANCELLED/NO_SHOW — OUTSIDE.
7. Planner board, Work Order transition і картка автомобіля отримують поточну локацію.
8. Операційний користувач може вручну перемістити автомобіль через захищений API.
9. Історія рухів доступна з обмеженням station scope.

## API

- GET /api/vehicles/:id/location — поточна локація.
- GET /api/vehicles/:id/location?history=1 — поточна локація та до 100 подій.
- PATCH /api/vehicles/:id/location — ручне переміщення.

Тіло PATCH: code, serviceLocationId?, servicePostId?, reason?, sourceId?, idempotencyKey?. Для scoped ролі serviceLocationId/postId не можуть виходити за межі доступних локацій.

## Інтеграційні правила

- Planner PATCH синхронізує VehicleLocation після успішної зміни запису.
- Planner DELETE синхронізує CANCELLED → OUTSIDE.
- Work Order status transition синхронізує фізичне місце за статусом та активним записом.
- Неможливість оновити проекцію не відкочує вже успішний бізнес-перехід, але повертається як vehicleLocationSyncWarning і потрапляє в лог для повторної операційної перевірки.

## Acceptance criteria

1. Дві конкурентні спроби зайняти один POST: одна успішна, друга отримує HTTP 409.
2. Повторний PATCH з тим самим Idempotency-Key не створює другу подію.
3. Повторна синхронізація того самого стану не створює шумову подію.
4. Користувач без доступу до локації не читає і не змінює її стан.
5. У production міграція застосовується до генерації Prisma client.
6. CI проходить schema validation, contract smoke, API policy smoke, module scope та production build.
