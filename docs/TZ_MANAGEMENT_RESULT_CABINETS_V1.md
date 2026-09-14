# TURBO LEV — ТЗ: кабінети Власника, Виконавчого директора та Керівника станції

Версія: v1.0
Статус: READY FOR IMPLEMENTATION
Джерело концепції: Google Doc «TURBO LEV — Кабінети Власника, Виконавчого директора та Керівника станції. Управління результатом v1.0».

## 1. Мета
Побудувати єдиний управлінський контур CRM, у якому:
- Власник задає цілі, бачить фінансовий результат, людей, потужність, ризики та рішення свого рівня.
- Виконавчий директор працює на тому самому наборі даних, але керує виконанням цілей усієї мережі і не має права змінювати стратегічні параметри без Власника.
- Керівник станції бачить тільки свою локацію, конкретний план, факт, прогноз, gap-to-plan, команду, підйомники, блокери та власний попередній/фінальний бонус.
- Усі кабінети використовують одні формули і одні джерела факту. Відрізняються лише scope, агрегування та дозволені дії.

## 2. Головний KPI виробничої станції
Робоча назва: «Управлінський валовий прибуток».

Формула:
`виконані роботи + маржа проданих/встановлених деталей`.

Маржа деталей:
`фактична ціна продажу - фактична закупівельна ціна - повернення/коригування`.

Не змішувати з бухгалтерським чистим прибутком. P&L, Cash Flow, ФОП, оренда та інші операційні витрати відображаються окремо.

Факт по виробництву фіксується лише для реально виконаних робіт після QC з відомими фінальними цінами. Замовлені, але не встановлені деталі не створюють фактичну маржу і можуть входити лише у прогноз.

Паралельно показувати два факти:
- «Вироблено результату» — управлінський валовий прибуток.
- «Отримано грошей» — фактичний Cash In.

## 3. Планування
Основний період: календарний тиждень Monday 00:00 — Sunday 23:59 у timezone станції.

План має три рівні:
- Minimum — мінімально прийнятний результат.
- Target — основна ціль.
- Stretch — сильний результат / зона перевиконання.

Власник задає план компанії/мережі. Якщо станція одна — 100% плану переходить на неї.

Каскад:
`Компанія -> Станція -> Підйомник -> День -> Команда`.

Розподіл між станціями та підйомниками за замовчуванням робиться пропорційно реальній доступній потужності в годинах, а не механічно порівну.

Виконавчий директор може до старту активного періоду перерозподілити план між станціями, не змінюючи загальний Target Власника.

Керівник станції може перерозподілити план своєї локації між днями, підйомниками, змінами та типами робіт, але не може самостійно зменшити ціль станції.

## 4. Стани плану та audit trail
Стани:
`DRAFT -> OWNER_APPROVED -> EXECUTIVE_DISTRIBUTED -> STATION_ACCEPTED -> ACTIVE -> CLOSED`.

Після старту періоду Target Власника заморожується. Будь-яка зміна після старту створює ревізію і зберігає:
- old value;
- new value;
- user/role;
- timestamp;
- reason;
- approver;
- source IP/request metadata, якщо доступно.

Заборонено тихо переписувати історичний план заднім числом.

## 5. Прогноз
Показувати три сценарії:
- Conservative: факт + гарантовано виконуваний погоджений обсяг.
- Base: факт + підтверджений pipeline з реалістичною ймовірністю.
- Optimistic: факт + весь реальний pipeline, який фізично може бути виконаний у періоді.

Окремо рахувати:
- прогноз по поточному темпу;
- підтверджений прогноз;
- зважений прогноз.

Зважений прогноз на першому етапі може використовувати конфігуровані коефіцієнти по статусах; надалі — історичну конверсію TURBO LEV.

## 6. Gap-to-plan
CRM повинна рахувати:
- Target;
- Fact;
- Confirmed forecast;
- Gap;
- remaining days/hours;
- required result per day;
- required result per active lift/day;
- available productive capacity;
- potential in unapproved estimates;
- blockers preventing plan execution.

Система має коротко пояснювати, якими важелями gap можна закрити.

## 7. Точка беззбитковості
Для кожної станції зберігати окремо weekly break-even target.

Показувати шкалу:
- до break-even — покриття витрат;
- break-even -> Target — формування планового прибутку;
- Target+ — перевиконання.

Break-even не змінює Target автоматично.

## 8. Кабінет Власника
Перший екран повинен відповідати за 20–30 секунд на питання: скільки заробили, чи виконуємо план, який прогноз, де зависли гроші, хто/що недовантажений, що загрожує результату і де потрібне рішення Власника.

### 8.1. Верхні KPI
- Revenue.
- Management gross profit.
- Gross margin.
- Cash In / Cash Out.
- Operating result.
- Plan / Fact / Forecast.

### 8.2. Контроль грошей і ризиків
- Money in work.
- Receivables.
- Potential at risk.
- Owner decisions (max 3–5 true escalations).

### 8.3. Великі блоки
Ліворуч: «Команда та завантаження».
Праворуч: «План -> Факт -> Прогноз».

### 8.4. Нижчі блоки
- Capacity: stations/lifts/norm-hours.
- Quality: warranty/rework/SLA/repeat clients.
- Parts & frozen money.

Операційний список десятків автомобілів не є головним блоком Власника.

## 9. Кабінет Виконавчого директора
Виконавчий директор отримує майже той самий аналітичний горизонт, що Власник, але більший операційний контроль і менше стратегічних прав.

Бачить:
- всі станції;
- network plan/fact/forecast/gap;
- P&L / Cash Flow / receivables;
- порівняння станцій;
- lift/personnel utilization;
- station managers KPI;
- funnel marketing -> sales -> booking -> arrival -> repair -> payment;
- staffing gaps;
- supply risks;
- quality gates;
- reasons of underperformance.

Може:
- розподіляти затверджений plan між станціями;
- задавати операційні пріоритети;
- погоджувати внутрішні плани станцій;
- перерозподіляти ресурси;
- ставити corrective actions;
- погоджувати витрати/знижки в ліміті;
- ініціювати найм/навчання;
- змінювати графіки в дозволених межах;
- закривати міжфункціональні блокери.

Не може без Власника:
- зменшувати стратегічний/загальний план;
- змінювати формулу мотивації;
- змінювати стратегічну цінову політику;
- приймати великі інвестиційні рішення поза бюджетом;
- відкривати/закривати станції;
- змінювати керівну оргструктуру;
- створювати значні фінансові зобов’язання;
- наймати/звільняти ключових керівників;
- видаляти/переписувати фактичні відхилення.

## 10. Кабінет Керівника станції
Scope: тільки призначена ServiceLocation.

Верх:
- Target week;
- target to current moment;
- Fact;
- Confirmed forecast;
- Base forecast;
- Gap;
- required/day;
- required/lift/day;
- preliminary bonus.

Підйомники:
- weekly/day target;
- fact;
- forecast;
- utilization;
- free slots;
- current/next vehicle;
- downtime + reason;
- management gross profit;
- UAH per available lift-hour.

Команда:
- schedule/status;
- current task;
- productive hours;
- norm-hours;
- utilization;
- plan/fact/forecast;
- KPI;
- attributable contribution;
- overdue work;
- rework/quality.

Керування днем:
- target today;
- fact today;
- remaining today;
- vehicles contributing to target;
- estimates needing approval;
- parts blockers;
- free lift;
- mechanic reserve;
- risk of missing day/week target.

## 11. Персонал
Потрібен персональний графік:
`employee -> date -> shift -> start -> end -> status`.

Statuses:
ON_SHIFT, DAY_OFF, VACATION, SICK, ABSENT, LATE, PARTIAL_SHIFT.

Utilization працівника = productive time / actual available shift time.

Економіка працівника для відповідних ролей:
- target;
- actual;
- forecast;
- attributed revenue/result;
- gross profit;
- full cost;
- net contribution;
- ROI;
- KPI score;
- utilization.

Ролі оцінюються різними KPI.

## 12. Бонус Керівника станції
Підтримати чинну модель TURBO LEV та зробити її конфігурованою.

Параметри:
- activation threshold;
- base percent / fixed amount;
- progressive tiers;
- quality gates;
- cap;
- finalization rules.

Quality gates можуть включати:
- min margin;
- warranty rate;
- repeat repair rate;
- SLA;
- overdue receivables;
- CRM/data quality;
- critical complaints;
- safety/discipline.

Протягом тижня показувати preliminary bonus. Після CLOSED — final bonus, який може перейти в SalaryAccrual category BONUS.

## 13. Причини відхилень
Класифікувати як мінімум:
TRAFFIC_SHORTAGE, BOOKING_ARRIVAL_CONVERSION, DIAGNOSTICS_APPROVAL_CONVERSION, LOW_AVERAGE_CHECK, LOW_PARTS_MARGIN, PARTS_SHORTAGE, APPROVAL_DELAY, MECHANIC_UNDERLOAD, LIFT_DOWNTIME, STAFF_SHORTAGE, WARRANTY_REWORK, NO_SHOW, EQUIPMENT, PLANNING_ERROR, EXTERNAL_FACTOR.

Власник бачить top-3 причин у грн/годинах/клієнтах.
Виконавчий директор — деталізацію по станціях.
Керівник станції — конкретні об’єкти та дії.

## 14. Ескалації
Level 1 — Station Manager: локальна черга, графік, розподіл авто, простаї, дисципліна.
Level 2 — Executive Director: дефіцит між станціями, конфлікти функцій, системний провал плану, найм, supply, budget in limit.
Level 3 — Owner: стратегія, великі гроші, мотивація, ключові керівники, критичний legal/reputation risk, over-limit decisions.

Формат:
`Fact -> impact in UAH/time/clients -> actions already taken -> projected consequence -> 1–3 options -> recommended decision -> decision owner -> deadline`.

## 15. Права
OWNER: full read/write, strategic settings, target, motivation formula, limits, final approvals.
EXECUTIVE_DIRECTOR: broad business read + operational write; no strategic mutation without explicit owner approval.
STATION_MANAGER: full operational read/write only for assigned location; may redistribute but not lower target.

## 16. Дані
Перевикористовувати:
- ServiceLocation;
- ServicePost;
- ServiceMechanic;
- ServiceAppointment;
- WorkOrder / payments / procurement facts;
- EmployeeProfile / role assignment;
- EmployeeKpiResult;
- PerformanceEvent / AttributionLedgerEntry;
- PayrollPeriod / SalaryAccrual;
- EmployeeEconomicsSnapshot.

Нові сутності:
- ManagementPlan;
- ManagementPlanAllocation;
- ManagementPlanRevision;
- ManagementForecastSnapshot (phase 3);
- StationBonusScheme / StationBonusResult;
- EmployeeShift;
- ManagementDeviation (or structured reason payload on revisions/results).

## 17. API contracts
Phase 1:
- GET/POST `/api/management/plans` — list/create/update DRAFT plan.
- POST `/api/management/plans/:id/approve` — Owner approval.
- POST `/api/management/plans/:id/distribute` — Executive allocation.
- POST `/api/management/plans/:id/accept` — station acceptance.
- GET `/api/management/result?period=...&locationId=...` — common fact/forecast/gap contract for all cabinets.

All mutation routes require server-side access-context verification and audit trail.

## 18. UI acceptance
- Same business formula returns same number in all three cabinets.
- Owner sees network aggregation and true owner escalations only.
- Executive sees same core numbers plus station comparison and corrective actions.
- Station Manager cannot see other locations.
- Target cannot be silently reduced after activation.
- Zero values are distinguishable from missing data.
- Forecast is always visually separated from Fact.
- Potential values are explicitly labelled as potential, never as actual revenue/profit.
- Responsive at 1440/1280/768/390.
- No font below CRM global floor.
- Reduced-motion honored for decorative chart animation.

## 19. Delivery order
### Phase 1 — foundation
1. Role routing: separate EXECUTIVE cabinet mode from OWNER.
2. New additive Prisma models + migration for weekly plans, allocations, revisions.
3. Shared management-plan service and API.
4. Common result API contract with plan/fact/base forecast/gap.
5. Owner Plan/Fact/Forecast block.
6. Executive Plan/Fact/Forecast + station comparison.
7. Station Manager result header using the same API.
8. Tests/contracts/build/deploy.

### Phase 2 — capacity and people
1. EmployeeShift model/UI.
2. Team today and personnel utilization.
3. Lift capacity and target allocation by hours.
4. Employee economics / contribution panel.
5. Manager bonus scheme + preliminary/final result.
6. Quality gates.

### Phase 3 — intelligence
1. Weighted pipeline forecast.
2. Historical stage probabilities.
3. Automatic deviation attribution.
4. Gap-closing recommendations.
5. Capacity/staffing forecast.

## 20. Done definition for each phase
A phase is DONE only when:
- migration is additive and deployment-safe;
- source-of-truth docs updated;
- contract smoke tests pass;
- TypeScript/build passes;
- preview/production deployment is READY;
- production aliases point to the new deployment;
- relevant production API returns expected schema;
- no relevant 5xx errors appear after deploy;
- evidence/commit/deployment identifiers are recorded in the delivery note.
