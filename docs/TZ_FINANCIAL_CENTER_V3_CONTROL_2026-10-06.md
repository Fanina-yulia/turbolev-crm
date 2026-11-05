# TURBO LEV CRM — Financial Center V3: Control, Drill-down and Role-aware UX

**Дата:** 2026-10-06  
**Гілка:** `feat/financial-center-v3-control-20261006`

## 1. Мета

Перетворити «Фінансовий центр» із набору однакових KPI та бухгалтерських таблиць на робочий центр управління грошима СТО.

Ключове правило: кожна цифра має відповідати на три питання:

1. **Що це?**
2. **За який період / на який момент?**
3. **З яких конкретних фактів вона складається?**

## 2. Джерела істини

- **P&L / нарахований дохід і витрати:** `FinancialEvent(status=POSTED)`.
- **Рух грошей:** `CashTransaction(status=POSTED)`.
- **Дебіторка / кредиторка:** `FinancialObligation`.
- **Фактична економіка ЗН:** `WorkOrderFinanceSnapshot(kind=ACTUAL)`.
- **План:** `FinancialBudget`.
- **Прогноз:** `FinancialObligation + RecurringFinancialRule + FinancialForecastItem`.
- **Залишок рахунків:** opening balance + POSTED CashTransaction.
- **Касове закриття:** новий `FinancialCashClose`; цей запис не змінює ledger, а фіксує фактичний перерахунок і розбіжність.

## 3. Архітектура сторінки

### 3.1 Глобальна зона

На всіх вкладках залишаються тільки:

- заголовок;
- вкладки;
- «Оновити»;
- «+ Додати операцію»;
- кнопка ⚙ «Налаштування»;
- вибір СТО;
- вибір періоду тільки там, де період має сенс.

### 3.2 Період не показувати

Період не показувати на:

- «Рахунки» — це поточні залишки;
- модальному центрі «Налаштування».

### 3.3 Контекстні KPI

Глобальні 8 KPI більше не повторюються на кожній вкладці.

**Огляд:**  
Залишок зараз / Виручка / Валовий прибуток / Чистий прибуток / Надійшло / Витрачено / Нам винні / Ми винні.

**Прибуток (P&L):**  
Виручка / COGS / Валовий прибуток / OPEX / Чистий прибуток / Маржа.

**Рух грошей:**  
Надійшло / Витрачено / Net Cash Flow / Поточний залишок.

**План / факт:**  
План виручки / Факт / Виконання / Прогноз темпу.

**Платіжний календар:**  
Поточний залишок / Очікувані надходження / Майбутні виплати / Мінімальний прогноз.

**Борги:**  
Дебіторка / Прострочена дебіторка / Кредиторка / Прострочена кредиторка.

**Прибутковість:**  
Середня валова маржа / Найприбутковіший ЗН / Збиткових ЗН / Запчастини нижче порогу маржі.

**Витрати:**  
Витрати P&L за період / Cash outflow за період / До оплати / Прострочено.

**Рахунки:**  
Загальний залишок + окремо Каса / POS / Банк.

## 4. Drill-down: «звідки ця цифра»

KPI на огляді та вкладках відкривають деталізацію.

### Виручка
Показати POSTED `FinancialEvent(REVENUE)`:
- дата;
- опис;
- категорія;
- сума;
- WorkOrder ID;
- sourceEntity.

### Залишок грошей
Показати активні `MoneyAccount`:
- Каса;
- POS;
- Банк;
- opening balance;
- поточний баланс.

### Витрати
Показати P&L events секцій COGS/OPEX/OTHER_EXPENSE/TAX.

### Дебіторка / кредиторка
Показати obligations:
- контрагент;
- вид;
- сума;
- сплачено;
- залишок;
- due date;
- прострочення;
- WorkOrder ID.

### Прибуток
Показати компоненти P&L, а не видавати похідну цифру за одну транзакцію.

## 5. «Сьогодні» як операційний блок

На вкладці «Огляд» незалежно від вибраного довгого періоду показувати окремий блок «Сьогодні»:

- нараховано виручки сьогодні;
- отримано грошей сьогодні;
- витрачено грошей сьогодні;
- Net Cash Flow сьогодні;
- нової дебіторки сьогодні;
- погашено дебіторки сьогодні.

Часова зона: `Europe/Kyiv`.

## 6. Контроль фінансових розбіжностей

Новий блок «Звірка фінансів».

Статус:
- ✅ «Фінанси узгоджені»;
- ⚠ «Є N розбіжностей»;
- 🔴 критичний статус, якщо є порушення інваріантів.

Перевірки:

1. `PAID` obligation, але `settledAmount < amount`.
2. OPEN/PARTIALLY_PAID obligation, але `settledAmount >= amount`.
3. `settledAmount > amount`.
4. WALK-IN payment без corresponding revenue event.
5. WALK-IN revenue event без receivable.
6. WALK-IN paid receivable без payment.
7. POSTED payment with obligation mismatch, коли це можна перевірити без хибних позитивів.

У UI показувати:
- код;
- зрозумілу назву;
- кількість;
- суму, якщо доречно;
- до 10 прикладів entity IDs.

Контроль лише читає ledger і нічого автоматично не «виправляє».

## 7. Нараховано vs отримано

На «Огляді» та P&L/Cash Flow чітко розвести:

- **Виконано / нараховано** → P&L;
- **Отримано** → Cash Flow;
- **Ще до отримання** → дебіторка.

Для користувача:
> Виконано послуг: X  
> Отримано грошей: Y  
> Ще до отримання: Z

## 8. Аналіз маржі

Додати блок «Маржа за напрямами»:

- Роботи — із `laborRevenue / laborCost`;
- Запчастини — `partsRevenue / partsCost`;
- Діагностика — виручка окремо; якщо прямі витрати не розподілені, не показувати фальшиві 100%, а вказати «собівартість не розподілена»;
- Загалом — factual gross margin.

Кожен рядок:
- revenue;
- direct cost;
- gross profit;
- margin %;
- статус проти warning/target margin.

## 9. Прибутковість

Залишаються розрізи:
- ЗН;
- послуги;
- механіки;
- запчастини;
- постачальники.

Додатково показати:
- найприбутковіший ЗН;
- збиткові ЗН;
- запчастини нижче warning margin;
- механік з найбільшим contribution;
- постачальник з найкращою фактичною маржею (за достатніх даних).

## 10. План / факт і автоматичний план

Якщо explicit budget є — він пріоритетний.

Якщо бюджету немає, CRM будує **автоплан**, але чітко маркує джерело «Автоплан»:

### Revenue
1. explicit REVENUE budget;
2. інакше max(previous comparable revenue, break-even revenue);
3. якщо обидва 0 — план не визначено.

### Gross profit
- explicit budget;
- інакше revenue plan × target gross margin.

### OPEX
- explicit budget;
- інакше fixedMonthlyCosts, пропорційно тривалості періоду;
- fallback — previous comparable OPEX.

### Cash Flow
- explicit budget;
- інакше орієнтир = revenue plan × target margin − OPEX plan.

Додати:
- elapsed share of period;
- pace forecast;
- projected completion %;
- «за поточним темпом очікуємо …».

## 11. Прогноз грошей із поясненням причин

Окрім лінії прогнозу показати:

- сьогоднішній баланс;
- через 7 днів;
- через 30 днів;
- мінімальну точку;
- дату мінімальної точки;
- top drivers цієї дати;
- перший касовий розрив;
- перше падіння нижче резерву.

Для кожного дня зберігати до 3 найбільших drivers:
- obligation;
- recurring;
- forecast;
- direction;
- сума;
- контрагент / опис.

## 12. Платіжний календар як робочий інструмент

Для calendar item додати action metadata:

- RECEIVABLE + WorkOrder → «Відкрити ЗН»;
- PAYABLE → «Відкрити борги / витрати»;
- recurring → «Відкрити налаштування»;
- forecast → «Відкрити прогноз».

Не виконувати автоматичну оплату одним кліком без підтвердження.

## 13. Налаштування

Видалити «Налаштування» з основного tab bar.

Додати ⚙ «Налаштування» у header.

У модальному Settings Hub:
- фінансові правила;
- категорії;
- регулярні операції;
- кнопки створення/редагування.

Період до Settings Hub не застосовується.

## 14. Єдина мова UI

Основна українська термінологія:

- «Прибуток (P&L)»;
- «Рух грошей»;
- «Точка беззбитковості»;
- «Фінансові правила»;
- «Контроль витрат»;
- «Операційна / інвестиційна / фінансова діяльність».

Технічні англійські абревіатури допускаються тільки в tooltip / поясненні.

## 15. Empty states

Кожен порожній блок має:
- що відсутнє;
- чому це важливо;
- CTA.

Наприклад:
> План на період ще не заданий. Створіть бюджет, щоб CRM могла прогнозувати виконання.  
> [Створити план]

## 16. Закриття касового дня

### 16.1 Нова модель FinancialCashClose

Поля:
- id;
- businessDate;
- moneyAccountId;
- locationId;
- currency;
- systemAmount;
- countedAmount;
- difference;
- note;
- closedById;
- closedAt;
- timestamps.

Унікальність:
`(moneyAccountId, businessDate)`.

### 16.2 Логіка

Користувач вибирає CASH account і вводить фактично перераховану суму.

Сервер:
1. бере system balance із factual cash ledger;
2. рахує `difference = counted - system`;
3. записує / оновлює cash close;
4. створює AuditEvent.

Cash close **не створює CashTransaction** і не коригує баланс автоматично.

UI:
> Каса за системою: 4 650  
> Фактично: 4 550  
> Розбіжність: −100 🔴

Якщо difference = 0 → ✅ «Каса закрита без розбіжностей».

## 17. Role-aware overview

API повертає viewer:
- role codes;
- primary role;
- persona.

Persona:
- OWNER / EXECUTIVE → прибуток, маржа, Cash Flow, forecast;
- STATION_MANAGER / ADMINISTRATOR → сьогодні, оплати, борги, витрати;
- CASHIER → рахунки, надходження, виплати, касове закриття;
- FINANCE → повний фінансовий контроль;
- fallback → стандартний фінансовий огляд.

Це не змінює RBAC: користувач бачить тільки дані, які вже дозволяє FINANCE.READ scope.

## 18. Безпека

- GET лишається під `FINANCE.READ`;
- фінансові mutation — `FINANCE.WRITE`;
- cash close враховує location scope account;
- counted amount ніколи не використовується для автоматичної зміни ledger;
- всі нові mutation аудуються;
- SQL/query params parameterized;
- жодних destructive migrations.

## 19. Acceptance criteria

1. Глобальні 8 KPI не повторюються на кожній вкладці.
2. Кожна вкладка має власний summary.
3. Settings вилучено з основних tabs.
4. Accounts не показує period controls.
5. KPI drill-down показує factual contributors.
6. «Сьогодні» рахується окремо в Kyiv timezone.
7. Reconciliation має OK/WARNING/CRITICAL.
8. Revenue та Cash Flow візуально розділені.
9. Margin analysis показує labor/parts/diagnostics/overall.
10. Profitability highlights збиткові/найкращі записи.
11. Plan/fact має explicit або auto plan + pace forecast.
12. Forecast показує 7/30 days, minimum point і drivers.
13. Calendar має contextual actions.
14. Empty states мають CTA.
15. Cash close зберігається й аудується.
16. Role-aware overview працює без обходу RBAC.
17. Prisma migration replay PASS.
18. Prisma drift PASS.
19. Security smoke PASS.
20. Financial Center V3 contract smoke PASS.
21. TypeScript PASS.
22. Next build PASS.
23. Exact-commit preview READY.
24. Controlled migration tested on temporary Neon branch and applied to production.
25. Production deployment READY.
26. Post-deploy error/fatal scan clean.
