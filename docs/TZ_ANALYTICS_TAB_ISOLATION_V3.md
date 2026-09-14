# TURBO LEV CRM — ТЗ: Аналітика V3 · ізоляція вкладок та бізнес-правда

## 1. Мета

Перебудувати розділ `Аналітика` так, щоб кожна вкладка була окремим управлінським кабінетом із власними KPI, причинами відхилень і переходами до операційної дії. Однакові великі аналітичні блоки не повинні дублюватися між вкладками.

Головний принцип: **жодних вигаданих цифр, демо-даних або UI-оцінок, які не мають підтвердженого джерела в CRM**. Якщо показник не може бути коректно отриманий із поточної моделі даних — він не показується або явно позначається як недоступний.

## 2. Інформаційна архітектура

Зберігаються шість основних вкладок:

1. `Загальне`
2. `Воронка`
3. `СТО / Виробництво`
4. `Діагностика`
5. `Фінанси`
6. `Запчастини`

Спільними для всіх вкладок залишаються лише:

- період;
- станція;
- порівняння з попереднім періодом;
- глобальна кнопка `Оновити`.

## 3. Жорстке правило ізоляції вкладок

### 3.1. Заборонено

- рендерити один і той самий великий блок аналітики на всіх вкладках;
- показувати `WALK-IN аналітика` в `СТО / Виробництво`, `Діагностика`, `Фінанси` або `Запчастини` як окрему глобальну панель;
- дублювати окрему кнопку `Оновити` всередині WALK-IN, якщо вже існує глобальне оновлення сторінки;
- показувати статичні/зашиті в коді числа як KPI.

### 3.2. Дозволено

Один бізнес-процес може впливати на різні формули, але представлення має відповідати предмету вкладки. Наприклад, WALK-IN оплата може входити у фінансові події, але на вкладці `Фінанси` вона не повинна відображатися як окрема копія WALK-IN dashboard.

## 4. Призначення кожної вкладки

### 4.1. Загальне

Мета: короткий управлінський огляд власника.

Показуються агреговані KPI поточного Analytics V2: фінансовий результат доступного контуру, приїзди, активні авто, готові до видачі, завантаження постів, прострочення, no-show, погодження, очікування запчастин, ремонт.

WALK-IN на `Загальне` допускається тільки як **компактне резюме**, а не повна аналітика:

- позапланових заїздів;
- оплачено діагностик;
- фактична виручка WALK-IN діагностик;
- кількість записів, що потребують дії (`очікують оплату + оплачено без рішення`).

Дія: `Детально у воронці →` переводить на вкладку `Воронка`.

### 4.2. Воронка

Мета: показати втрати клієнтів між етапами.

Основна воронка залишається: звернення/лід → запис → приїзд → діагностика → КП/ЗН → ремонт → завершення.

Тільки на цій вкладці допускається **повний WALK-IN блок**:

- заїзди;
- дійшли до діагностики;
- оплачено;
- тільки діагностика;
- передано в ремонт;
- завершено;
- очікують оплату;
- оплачено без рішення;
- фактична виручка;
- середній чек.

Проблемні стани мають показувати конкретні записи, а не лише число.

### 4.3. СТО / Виробництво

Мета: керування виробництвом.

Використовуються фактичні `ServiceAppointment`, Work Order та стан постів:

- у роботі;
- у ремонті;
- очікують запчастини;
- очікують погодження;
- готові до видачі;
- прострочені;
- завантаження постів;
- цикл авто;
- причини затримок;
- продуктивність персоналу/якість тільки у відповідних station-scoped панелях.

Окремий WALK-IN dashboard не показується.

### 4.4. Діагностика

Мета: якість і результат діагностичного процесу.

Джерела: `DiagnosticRequest`, `DiagnosticAssignment`, `DiagnosticInspection`, `DiagnosticCheck`, `DiagnosticFinding`, `DiagnosticTemplateItem`.

Показуються фактичні створені/завершені діагностики, findings, критичні дефекти, конверсія в ЗН, середній час, топ несправностей і рекомендацій.

Окремий WALK-IN dashboard не показується. WALK-IN діагностики можуть входити до фактичної діагностичної статистики тільки якщо вони реально присутні у відповідних таблицях.

### 4.5. Фінанси

Мета: P&L, Cash Flow, оборотний капітал та економіка замовлень.

Джерела: `FinancialEvent`, `CashTransaction`, `FinancialObligation`, `MoneyAccount`, `WorkOrderFinanceSnapshot`.

WALK-IN платежі не дублюються окремою панеллю. Якщо вони створені як POSTED `FinancialEvent` / `CashTransaction`, вони беруть участь у відповідних фінансових фактах за правилами фінансового модуля.

### 4.6. Запчастини

Мета: постачання, дефіцит, ETA та економіка запчастин.

Джерела: `PartsRequest`, `PartsRequestItem`, `Supplier`, зв’язки з Work Order / ServiceAppointment.

Окремий WALK-IN dashboard не показується.

## 5. WALK-IN — джерела правди

WALK-IN аналітика формується виключно з реальних записів:

- `ServiceAppointment.source = WALK_IN` — факт позапланового заїзду;
- `DiagnosticVisitLink` — канонічний зв’язок appointment ↔ diagnostic;
- marker `WALK_IN_DIAGNOSTIC:<id>` у comment — тільки backward-compatible fallback для старих записів;
- `CashTransaction.sourceEntity = WALK_IN_DIAGNOSTIC_PAYMENT`, `status = POSTED` — факт оплати;
- `AuditEvent.action = WALK_IN_SENT_TO_REPAIR_FLOW` — факт переходу в ремонт;
- `ServiceAppointment.status / actualStartAt / actualEndAt` — фактичний стан візиту.

Записи з `id` на `demo_` не включаються.

## 6. Формули WALK-IN

- `visits` = кількість реальних WALK_IN appointments у вибраному періоді;
- `diagnosticsReached` = appointment має `actualStartAt` або канонічний/legacy diagnostic link;
- `paid` = кількість linked diagnostics із POSTED payment;
- `sentToRepair` = linked diagnostics із audit `WALK_IN_SENT_TO_REPAIR_FLOW`;
- `completed` = `status = COMPLETED` або `actualEndAt != null`;
- `awaitingPayment` = appointment у `WAITING_PAYMENT` без POSTED payment;
- `awaitingRoute` = appointment у `WAITING_PAYMENT` з POSTED payment;
- `diagnosticRevenue` = сума POSTED WALK-IN diagnostic payments у вибраному наборі;
- `averageDiagnosticCheck` = diagnosticRevenue / кількість POSTED payments;
- `%` = фактичне `part / total`, без synthetic fallback.

## 7. Actionable drill-down

API повертає для `awaitingPayment` та `awaitingRoute` конкретні записи:

- `appointmentId`;
- `diagnosticId`;
- клієнт;
- авто;
- номер;
- дата візиту.

На вкладці `Воронка` ці записи показуються у блоці `Потребує дії`.

Натискання на запис відкриває точний appointment у Планувальнику. Якщо є `diagnosticId`, CRM зберігає можливість перейти до діагностики через стандартну маршрутизацію.

## 8. Права і station scope

Зберігаються поточні правила:

- базово потрібен `ANALYTICS_READ`;
- фінансові значення тільки з `ANALYTICS_FINANCIAL_READ`;
- station-scoped користувач бачить тільки дозволені `locationId`;
- API не повинен віддавати фінансове значення без фінансового permission.

## 9. UX

- один глобальний `Оновити`;
- WALK-IN summary на `Загальне` компактний;
- повний WALK-IN тільки у `Воронка`;
- на інших вкладках WALK-IN host порожній і не займає місце;
- проблемні стани виділяються warning/danger тоном;
- всі видимі тексти відповідають глобальному font floor CRM;
- адаптивність: desktop 4 колонки, tablet 2, mobile 1.

## 10. Технічна реалізація

### Frontend

`AnalyticsDashboardWalkInBridge` стає tab-aware:

- визначає активну вкладку через `nav[aria-label="Розділи аналітики"]`;
- створює окремий host одразу після глобальних фільтрів;
- `overview` → compact summary;
- `funnel` → full WALK-IN + action list;
- `workshop/diagnostics/finance/parts` → `null`.

Внутрішня кнопка refresh видаляється. Дані автоматично оновлюються при зміні періоду/станції та раз на 60 секунд.

### Backend

`/api/analytics/walk-in`:

1. фільтрує реальні `ServiceAppointment(source=WALK_IN)`;
2. визначає diagnostic link через `DiagnosticVisitLink`;
3. використовує comment marker лише як fallback;
4. отримує POSTED payments та repair audits тільки для linked diagnostic IDs;
5. повертає фактичні агрегати та action items;
6. повертає data-quality metadata для контролю canonical/fallback links.

## 11. Регресійні перевірки

Обов’язковий contract smoke перевіряє:

- full WALK-IN не може рендеритися на всіх 6 вкладках;
- дозволені режими тільки `overview-summary` та `funnel-detail`;
- у WALK-IN bridge немає другого `Оновити`;
- backend використовує `DiagnosticVisitLink` як canonical source;
- legacy marker збережений тільки як fallback;
- `demo_` виключені;
- POSTED payment та repair audit залишаються джерелами фінансового/маршрутного факту;
- action items містять точні `appointmentId`/`diagnosticId`;
- інші таби продовжують використовувати власну аналітику.

## 12. Acceptance criteria

Задача вважається DONE тільки якщо:

1. На `Загальне` немає великої копії WALK-IN — лише компактне summary.
2. На `Воронка` є повний WALK-IN блок із фактичними цифрами.
3. На `СТО / Виробництво`, `Діагностика`, `Фінанси`, `Запчастини` WALK-IN блок не відображається.
4. Немає другого refresh усередині WALK-IN.
5. Усі WALK-IN KPI рахуються з production-domain entities, а не static UI values.
6. Canonical `DiagnosticVisitLink` має пріоритет над comment fallback.
7. Проблемні WALK-IN стани дають список конкретних appointment.
8. TypeScript/build/contracts smoke проходять.
9. Зміни merged у `main`.
10. Vercel production deployment має `READY`, після публікації немає нових runtime error/fatal.
