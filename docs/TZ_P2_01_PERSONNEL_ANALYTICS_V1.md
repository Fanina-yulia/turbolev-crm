# TURBO LEV CRM — P2-01 Аналітика персоналу v1

## 1. Мета

Додати до чинного розділу **«Аналітика → СТО / Виробництво»** фактичну аналітику продуктивності персоналу, насамперед механіків, без створення другого паралельного обліку та без вигаданих даних.

Рішення повинно відповідати на управлінські питання:

1. Скільки фактичних робіт завершено кожним механіком?
2. Скільки нормогодин вироблено?
3. Яка ефективність там, де CRM має реальні часові мітки?
4. Яка частка даних взагалі має достатній timing coverage?
5. Який фактичний цикл виконання робіт і частка завершень у плановий строк?
6. Скільки виконаних Work Order мали операційні блокери і скільки часу вони впливали на роботу?
7. Яка частка Work Order пройшла першу QC-перевірку без повторного контролю?
8. Чи можна провалитися від агрегованого KPI до конкретного Work Order?

## 2. Вихідний стан

У CRM вже існують необхідні source-of-truth сутності:

- `ServiceMechanic` — ресурс механіка та зв'язок із `employeeId`;
- `ServiceAppointment` — плановий та фактичний час, механік, пост, Work Order;
- `WorkOrderLine` — labor line, нормогодини, механік, `startedAt`, `completedAt`;
- `OperationalBlocker` — операційний блокер із `createdAt`/`resolvedAt` та прив'язками до appointment / Work Order / line;
- `WorkOrderQualityControl` — QC-спроби з номером `attempt` і результатом;
- Employee Performance Core — `PerformanceEvent`, `AttributionLedgerEntry`, KPI та economics snapshots для подальшої економіки персоналу.

Тому **нова production-міграція БД для P2-01 v1 не потрібна**.

## 3. Архітектурний принцип

Аналітика є read-model поверх чинних операційних фактів. Вона не створює:

- нового таймера механіка;
- окремої таблиці продуктивності;
- дублюючого P&L або payroll ledger;
- ручної оцінки відсутніх даних.

Якщо показник неможливо коректно порахувати, API повертає `null`, а UI показує `—` та/або coverage.

## 4. Scope v1

### 4.1. Загальні фільтри

Панель успадковує чинні глобальні фільтри Analytics:

- `from`;
- `to`;
- `locationId`.

Додаються локальні фільтри:

- механік;
- пост.

Часова зона — `Europe/Kyiv`.

### 4.2. KPI

#### A. Completed labor lines

Кількість `WorkOrderLine`, де:

- `type = LABOR`;
- `status = COMPLETED`;
- `completedAt` входить у період;
- є `mechanicId`;
- це не demo Work Order.

#### B. Work Orders

Кількість унікальних `workOrderId` у завершених labor lines.

#### C. Produced norm-hours

`sum(WorkOrderLine.laborHours)` для завершених labor lines.

#### D. Tracked labor hours

Для labor line, де одночасно є `startedAt` та `completedAt`:

`trackedLaborHours = Σ(completedAt - startedAt)`.

Негативні інтервали не допускаються до підсумку.

#### E. Efficiency

`efficiencyPct = producedNormHours / trackedLaborHours × 100`.

Показник рахується лише якщо `trackedLaborHours > 0`.

Важливо: це **не** зайнятість повної зміни. Це співвідношення нормативного обсягу завершених робіт до фактичного elapsed-time тих labor lines, для яких CRM має обидві часові мітки.

#### F. Timing coverage

`timingCoveragePct = laborLinesWithStartedAndCompleted / completedLaborLines × 100`.

Якщо coverage низький, UI явно попереджає, що ефективність побудована на неповній вибірці.

#### G. Assigned time use

Для appointment:

- planned minutes = перетин `[plannedStartAt, plannedEndAt]` з обраним періодом;
- actual minutes = перетин `[actualStartAt, actualEndAt]` з періодом.

`assignedTimeUsePct = actualAppointmentMinutes / assignedMinutes × 100`.

Цей KPI не називається «завантаженням зміни», доки у CRM немає повного source of truth робочого графіка/доступної продуктивної зміни конкретного працівника.

#### H. Average cycle

Для завершених appointment із `actualStartAt` + `actualEndAt`:

`averageCycleMinutes = avg(actualEndAt - actualStartAt)`.

Окремо повертається `cycleCoveragePct`.

#### I. On-time completion

Для appointment, завершених у періоді:

`onTimePct = count(actualEndAt <= plannedEndAt) / completedAppointments × 100`.

#### J. Blocker exposure

Для `OperationalBlocker`, пов'язаного з Work Order / line / appointment механіка:

- blocker minutes = перетин `[createdAt, resolvedAt || now]` з періодом;
- `blockedWorkOrders` = унікальні виконані Work Order з blocker;
- `blockerOrderRatePct = blockedWorkOrders / workedWorkOrders × 100`.

**Blocker rate не є автоматичним показником вини механіка.** Він показує, що виконання роботи було заблоковано або залежало від зовнішнього/внутрішнього обмеження.

#### K. QC first-pass

Береться `WorkOrderQualityControl` тільки з `attempt = 1`, завершений у періоді.

Terminal statuses для KPI:

- `PASSED`;
- `FAILED`;
- `RECHECK`.

`qcFirstPassPct = firstAttemptPassed / firstAttemptTerminal × 100`.

`qcCoveragePct = firstAttemptTerminal / workedWorkOrders × 100`.

## 5. По механіках

Для кожного механіка показуються:

- завершені роботи;
- Work Order;
- нормогодини;
- tracked labor hours;
- efficiency %;
- timing coverage %;
- assigned hours;
- actual appointment hours;
- assigned time use %;
- average cycle;
- on-time %;
- blocker hours;
- blocked Work Order;
- blocker order rate %;
- QC first-pass %;
- QC coverage count.

Сортування v1: norm-hours DESC → completed jobs DESC → name.

## 6. Drill-down

З таблиці механіків користувач може вибрати механіка і побачити конкретні Work Order.

Для кожного кейсу показуються:

- авто;
- держномер;
- дата/час останньої завершеної labor line;
- blocker count;
- QC first-pass status;
- кнопка переходу в точний Work Order.

Перехід виконується через canonical CRM navigation із `workOrderId`.

## 7. RBAC і data scope

Endpoint: `GET /api/analytics/personnel`.

Серверні вимоги:

1. активна CRM provisioning state;
2. `ANALYTICS.READ`;
3. окремо `ANALYTICS.PERSONNEL_READ`;
4. station/location scope успадковується з access context;
5. запит `locationId` не може розширити дозволений scope;
6. зарплата, ставки та компенсації цим endpoint не повертаються.

UI hiding не вважається security boundary.

## 8. UI

P2-01 v1 додається до **«Аналітика → СТО / Виробництво»**, а не створює дублюючий окремий модуль.

Блоки:

1. фільтри механік / пост;
2. KPI cards;
3. data-quality warning;
4. таблиця механіків;
5. Work Order drill-down;
6. методологія розрахунків.

Семантика кольорів є індикативною для швидкого контролю; рішення щодо оцінки працівника не повинно прийматися лише на підставі одного KPI.

## 9. Non-goals P2-01 v1

Не входять у цей реліз:

- payroll / зарплатні формули;
- розрахунок премії;
- автоматичне рішення «добрий/поганий працівник»;
- true shift utilization без повного графіка працівника;
- гарантійні comeback KPI — це P2-02 / quality analytics;
- ручне присвоєння blocker як вини механіка;
- дублювання Employee Performance Core.

## 10. Acceptance criteria

P2-01 вважається технічно готовим, якщо:

1. `/api/analytics/personnel` проходить RBAC і station scope.
2. Немає нової DB migration.
3. KPI будуються тільки на factual CRM data.
4. Missing timing не оцінюється, а відображається coverage.
5. Efficiency не використовує appointment elapsed як заміну labor-line timing.
6. Blocker KPI використовує canonical `OperationalBlocker`.
7. QC first-pass використовує `attempt = 1`.
8. Є фільтри location/mechanic/post.
9. Є per-mechanic table.
10. Є drill-down до точного Work Order.
11. Salary/payroll data не потрапляють у operational API/UI.
12. Static contract check `scripts/check-personnel-analytics.mjs` входить у production build.
13. Typecheck / Next production build / Vercel preview — PASS.
14. Після merge production deployment — READY.
15. Production smoke підтверджує, що Analytics відкривається без runtime errors і endpoint відповідає згідно RBAC.

## 11. Production gate

P2-01 не закриває P0-07. Фінальний production E2E на 10–20 реальних автомобілях залишається окремим acceptance gate, тому що його не можна достовірно замінити synthetic smoke-тестом.
