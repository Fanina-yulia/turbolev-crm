# TURBO LEV CRM — Технічне завдання: SQL Scope & Hot Paths Optimization

**Дата:** 2026-10-04  
**Статус:** реалізовано, очікує exact-commit preview validation  
**Гілка:** `perf/sql-scope-hotpaths-20261004`  
**Мета:** зменшити кількість DB round-trips, обсяг ID-масивів у Node.js і навантаження на PostgreSQL у найбільш активних API CRM без зміни бізнес-логіки та без міграції даних.

## 1. Вихідна ситуація

Після попереднього релізу вже оптимізовано deployment pipeline, RBAC cache та polling. Наступним вузьким місцем стали SQL hot paths.

Production runtime logs за останні 24 години показали серед найбільш активних бізнес-API:

- `/api/dashboard` — 36 звернень;
- `/api/communications` — 36;
- `/api/payments` — 18;
- `/api/analytics/owner-dashboard-facts` — 18;
- `/api/analytics` — 18;
- `/api/telephony/live` — 10.

Polling communications/telephony вже знижено попереднім пакетом. У цьому пакеті оптимізуються центральний WorkOrder access scope та dashboard/analytics SQL.

## 2. Проблемний патерн

У кількох місцях scope формувався у два або більше проходів:

```text
PostgreSQL
  ↓ SELECT IDs FROM table A
Node.js
  ↓ [id1, id2, ... idN]
PostgreSQL
  ↓ SELECT ... FROM table B WHERE id IN (...)
Node.js
```

Для великих історичних таблиць це створює:

1. додатковий SQL round-trip;
2. передачу великих масивів через serverless function;
3. велику кількість bind parameters;
4. зайві об'єкти/Set/Map у Node.js;
5. підвищене споживання пам'яті;
6. більшу latency зі зростанням історії CRM;
7. ризик упертися у штучні `take: 5000/10000`;
8. непотрібну матеріалізацію повного scope навіть при перевірці одного WorkOrder.

## 3. Загальний принцип реалізації

Замість:

```sql
SELECT workOrderId FROM ServiceAppointment WHERE ...
-- Node отримує IDs
SELECT * FROM WorkOrder WHERE id IN (...)
```

використовується:

```sql
SELECT ...
FROM "WorkOrder" wo
WHERE EXISTS (
  SELECT 1
  FROM "ServiceAppointment" sa
  WHERE sa."workOrderId" = wo."id"
    AND <scope conditions>
)
```

PostgreSQL сам виконує row-scope, а Node отримує лише фінальний або вже bounded результат.

## 4. Обсяг робіт

### 4.1 Центральний WorkOrder RBAC scope

Файл:

`src/security/work-order-scope.ts`

#### LOCATION

WorkOrder доступний, якщо існує хоча б один `ServiceAppointment`:

- з `workOrderId = WorkOrder.id`;
- у дозволеній користувачу `locationId`.

Реалізація — correlated `EXISTS`.

#### ASSIGNED / SELF / TEAM

Зберігається чинна фактична модель доступу.

WorkOrder доступний, якщо виконується хоча б одна умова:

1. існує appointment, створений поточним CRM user;
2. appointment пов'язаний із Lead, призначеним цьому user;
3. appointment призначений активному `ServiceMechanic`, який пов'язаний із цим user;
4. WorkOrder походить із DiagnosticRequest, Lead якого призначений цьому user.

Усі перевірки виконуються одним SQL через вкладені `EXISTS`.

#### ALL

`ALL` залишається unrestricted.

### 4.2 Single-row authorization

До оптимізації:

```text
canAccessWorkOrder(id)
  ↓
resolve all visible WorkOrder IDs
  ↓
visibleIds.includes(id)
```

Після:

```text
canAccessWorkOrder(id)
  ↓
SELECT wo.id
WHERE wo.id = ?
  AND <scope EXISTS>
LIMIT 1
```

Це прискорює всі endpoints, які перевіряють конкретний WorkOrder:

- WorkOrder card;
- finance;
- documents;
- invoice PDF;
- completion act;
- commercial proposal PDF;
- work-journal photo;
- direct repair;
- document revisions;
- finance finalize.

### 4.3 WorkOrder list

Endpoint:

`GET /api/work-orders`

Scope resolver отримує одразу:

- canonical status;
- фактичний page limit.

Максимальний scoped ID set для звичайного списку — **500**.

Compatibility limit для інших старих викликів resolver — **10 000**, але SQL тепер виконується одним проходом замість lookup chain.

## 5. Dashboard optimization

Endpoint:

`GET /api/dashboard`

### 5.1 Diagnostic counters

До:

```text
DiagnosticAssignment
  ↓ до 5000 diagnosticRequestId
DiagnosticRequest WHERE id IN (...)
  ↓ GROUP BY status
```

Після:

```sql
SELECT dr.status, COUNT(*)
FROM "DiagnosticRequest" dr
WHERE dr.status IN (...)
  AND EXISTS (
    SELECT 1
    FROM "DiagnosticAssignment" da
    WHERE da."diagnosticRequestId" = dr."id"
      AND da."locationId" IN (...)
  )
GROUP BY dr.status
```

### 5.2 Attention center

До:

```text
load attention for entire network
  ↓
appointment IDs
  ↓
second DB query for allowed location
  ↓
filter in Node
```

Після:

```text
allowed locationIds
  ↓
listStationAttentionVehicles(locationIds)
  ↓
ServiceAppointment already scoped in SQL
```

Другий authorization/filtering round-trip видалений.

## 6. Analytics optimization

Endpoint:

`GET /api/analytics`

### 6.1 Lead funnel

До:

1. SELECT усі Lead IDs за період;
2. Node створює `leadIds[]`;
3. SELECT appointments `WHERE leadId IN (...)`;
4. distinct count.

Після — один aggregate SQL:

```sql
COUNT(DISTINCT Lead.id)
COUNT(DISTINCT ServiceAppointment.leadId)
LEFT JOIN ServiceAppointment
```

### 6.2 Location-scoped closed WorkOrders

До:

```text
all appointments for locations across history
→ all scopedWorkOrderIds
→ period WorkOrder query WHERE id IN (...)
```

Після:

```text
WorkOrder period/status filters first
→ EXISTS scoped ServiceAppointment
```

Це принципово важливо: запит більше не залежить від усієї історії WorkOrder локації.

### 6.3 Returning clients

Для cohort клієнтів prior visits шукаються:

- лише для `servedClientIds`;
- лише `closedAt < periodStart`;
- у location scope через `EXISTS`.

### 6.4 Mechanic labor

До — `workOrderId IN(all scoped WorkOrder IDs)`.

Після:

- line type/status/date filters застосовуються першими;
- location підтверджується `EXISTS ServiceAppointment`.

## 7. Owner dashboard facts

Endpoint:

`GET /api/analytics/owner-dashboard-facts`

### 7.1 Open WorkOrders

All-time `scopedWorkOrderRows` видаляється.

Новий запит:

- `WorkOrder.status <> CLOSED`;
- non-demo;
- `EXISTS ServiceAppointment(location scope)`;
- `LIMIT 1000`.

### 7.2 Retention

Period closed orders і prior-client set будуються напряму через location-scoped `EXISTS`.

Node більше не отримує all-time масив WorkOrder IDs для location scope.

## 8. Спільний SQL helper

Файл:

`src/services/location-work-order-query.service.ts`

Відповідає за:

- scoped open WorkOrder IDs;
- scoped closed WorkOrders у періоді;
- scoped prior client IDs;
- scoped completed labor lines.

Вимоги:

- тільки parameterized `Prisma.sql`;
- масиви через `Prisma.join`;
- ніякої SQL string interpolation користувацьких значень;
- explicit empty-scope handling;
- bounded queries там, де повертаються IDs.

## 9. Безпека

Оптимізація не змінює permission model.

Обов'язкові правила:

1. `ALL` — unrestricted.
2. `LOCATION` — лише фактично пов'язані WorkOrders локацій.
3. `ASSIGNED/SELF/TEAM` — чинні factual CRM links.
4. Request-provided WorkOrder ID сам по собі не надає доступ.
5. `canAccessWorkOrder` fail-closed для відсутнього/невідомого scope.
6. SQL параметризований.
7. Немає зміни enforcement mode.
8. Немає зміни Prisma schema.
9. Немає production data mutation.

## 10. CI / build contracts

Новий тест:

`scripts/sql-scope-performance-contract-smoke.mjs`

Перевіряє:

- центральний scope використовує `$queryRaw + EXISTS`;
- старі preloads `serviceMechanic.findMany` / `lead.findMany` у scope видалені;
- `canAccessWorkOrder` використовує `LIMIT 1`;
- WorkOrder list передає bounded limit;
- dashboard не preload-ить DiagnosticAssignment IDs;
- attention приймає location scope на вході;
- analytics не має `scopedWorkOrderIds`;
- lead funnel використовує SQL aggregate;
- owner dashboard не має `scopedWorkOrderRows/scopedWorkOrderIds`;
- shared location SQL helper містить correlated `EXISTS`.

Тест запускається через:

```bash
npm run optimization:smoke
```

та окремо всередині production `npm run build`.

## 11. Acceptance criteria

Реліз дозволений лише якщо:

1. SQL hot-path smoke — PASS.
2. Deployment safety smoke — PASS.
3. RBAC cache smoke — PASS.
4. Adaptive polling smoke — PASS.
5. API security policy smoke — PASS.
6. Next.js production compilation — PASS.
7. Type checking у Next build — PASS.
8. Vercel preview exact commit — READY.
9. Production deployment exact merged commit — READY.
10. Production runtime error/fatal scan після релізу — без нових помилок.
11. У build немає `prisma migrate deploy`.
12. Prisma schema не змінена.

## 12. Що не входить у цей пакет

Навмисно не робиться:

- CREATE INDEX у production;
- зміна schema;
- vacuum/reindex;
- PostgreSQL extension;
- зміна financial formulas;
- зміна retention/business definitions;
- переписування communications/payment UI.

Індекси мають додаватися лише після фактичного `EXPLAIN ANALYZE / pg_stat_statements`, а не припущенням.

## 13. Rollback

Пакет не має DB migration.

Rollback:

1. Vercel rollback на попередній production deployment;
2. DB rollback не потрібен;
3. дані не змінювалися;
4. старий query path повертається разом із application artifact.

## 14. Очікуваний ефект

Без production A/B telemetry не можна чесно назвати конкретний відсоток latency reduction.

Архітектурно пакет прибирає:

- до двох-трьох SQL round-trips у центральному restricted WorkOrder scope;
- повну scope materialization для single-row authorization;
- all-time WorkOrder ID materialization у analytics;
- до 5000 DiagnosticAssignment IDs у dashboard;
- другий DB pass для attention location filtering;
- двокроковий lead funnel lookup.

Ефект має зростати разом із розміром історичних даних, бо period/status filters виконуються в PostgreSQL до передачі результатів у Node.

## 15. Наступний етап

Після релізу рекомендовано:

1. підключити/перевірити `pg_stat_statements` у Neon;
2. зняти top queries за cumulative time і calls;
3. виконати `EXPLAIN (ANALYZE, BUFFERS)` для реальних hot queries;
4. тільки після цього проєктувати composite/partial indexes;
5. перевести `owner-economics`, `management-result` та інші залишкові all-time ID pipelines на той самий `EXISTS` pattern.
