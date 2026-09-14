# TURBO LEV — ТЗ: жорстке блокування ремонту до рішення по додатковій роботі V2

## 1. Передумова

V1 додаткових робіт створює `DRAFT WorkOrderLine`, `TECHNICAL_DECISION` blocker, повідомлення та `CrmTask` для відповідальних ролей. Для сценарію `BLOCKS_REPAIR` цього недостатньо, якщо механік технічно може продовжити або завершити іншу роботу в тому самому Work Order до рішення.

V2 робить значення **«Ні, потрібне рішення / погодження»** реальним системним стопом.

## 2. Канонічне правило

Якщо в Work Order є активний `OperationalBlocker`:

- `code = TECHNICAL_DECISION`;
- `status = OPEN | ACKNOWLEDGED`;

то виконання ремонту в цьому Work Order не може просуватися далі до рішення.

Заборонені дії механіка:

- `START`;
- `RESUME`;
- `COMPLETE`.

Допустимі дії, які не обходять блокування:

- перегляд;
- коментарі та уточнення;
- фото/докази;
- `PAUSE` / `STOP`, якщо вони ще застосовні;
- робота менеджера з кошторисом і погодженням.

## 3. Автоматичний STOP джерельної роботи

Коли створюється або поновлюється активний `TECHNICAL_DECISION` blocker з `metadata.sourceLineId`, база даних автоматично позначає відповідний `WorkOrderLine` як зупинений у `metadata.mechanicWorkflow`, якщо цей рядок уже `IN_PROGRESS`.

Фіксуються:

- `pausedAt`;
- `pauseReason = CUSTOMER_APPROVAL_REQUIRED`;
- `pauseNote`;
- `stopAt`;
- `stopReason = CUSTOMER_APPROVAL_REQUIRED`;
- `stopNote`;
- `stopStatus = OPEN`;
- `lastAction = STOP`;
- `lastActionAt`.

Статус самого рядка залишається `IN_PROGRESS`, щоб не створювати паралельний статусний довідник: ефективний стан визначається чинним mechanic workflow як `STOPPED`.

Автоматичний STOP створює `AuditEvent` з action `MECHANIC_WORK_AUTO_STOPPED_FOR_APPROVAL`.

## 4. Подвійний захист

### 4.1. API-рівень

`PATCH /api/cabinet/mechanic/tasks/:lineId` перед `START`, `RESUME` або `COMPLETE` перевіряє активний `TECHNICAL_DECISION` по всьому `workOrderId`.

Якщо blocker існує, API повертає:

- HTTP `409`;
- `error = TECHNICAL_DECISION_PENDING`;
- повідомлення про необхідність дочекатися рішення по додатковій роботі/діагностиці.

### 4.2. DB-рівень

PostgreSQL trigger не дозволяє обійти правило через інший endpoint, сервіс або прямий update:

- не дозволяє змінити `WorkOrderLine.status` на `IN_PROGRESS` або `COMPLETED`, поки blocker активний;
- не дозволяє очистити `mechanicWorkflow.stopAt`, поки blocker активний.

Це є системним інваріантом, а не лише UI-обмеженням.

## 5. Розблокування

Погодження або відхилення додаткової позиції використовує V1 lifecycle:

- додаткова позиція `APPROVED` → blocker `RESOLVED`;
- додаткова позиція `CANCELLED` → blocker `CANCELLED`;
- пов'язані `CrmTask` закриваються автоматично.

Після закриття blocker механік **не поновлюється автоматично**. Він виконує штатну дію `RESUME` з чинною перевіркою автомобіля/номера, після чого stop metadata очищується і час паузи враховується існуючим механізмом.

Це виключає небезпечне самовільне автопродовження ремонту після віддаленого погодження.

## 6. UX

У формі `＋ Додати виявлене` постійно показується правило:

> Механік не встановлює ціну і не запускає нову роботу без погодження.

Для `BLOCKS_REPAIR` додатково показується червоне попередження, що подальший ремонт буде заблоковано до рішення.

Мінімальний видимий шрифт — 11 px.

## 7. RBAC і scope

V2 не розширює доступ:

- mechanic endpoint залишається під `PRODUCTION_WRITE` та `ASSIGNED` scope;
- blocker належить тому самому Work Order / локації;
- рішення по кошторису залишається в чинних ролях/permissions;
- механік не отримує права встановлювати клієнтську ціну або самостійно погоджувати позицію.

## 8. Audit

Обов'язково фіксуються:

- створення додаткової потреби;
- відкриття/оновлення `TECHNICAL_DECISION`;
- автоматичний STOP джерельної роботи;
- погодження/скасування додаткової позиції;
- автоматичне закриття blocker/tasks;
- подальший ручний `RESUME` механіком.

## 9. Acceptance Criteria

1. `BLOCKS_REPAIR` створює активний `TECHNICAL_DECISION`.
2. Якщо джерельний рядок був `IN_PROGRESS`, він одразу відображається як фактично зупинений через mechanic workflow metadata.
3. `START` будь-якої механічної роботи цього Work Order блокується, поки decision активний.
4. `RESUME` блокується, поки decision активний.
5. `COMPLETE` блокується, поки decision активний.
6. API повертає 409 `TECHNICAL_DECISION_PENDING` для mechanic lifecycle дій.
7. DB trigger не дає обійти інваріант іншим шляхом.
8. `APPROVED`/`CANCELLED` додаткової позиції закриває blocker чинним V1 lifecycle.
9. Після закриття blocker ремонт не стартує автоматично: потрібен штатний `RESUME` механіка.
10. У UI постійно видно, що механік не встановлює ціну і не запускає нову роботу без погодження.
11. Існуючі V1 суми, ревізії, mixed approval, tasks та Planner navigation не регресують.
12. Prisma migration replay/drift, contract smoke, RBAC/API security і production build проходять.

## 10. Не змінюємо

- модель `WorkOrderLineStatus`;
- модель `OperationalBlocker`;
- чинний estimate approval flow;
- правила фінансового lock/correction;
- правила parts procurement;
- статуси Work Order лише заради цього blocker.

V2 використовує вже наявні сутності й додає лише execution invariant та UX-пояснення.