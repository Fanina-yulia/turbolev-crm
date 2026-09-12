# Turbo LEV CRM — Status Architecture v2

## Мета

Статус у CRM описує життєвий цикл **конкретної сутності**. Не існує одного глобального статусу, який одночасно описує клієнта, автомобіль, запис, ремонт, деталі та оплату.

Ключове правило:

- Client і Vehicle — довгоживучі профілі;
- Inquiry, Lead, Appointment, DiagnosticRequest, WorkOrder, PartsRequest, SupplierOrder, StockReservation, Payment, QualityControl і Warranty мають власні цикли;
- поточний операційний стан автомобіля **вираховується** з активного Appointment/WorkOrder і не редагується вручну як дубль;
- причина очікування — це `Blocker`, а не новий статус;
- фізичне місцезнаходження авто — `VehicleLocation`, а не статус ремонту.

## Master service flow

`Звернення → Кваліфікація → Запис → Приймання → Діагностика → Калькуляція → Погодження → Запчастини → Готовий до ремонту → Ремонт → QC → Оплата → Видача → Післяпродажний/гарантійний контур`

Це master-flow для навігації та аналітики. Джерелом правди на кожному етапі лишається відповідна доменна сутність.

## Сутності

| Entity | Призначення |
|---|---|
| `INQUIRY` | Вхідний контакт до кваліфікації |
| `LEAD` | Комерційний цикл до запису / втрати |
| `CLIENT` | Профіль клієнта |
| `VEHICLE` | Профіль автомобіля |
| `APPOINTMENT` | Плановий запис і факт прибуття |
| `DIAGNOSTIC` | Технічна діагностика до WorkOrder |
| `WORK_ORDER` | Фактичний виробничий процес |
| `PARTS_REQUEST` | Підбір/погодження/отримання деталей |
| `SUPPLIER_ORDER` | Зовнішнє замовлення постачальнику |
| `STOCK_RESERVATION` | Резерв деталей під ремонт |
| `PAYMENT` | Стан конкретного фінансового зобов'язання |
| `QUALITY_CONTROL` | Контроль якості |
| `WARRANTY` | Окремий гарантійний цикл |

## Blocker

`Blocker` відповідає на питання **чому процес не рухається**. Приклади: очікуємо клієнта, оплату, деталі, доставку постачальника, вільний пост, механіка, технічне рішення, сторонню послугу або доопрацювання після QC.

Не створюємо статуси на кшталт `IN_REPAIR_WAITING_CUSTOMER`. Правильно:

- WorkOrder status = `IN_REPAIR` або `PAUSED`;
- blocker = `CUSTOMER_APPROVAL`.

## Vehicle location

Фізична локація авто відокремлена від процесу: `OUTSIDE`, `RECEPTION`, `QUEUE`, `POST`, `PARKING`, `WAITING_PARTS`, `QUALITY_CONTROL`, `READY_ZONE`, `DELIVERED`.

## Hard Gates

Системні переходи можуть мати обов'язкові gates. v1 фіксує такі правила:

1. WorkOrder тільки після підтвердженої діагностики.
2. Ремонт тільки після погодженої калькуляції.
3. Замовлення деталей після потрібної оплати.
4. Для старту ремонту мають бути готові обов'язкові деталі.
5. Для старту ремонту має бути призначений автомеханік.
6. Додаткові платні роботи потребують нового погодження.
7. `READY_FOR_PICKUP` тільки після успішного QC.
8. Видача — після закриття обов'язкового балансу.

## Planner compatibility

Поточний `PlannerAppointmentStatus` історично містить downstream-стани (`DIAGNOSTICS`, `WAITING_PARTS`, `IN_REPAIR`, `WAITING_QC` тощо). У v1 вони позначені `compatibilityOnly`.

Це означає:

- ми **не видаляємо** їх зараз і не ламаємо існуючі записи;
- канонічна відповідальність Appointment у майбутній декомпозиції: `RESERVE / BOOKED / ARRIVED / NO_SHOW / CANCELLED`;
- після `ARRIVED` джерело правди поступово переходить до DiagnosticRequest і WorkOrder.

## Appointment purpose (implemented)

`ServiceAppointment.purpose` розділяє фізичний заїзд на два типи:

- `DIAGNOSTICS` — візит для роботи механіка з шаблоном/перевірками та створенням Діагностичної карти;
- `REPAIR` — візит для виконання WorkOrder та його рядків робіт.

Діагностична карта, підбір запчастин, комерційна пропозиція, погодження та оплата не є новими статусами одного запису. Вони відображаються як окремі доменні процеси. Ремонтний заїзд допускається до прибуття лише як підготовлений слот; при підтвердженні `ARRIVED` він має містити `workOrderId`, інакше CRM зупиняє операцію.

Для старих рядків поле тимчасово nullable. Backfill класифікує записи з WorkOrder як `REPAIR`, записи з точним `DiagnosticVisitLink`/walk-in/старим статусом `DIAGNOSTICS` як `DIAGNOSTICS`; неоднозначні рядки не переписуються мовчки.

Планувальник показує окремо статус запису, статус профільного процесу та фактичний фінансовий статус (`NOT_FORMED`, `UNPAID`, `PARTIAL`, `PAID`, `OVERDUE`, `CANCELLED`). Значення оплати більше не виводиться з `PlannerAppointmentStatus`.

## Legacy WorkOrder

Старий `src/domain/work-order.ts` змішував до одного списку стани Lead, Booking, Diagnostics, Parts, Repair, Payment та Aftersales. v1 звужує WorkOrder до його фактичного життєвого циклу після підтвердженої діагностики. Legacy-значення мають aliases для читання старих даних там, де це безпечно.

## System vs Custom

У v1 всі описані статуси — `system: true`. Майбутній екран **Налаштування → Процеси та статуси** повинен дозволяти для system-status змінювати тільки presentation/config поля (наприклад назву, колір, SLA, видимість), але не видаляти код, на якому побудована бізнес-логіка.

Custom blocker/status можна буде додавати лише у визначених розширюваних зонах.

## API для майбутнього Settings UI

`GET /api/workflow/statuses` — весь каталог.

`GET /api/workflow/statuses?entity=WORK_ORDER` — одна сутність із transitions/gates/actions.

API зараз read-only. Це навмисно: спочатку стабілізуємо доменний контракт, потім додаємо керовані налаштування.

## Automation contract

`actions` у transition v1 є **декларативним контрактом**. Наявність `CREATE_DIAGNOSTIC_REQUEST` або `CREATE_QC_TASK` у registry не означає, що кожна дія вже автоматично виконується production-кодом. Автоматизації підключаються поетапно після перевірки Hard Gates та Audit Log.

## Наступні етапи

1. Перевести presentation labels/status colors усіх екранів на registry.
2. Завершити ручний review неоднозначних legacy-записів із `purpose = NULL`.
3. Типізувати `WorkOrder.status` у БД після аналізу фактичних production-значень.
4. Додати моделі PartsRequest, Payment, QC, Warranty та StockReservation.
5. Додати `Blocker` і `VehicleLocation` до операційного контуру.
6. Реалізувати `Налаштування → Процеси та статуси` поверх цього API.
7. Підключити workflow automation engine та аудит кожного автоматичного переходу.

## Реалізовано у v2.0.0

### Єдиний контракт кодів

Коди, які використовуються одночасно доменом, Планувальником і API-контрактами, тепер оголошені в одному data-only модулі:

- `src/domain/workflow/status-codes.ts`;
- `APPOINTMENT_CANONICAL_STATUS_CODES` — тільки `RESERVE / BOOKED / ARRIVED / NO_SHOW / CANCELLED`;
- `APPOINTMENT_COMPATIBILITY_STATUS_CODES` — історичні downstream-коди, які читаються для сумісності, але не є джерелом правди;
- `WORK_ORDER_STATUS_CODES` — повний канонічний життєвий цикл наряду;
- `PLANNER_STATUS_VALUES` і `PLANNER_BLOCKING_STATUS_VALUES` походять із того самого набору, а не дублюються в сервісному шарі та API-контракті.

`WAITING_PAYMENT` у WorkOrder є канонічним станом фінансового завершення. У Planner `WAITING_PAYMENT` залишається лише compatibility bridge, оскільки Planner не володіє фінансовим станом.

### Єдина проєкція операційного стану

`src/domain/workflow/status-contract.ts` містить `deriveOperationalServiceState()`. Функція повертає read-model, яка не зберігається в БД:

1. якщо є WorkOrder — джерело стану WorkOrder;
2. інакше якщо є DiagnosticRequest — джерело DiagnosticRequest;
3. інакше — Appointment;
4. старий downstream-статус Appointment позначається `compatibilityOnly`.

Поточний стан автомобіля в Планувальнику формується через цю функцію. В API також повертаються `processSource`, `processSourceStatus` і `processCompatibilityOnly`, щоб оператор бачив, звідки походить відображений стан.

### Правила синхронізації

Проміжні переходи WorkOrder більше не переписують `ServiceAppointment.status` у `IN_REPAIR`, `WAITING_QC`, `WAITING_PARTS` тощо. Вони лише:

- залишають Appointment у його канонічному життєвому стані;
- записують фактичний час початку/завершення;
- переводять Appointment у `COMPLETED` або `CANCELLED` тільки на фінальному результаті.

Це усуває дублювання статусів між Планувальником і WorkOrder, не ламаючи читання старих рядків.

### Перевірки

Для контракту додано smoke-тести, які перевіряють:

- канонічний набір Planner;
- compatibility-маркування старих Planner-станів;
- канонічність WorkOrder `WAITING_PAYMENT`;
- пріоритет WorkOrder над DiagnosticRequest і Appointment;
- завершення/скасування Appointment тільки на фінальному WorkOrder-переході.

