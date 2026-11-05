# ТЗ: Compensation + Financial Truth V3

## 1. Мета

Побудувати в Turbo LEV єдину управлінську модель, у якій:

- залишок грошей не плутається з прибутком;
- зарплата та комісії працівника потрапляють у P&L тоді, коли зароблені, а не лише в момент виплати;
- всі компоненти мотивації доступні будь-якому працівнику;
- виконана робота механіка одразу впливає на його заробіток і собівартість СТО;
- Cash Flow, P&L, кредиторка по зарплаті та кабінет працівника походять з одних фактів;
- CRM явно позначає неповні фінансові дані;
- одна витрата не враховується двічі.

## 2. Cash і Profit

Гроші зараз — фактичний залишок на касах і рахунках.

Cash Flow — фактичні надходження мінус фактичні виплати.

P&L — доходи і витрати, визнані у відповідному періоді незалежно від дати фізичної оплати.

Приклад: клієнт заплатив 7 900 грн, працівнику вже нараховано 2 370 грн, але ще не виплачено. Гроші зараз можуть залишатися 7 900 грн, але P&L уже має витрату на працю 2 370 грн, а кредиторка перед працівником — 2 370 грн.

## 3. Формула мотивації

Для EmployeeProfile підтримуються:

- baseSalary — базова ставка, грн/місяць;
- minimumSalary — гарантований мінімум, грн/місяць;
- workPercent — % від персонально атрибутованих робіт;
- partsSalesPercent — % від персонально атрибутованого продажу деталей;
- partsMarginPercent — % від персонально атрибутованої маржі деталей;
- netProfitPercent — % від чистого прибутку до profit-share бонусів;
- KPI/бонуси/коригування через SalaryAccrual.

Формула:

зароблено до мінімуму = ставка + % робіт + % продажу деталей + % маржі деталей + profit-share + KPI/бонуси + коригування

до нарахування = max(зароблено до мінімуму, гарантований мінімум з урахуванням активного періоду)

### 3.1. Базова ставка

Ставка нараховується пропорційно дням календарного місяця.

dailyBase = baseSalary / daysInMonth

Live-нарахування створюється щодня. До hireDate нарахування не створюються.

### 3.2. Мінімальна зарплата

Мінімум — гарантія, а не друга ставка зверху.

minimumTopUp = max(0, effectiveMinimum - усі інші зароблені суми)

Для прийняття посеред місяця мінімум пропорційно коригується.

### 3.3. % від робіт

Рахується лише для WorkOrderLine типу LABOR, який завершений, персонально прив’язаний до виконавця та має ціну.

workRevenue = quantity * actualUnitPrice - actualDiscount

employeeLaborPay = workRevenue * workPercent / 100

SalaryAccrual:
- category LABOR;
- sourceType WORK_ORDER_LABOR;
- sourceId WorkOrderLine.id.

### 3.4. Позапланова діагностика

Після завершеної та оплаченої walk-in діагностики CRM визначає призначеного механіка, застосовує workPercent і створює SalaryAccrual WALK_IN_DIAGNOSTIC_LABOR.

### 3.5. % від продажу деталей

Тільки за прямою AttributionLedgerEntry:
- attributionType DIRECT;
- metricCode PARTS_REVENUE.

partsSalesBonus = attributedPartsRevenue * partsSalesPercent / 100

CRM не вгадує працівника.

### 3.6. % від маржі деталей

Тільки за прямою AttributionLedgerEntry metricCode PARTS_MARGIN.

partsMarginBonus = max(0, attributedPartsMargin) * partsMarginPercent / 100

### 3.7. % від чистого прибутку

Щоб не створювати циклічну формулу:

profitBeforeProfitShare = Revenue - COGS - OPEX_without_profit_share + OtherIncome - OtherExpense - Tax

profitShareBonus = max(0, profitBeforeProfitShare) * netProfitPercent / 100

Після нарахування бонус входить в OPEX і формує фінальний net profit.

## 4. Класифікація зарплати в P&L

- LABOR → COGS_LABOR;
- SALES → COGS_STAFF_SALES;
- PROFIT_SHARE → OPEX_PROFIT_SHARE;
- BASE, KPI, BONUS, ALLOWANCE, ADJUSTMENT, OTHER → OPEX_PAYROLL.

## 5. Момент визнання

Витрата зарплати визнається у SalaryAccrual.occurredAt.

SalaryPayment:
- не створює нову витрату P&L;
- зменшує cash;
- зменшує payroll payable.

Закриття PayrollPeriod не створює другу зарплатну витрату.

## 6. Ідемпотентність та історія правил

Автоматичне нарахування має стабільну пару employeeId + sourceType + sourceId.

Повторний reconciliation не створює дубль.

AuditEvent зберігає rule snapshot і basis. Зміна правил впливає на майбутні нарахування; старі не перераховуються автоматично.

## 7. WorkOrder Finance

При завершенні LABOR line live-нарахування працівника записується як фактична actualUnitCost роботи.

При фіналізації WorkOrder система віднімає вже проведений live COGS_LABOR і створює лише залишок, щоб не було подвійної собівартості.

## 8. Payroll payable

payrollDue = POSTED SalaryAccrual - SalaryPayment

Стани:
- OPEN;
- PARTIALLY_PAID;
- PAID.

Кредиторка входить у Financial Center.

## 9. Event-driven recalculation + safety reconciliation

Основний режим роботи — **event-driven**, без очікування нічного job.

Одразу після бізнес-події:
- оплата/проведення walk-in діагностики → SalaryAccrual механіку → FinancialEvent COGS → payroll payable;
- завершення LABOR line → SalaryAccrual → COGS;
- створення DIRECT PARTS_REVENUE / PARTS_MARGIN attribution → відповідна комісія працівнику;
- SalaryPayment → одразу оновлює payroll payable;
- POSTED фінансові операції одразу доступні Financial Center на наступному читанні.

Відкритий Financial Center автоматично підтягує свіжі дані кожні 5 секунд, при поверненні фокусу/видимості та після локальної події turbolev:data-changed.

Щоденний reconciliation залишається лише страховкою для старих записів, міграцій або пропущених інтеграційних подій.

### 9.1. Safety reconciliation

Щоденний maintenance:
- донараховує baseSalary;
- знаходить завершені LABOR lines без accrual;
- знаходить walk-in diagnostics без accrual;
- обробляє DIRECT PARTS_REVENUE / PARTS_MARGIN;
- за попередній місяць фіксує profit-share;
- за попередній місяць виконує minimumSalary top-up.

Live hooks — основний шлях, reconciliation — страховка.

## 10. Кабінет механіка

На HOME:
- Сьогодні;
- Цей місяць;
- До виплати;
- Детально.

Моя зарплата:
- прогноз місяця;
- сьогодні/тиждень/місяць;
- нараховано/виплачено/до виплати;
- ставка;
- % робіт;
- % деталей/маржі;
- бонуси;
- доплата до мінімуму;
- власні правила;
- останні нарахування;
- прогноз майбутніх компонентів.

Працівник бачить лише власні суми.

## 11. Персонал

Шість параметрів мотивації доступні будь-якій посаді.

Валідація:
- суми >= 0;
- відсотки 0..100.

Audit працівника зберігає compensation rule snapshot.

UI пояснює, що нові правила діють лише на майбутні нарахування, а % робіт/деталей потребує персональної атрибуції.

## 12. Financial Center

KPI:
- Гроші зараз;
- Виручка;
- Прямі витрати;
- Валовий прибуток;
- Операційні витрати;
- Чистий прибуток;
- Cash Flow;
- Дебіторка;
- Кредиторка;
- прогноз.

## 13. Financial completeness

Перевіряються:
- LABOR work без SalaryAccrual;
- walk-in diagnostic revenue без mechanic accrual;
- продані PART без закупівельної собівартості;
- працівники з baseSalary без BASE_DAILY;
- маржа близька до 100%.

Стани COMPLETE / PARTIAL / LOW.

Якщо є проблема, чистий прибуток позначається як попередній.

## 14. Інші витрати

POSTED ExpenseDocument створює P&L факт. Оплачена витрата окремо створює cash outflow. Неоплачена може створити payable.

Планові/регулярні операції не змішуються з фактичним P&L до визнання.

## 15. Безпека

- чужа компенсація — Personnel/Payroll permissions;
- own salary — SELF;
- company P&L не передається механіку;
- profit-share показується механіку як сума прогнозу без розкриття бази company P&L;
- mutation paths аудіюються;
- reconciliation працює тільки server-side.

## 16. Міграція

Файл: prisma/migrations/20261006224500_compensation_finance_v3/migration.sql

Він:
- створює payroll finance categories;
- додає SalaryAccrual → FinancialEvent bridge;
- веде live payroll payable;
- синхронізує SalaryPayment з payable;
- прибирає подвійний payroll expense при PayrollPeriod CLOSE;
- backfill робить тільки OPEN/REVIEW, не переписуючи старі CLOSED periods.

## 17. Acceptance criteria

1. Діагностика 1 000 грн при workPercent=30 створює 300 грн LABOR accrual.
2. P&L: Revenue 1 000, COGS щонайменше 300.
3. До виплати 300 не зменшує cash до SalaryPayment.
4. SalaryPayment не зменшує P&L вдруге.
5. Завершена LABOR line одразу відображається у механіка.
6. Повторний reconcile не дублює accrual.
7. WorkOrder finalization не дублює live labor COGS.
8. Base salary нараховується щодня.
9. MinimumSalary створює лише top-up.
10. Parts sales/margin — тільки DIRECT attribution.
11. Profit-share — від pre-share profit.
12. Некоректні % не зберігаються.
13. Механік бачить власні today/week/month/accrued/paid/due.
14. Механік не бачить чужі зарплати/P&L.
15. Financial Center показує Direct Costs і OPEX.
16. Неповна собівартість робить net profit preliminary.
17. Повні дані дають COMPLETE.
18. Production build і contract smoke проходять.
19. DB migration застосована до production.
20. Немає нових runtime errors у finance/payroll/mechanic.

## 18. Наступні розширення

- effective-dated CompensationRule як окрема сутність;
- approval workflow зміни правил;
- окремий payroll payment UI з CashTransaction;
- фактичний auto-post recurring expenses;
- податки/ЄСВ як payroll accruals;
- зарплатний кабінет для всіх ролей;
- employee economics / contribution margin;
- графіки earned vs paid.
