# TURBO LEV CRM — Технічне завдання: Database Runtime Hot Paths V2

**Дата:** 2026-10-04  
**Пакет:** DB Hot Paths V2  
**Гілка реалізації:** `perf/db-hotpaths-20261004`  
**Базовий production commit:** `efd25cf2f85d61c86153997deff8d333c9f839f3`  
**Мета:** оптимізувати залишкові database hot paths на основі фактичних production-планів PostgreSQL, а не припущень; прибрати all-time ID materialization у LTV/owner/management; зменшити непотрібні повні сканування великого MVS-реєстру; не додавати індекси без виміряної користі.

---

## 1. Передумови

Попередній пакет переніс центральний WorkOrder RBAC, dashboard і основні analytics location-scopes із моделі:

```text
DB -> Node.js IDs -> DB WHERE IN (...)
```

на PostgreSQL `EXISTS/JOIN`.

Після цього залишилися три класи потенційних проблем:

1. `owner-analytics-economics` все ще будував all-time список WorkOrder для локації;
2. `customer-ltv` і client-LTV endpoint фільтрували lifetime orders через materialized WorkOrder IDs;
3. `management-result` будував all-time WorkOrder IDs для week fact/cash scope;
4. великий `VehicleRegistryCompact` мав дуже великі накопичені лічильники sequential scans;
5. імпорт MVS після кожного року виконував точний `COUNT(*)` по всьому компактному реєстру.

Завдання цього пакета — перевірити ці місця фактичними production execution plans і оптимізувати лише підтверджені проблеми.

---

## 2. Методика вимірювання

### 2.1 Принцип

Перед зміною схеми/індексів обов'язково:

1. визначити фактичні розміри таблиць;
2. прочитати `pg_stat_user_tables`;
3. перевірити наявні індекси через `pg_indexes`;
4. виконати read-only `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` для безпечних SELECT;
5. не виконувати `ANALYZE` для запиту, який гарантовано сканує багатомільйонну таблицю без необхідності;
6. не додавати індекс, якщо поточний план уже дешевий.

### 2.2 Середовище

Аудит виконано одноразово з Vercel preview build через той самий `DATABASE_URL`, який використовує застосунок.

Аудит:

- тільки SELECT/EXPLAIN;
- не змінює дані;
- не створює extension;
- не створює index;
- не запускає migration;
- видаляється з release-гілки до merge.

### 2.3 PostgreSQL

Фактичне середовище під час аудиту:

- database: `neondb`;
- PostgreSQL: `18.6`;
- `pg_stat_statements`: **не встановлений**.

Через відсутність `pg_stat_statements` неможливо чесно отримати cumulative top queries by total execution time/calls. Тому рішення про індекси базується на:

- table statistics;
- existing indexes;
- точкових current `EXPLAIN ANALYZE`.

У цьому пакеті extension навмисно не вмикається: це окрема operational зміна.

---

## 3. Фактичні production вимірювання

### 3.1 VehicleRegistryCompact

Під час аудиту:

- live rows: приблизно **16 731 946**;
- dead rows: приблизно **1 765 083**;
- total relation size: приблизно **4.01 GB**;
- накопичені `seq_tup_read`: приблизно **117.4 млрд**;
- накопичені `idx_scan`: приблизно **43.5 млн**.

Ці накопичені counters самі по собі не доводять, що current runtime lookup повільний. Тому окремо перевірено execution plans.

### 3.2 Lookup за номером

Запит:

```sql
SELECT ...
FROM "VehicleRegistryCompact"
WHERE "plateKey" = $1
LIMIT 1
```

Фактичний план:

- `Index Scan`;
- index: `VehicleRegistryCompact_pkey`;
- execution: приблизно **2.17 ms**;
- 1 row.

**Рішення:** новий plate index не потрібен.

### 3.3 Lookup за VIN

Запит:

```sql
SELECT ...
FROM "VehicleRegistryCompact"
WHERE vin = $1
ORDER BY "sourceYear" DESC, ...
LIMIT 1
```

Фактичний план:

- `Index Scan`;
- index: `VehicleRegistryCompact_vin_idx`;
- невеликий sort;
- execution: приблизно **2.36 ms**.

**Рішення:** новий VIN index не потрібен.

### 3.4 sourceYear scan

Recovery-запит імпортера:

```sql
SELECT "sourceYear", count(*)
FROM "VehicleRegistryCompact"
WHERE "sourceYear" = ANY(...)
GROUP BY "sourceYear"
```

План показав:

- parallel sequential scan;
- великий обсяг candidate rows.

Цей запит запускається лише при explicit `MVS_RESUME_RECOVERY=true`, тому в цьому релізі він залишається як correctness-oriented batch operation.

Окремий індекс `sourceYear` **не додається**, бо:

- це не runtime CRM path;
- recovery запускається рідко;
- індекс на 16.7 млн rows займає додаткове місце та має write/import cost;
- поточна production проблема не доведена latency telemetry.

### 3.5 ServiceAppointment / WorkOrder analytics

Фактичний location-scoped closed WorkOrder query:

- execution: приблизно **0.94 ms**;
- `ServiceAppointment` мав близько 44 live rows;
- planner обирає дешевий seq scan маленької таблиці + WorkOrder PK lookup.

**Рішення:** додатковий composite index зараз не виправданий.

### 3.6 Diagnostic counts

Фактичний location diagnostic group:

- execution: приблизно **0.10 ms**;
- маленькі `DiagnosticRequest` / `DiagnosticAssignment`.

**Рішення:** індекс не додається.

### 3.7 Labor analytics

Фактичний completed labor scope:

- execution: приблизно **0.05 ms**.

**Рішення:** індекс не додається.

### 3.8 Management cash scope

Цільовий запит location cash scope через direct location OR WorkOrder `EXISTS`:

- використав `CashTransaction_flowSection_occurredAt_idx`;
- execution: приблизно **0.05 ms**.

**Рішення:** існуючий index достатній.

### 3.9 Lead funnel

Aggregate JOIN:

- execution: приблизно **0.10 ms**.

**Рішення:** новий index не потрібен при поточному розмірі даних.

---

## 4. Архітектурне рішення

У цьому пакеті **НЕ створюються нові production indexes**.

Причина: current execution plans не показали runtime query, де новий індекс дасть доведену користь, достатню для компенсації:

- storage;
- write amplification;
- import overhead;
- migration/reindex risk;
- maintenance cost.

Оптимізація робиться на рівні query shape та усунення зайвих повних сканувань.

---

## 5. Owner Economics

Файл:

`src/services/owner-analytics-economics.service.ts`

### До

```text
ServiceAppointment за всю історію location
  -> distinct workOrderId[]
  -> Node.js scopedWorkOrderIds
  -> WorkOrder WHERE id IN (...) AND closedAt in period
```

Проблема: обсяг першого запиту росте з усією історією СТО, хоча owner analytics потрібен конкретний period.

### Після

Для location scope:

```sql
SELECT WorkOrder...
WHERE status='CLOSED'
  AND closedAt BETWEEN period
  AND EXISTS (
    SELECT 1
    FROM ServiceAppointment
    WHERE workOrderId = WorkOrder.id
      AND locationId IN (...)
  )
```

Period filter та status застосовуються до передачі даних у Node.

Для unrestricted `ALL` зберігається звичайний Prisma period query.

---

## 6. Canonical Customer LTV

Файл:

`src/services/customer-ltv.service.ts`

### Новий input

```ts
{
  clientIds: string[];
  locationIds?: string[] | null;
  scopedWorkOrderIds?: string[] | null; // compatibility
  now?: Date;
}
```

### Нова поведінка

Якщо заданий `locationIds`:

```sql
WorkOrder
WHERE clientId IN (...)
  AND status='CLOSED'
  AND closedAt IS NOT NULL
  AND EXISTS (
    ServiceAppointment for same workOrder in allowed location
  )
```

Тобто Node більше не отримує всі lifetime WorkOrders клієнта, щоб потім відкидати недоступні через Set.

Legacy `scopedWorkOrderIds` залишається тільки для compatibility старих caller-ів, але нові owner/client flows його не використовують.

### Незмінні LTV semantics

Не змінюються:

- ACTUAL finance snapshots;
- warranty cost completeness;
- currency completeness;
- lifetime revenue;
- lifetime gross profit;
- lifetime contribution;
- acquisition source semantics;
- coverage rules.

Змінюється лише спосіб вибірки row scope.

---

## 7. Client LTV endpoint

Файл:

`app/api/analytics/client-ltv/[clientId]/route.ts`

### До

Restricted user:

1. SELECT всі distinct workOrderIds клієнта в allowed locations;
2. `take: 10000`;
3. materialize array;
4. передати в LTV;
5. LTV завантажує lifetime orders і фільтрує через Set.

### Після

Для authorization достатньо:

```text
ServiceAppointment.findFirst(...)
```

Перевіряється лише факт, що клієнт має доступний WorkOrder/appointment у station scope.

Після authorization canonical LTV отримує:

```ts
locationIds: context.locationIds
```

і сам формує SQL scope через `EXISTS`.

---

## 8. Management Result

Файл:

`src/services/management-result.service.ts`

### 8.1 Closed orders

До:

```text
all history ServiceAppointment
 -> scopedWorkOrderIds[]
 -> closed WorkOrder current week WHERE id IN (...)
```

Після:

- current week `closedAt` filter;
- `status=CLOSED`;
- location `EXISTS`.

### 8.2 Cash inflows

До:

```text
locationId IN (...)
OR workOrderId IN (all-time scopedWorkOrderIds)
```

Після:

```sql
locationId IN (...)
OR EXISTS (
  SELECT 1
  FROM ServiceAppointment
  WHERE workOrderId = CashTransaction.workOrderId
    AND locationId IN (...)
)
```

Фактичний EXPLAIN цього shape використав існуючий:

`CashTransaction_flowSection_occurredAt_idx`

та виконався приблизно за 0.05 ms.

### 8.3 Що залишається в ID arrays

Допускаються тільки bounded IDs, отримані з поточного тижня/періоду:

- `closedIds`;
- `forecastOrderIds`.

Це не all-time scope materialization і не росте безмежно разом з історією CRM.

---

## 9. Shared location query service

Файл:

`src/services/location-work-order-query.service.ts`

Додаються/розширюються:

- `findLocationScopedClosedWorkOrders()`;
- `findLocationScopedClosedWorkOrdersForClients()`;
- `findLocationScopedCashInflows()`.

Вимоги:

1. parameterized `Prisma.sql`;
2. arrays тільки через `Prisma.join`;
3. empty location/client scope -> empty result;
4. factual relationship через `EXISTS ServiceAppointment`;
5. жодна request-provided WorkOrder ID не створює доступ сама по собі.

---

## 10. MVS import optimization

Файл:

`scripts/import-mvs-open-data.py`

### До

Після кожного успішно імпортованого року:

```sql
SELECT count(*) FROM "VehicleRegistryCompact"
```

На таблиці ~16.7 млн rows це точний full-registry count лише заради progress log.

При імпорті кількох років цей scan повторювався після кожного року.

### Після

Повний count видаляється.

Лог:

```text
<year>: processed N valid rows; compact registry updated
```

Correctness імпорту не залежав від цього count, тому business/data semantics не змінюються.

### Recovery mode

`MVS_RESUME_RECOVERY=true` все ще може виконати grouped `sourceYear` scan.

Це свідомо залишено, бо:

- це explicit recovery path;
- query визначає, які роки вже представлені;
- запуск рідкісний;
- додавання large `sourceYear` index не виправдане current runtime evidence.

---

## 11. Vehicle Model Popularity refresh

Файл:

`src/services/vehicle-images/vehicle-generation-catalog.service.ts`

`refreshTopVehicleModelPopularity()` навмисно робить великий aggregate scan реєстру для побудови top models.

Це admin/manual operation, але два паралельні натискання могли запустити два однакові важкі scans одночасно.

### Нова вимога

На початку transaction:

```sql
SELECT pg_try_advisory_xact_lock(
  hashtext('vehicle-model-popularity-refresh')
)
```

Якщо lock не отримано:

```json
{
  "refreshed": 0,
  "skipped": "ALREADY_RUNNING"
}
```

Другий full scan не запускається.

Перевага advisory transaction lock:

- без нової таблиці;
- без migration;
- auto-release при COMMIT/ROLLBACK/disconnect;
- не залишає persistent lock state.

---

## 12. Індекси: рішення цього релізу

### Не додавати

Не додаються:

- `VehicleRegistryCompact(plateKey)` — вже PK;
- `VehicleRegistryCompact(vin)` — вже є partial VIN index і він реально використовується;
- `ServiceAppointment(locationId, workOrderId)` — current data/plan <1 ms;
- `DiagnosticAssignment(locationId, diagnosticRequestId)` — current plan ~0.1 ms;
- `WorkOrder(status, closedAt)` — current workload не довів необхідність;
- додатковий `CashTransaction` index — current plan використовує існуючий `flowSection, occurredAt`;
- `VehicleRegistryCompact(sourceYear)` — batch-only recovery use не виправдовує large index зараз.

### Правило на майбутнє

Index додається тільки якщо є хоча б одне:

1. `pg_stat_statements` показує істотний cumulative cost;
2. production `EXPLAIN ANALYZE` показує expensive scan при реальному volume;
3. endpoint latency/DB telemetry корелює з query;
4. index tested на production-like branch і дає вимірюване покращення.

---

## 13. pg_stat_statements

Під час аудиту extension відсутній.

У цьому пакеті він не вмикається автоматично.

Причини:

- це database operational setting;
- може вимагати preload/restart/config changes;
- не потрібен для випуску поточної query-shape оптимізації.

Окремий майбутній DB observability пакет може:

1. перевірити Neon-supported спосіб activation;
2. увімкнути extension контрольовано;
3. накопичити representative window;
4. ранжувати queries за total_exec_time/calls/mean_exec_time;
5. після цього запропонувати наступні indexes.

---

## 14. Contract tests

Новий файл:

`scripts/db-hotpath-performance-contract-smoke.mjs`

Перевіряє:

- owner economics не містить `let scopedWorkOrderIds`;
- owner використовує location-scoped period query;
- owner LTV передає `locationIds`;
- canonical LTV підтримує direct location scope;
- client-LTV route не завантажує distinct WorkOrder IDs;
- client-LTV route робить single existence probe;
- management result не materialize-ить all-time WorkOrder scope;
- management cash використовує SQL helper;
- MVS importer більше не робить exact full `COUNT(*)` після року;
- model popularity refresh має advisory lock;
- location helper зберігає `EXISTS` / parameter binding.

Smoke додається до:

- `npm run optimization:smoke`;
- production `npm run build`.

---

## 15. Build / deployment safety

Production build залишається read-only відносно DB.

У final branch:

- немає одноразового audit script;
- немає DB audit виклику в build;
- немає `prisma migrate deploy` у Vercel build;
- немає DDL;
- немає index creation;
- немає production data mutation.

---

## 16. Acceptance criteria

Реліз приймається, якщо одночасно:

1. `db-hotpath-performance-contract-smoke` PASS;
2. попередні deployment/RBAC/polling/SQL-scope smoke PASS;
3. API security smoke PASS;
4. Next.js compile PASS;
5. TypeScript validity PASS;
6. exact-commit Vercel preview READY;
7. preview build не запускає one-off DB audit;
8. Prisma schema не змінена;
9. production deployment exact merged commit READY;
10. production error/fatal scan після deploy не показує нових runtime errors.

---

## 17. Rollback

Пакет не має schema migration.

Rollback:

1. Vercel rollback на попередній production deployment;
2. database rollback не потрібен;
3. index rollback не потрібен;
4. дані не трансформуються;
5. importer повертається разом з application/code artifact.

Advisory lock не потребує rollback: він transaction-scoped і не зберігається.

---

## 18. Очікуваний ефект

### Гарантовано усувається

- all-time location WorkOrder ID materialization у owner economics;
- all-time location WorkOrder ID materialization у client LTV;
- all-time location WorkOrder ID materialization у management result;
- exact full `COUNT(*)` 16.7m-row registry після кожного імпортованого року;
- duplicate concurrent full-registry model-popularity refresh.

### Не заявляється без telemetry

Не заявляється конкретний відсоток acceleration всієї CRM.

Причина: `pg_stat_statements` не доступний, а поточні measured runtime plans уже sub-ms / low-ms. Коректний висновок цього пакета — зменшення асимптотичного росту, DB round-trips і гарантовано зайвих full scans, а не вигаданий “X% faster”.

---

## 19. Наступний рекомендований етап

Після накопичення більшої кількості реальних CRM даних:

1. додати database observability;
2. за можливості активувати `pg_stat_statements`;
3. зібрати representative 7–14 day window;
4. ранжувати cumulative query cost;
5. перевірити top queries через `EXPLAIN (ANALYZE, BUFFERS)`;
6. тільки тоді додавати composite/partial indexes.

Це збереже БД від “index inflation” і дозволить оптимізувати саме те, що реально коштує CPU/IO.
