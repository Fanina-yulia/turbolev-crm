# Технічне завдання P0-04 — production E2E трьох маршрутів

## 1. Мета

Перевірити не лише наявність окремих сутностей, а завершеність трьох фактичних операційних маршрутів автомобіля:

1. «Лише діагностика».
2. «Лише ремонт».
3. «Діагностика → ремонт».

Аудит не повинен вимагати діагностичну карту або погодження КП для прямого ремонту, і не повинен вимагати ремонтні/фінансові етапи для автомобіля, який приїхав тільки на діагностику.

## 2. Канонічна класифікація

| Маршрут | Умова | Обов'язковий результат |
|---|---|---|
| `DIAGNOSTICS_ONLY` | є DiagnosticRequest, немає WorkOrder | підтверджена діагностика та фінальна діагностична карта |
| `REPAIR_ONLY` | є WorkOrder, немає DiagnosticRequest | виконані роботи, QC, фінансовий факт, оплата та закритий наряд |
| `DIAGNOSTICS_TO_REPAIR` | є DiagnosticRequest і WorkOrder | фінальна діагностична карта, наряд, погодження, ремонт, QC, фінанси, оплата, закриття |

Канонічний контракт знаходиться у `src/domain/workflow/service-routes.ts`.

## 3. Правила оцінки

### Спільні правила

- demo-записи не включаються;
- read-only аудит не змінює БД;
- для запланованого візиту перевіряються запис та фактичний приїзд;
- для walk-in без ServiceAppointment ці два кроки вважаються optional;
- зв'язок з автомобілем є обов'язковим.

### Лише діагностика

Обов'язкові етапи:

- DiagnosticRequest;
- підтвердження діагностики;
- фінальна ревізія DiagnosticCard.

WorkOrder, estimate, approval, parts, QC та payment не є блокерами.

### Лише ремонт

Обов'язкові етапи:

- WorkOrder;
- усі роботи завершені або скасовані;
- QC завершений;
- ACTUAL фінансовий snapshot;
- доказ повної оплати;
- закритий WorkOrder.

DiagnosticCard та estimate/approval не є обов'язковими. Це відповідає прямому ремонту, де автомобіль заїхав без попередньої діагностики та КП.

### Діагностика → ремонт

Обов'язкові етапи:

- DiagnosticRequest;
- підтверджена діагностика;
- фінальна діагностична карта;
- WorkOrder;
- estimate;
- погодження estimate;
- отримані обов'язкові запчастини;
- усі роботи завершені або скасовані;
- QC;
- ACTUAL фінансовий snapshot;
- повна оплата;
- закриття WorkOrder.

Для наряду без обов'язкових запчастин етапи parts request/received мають статус optional.

## 4. Readiness-аудит

Команда:

`npm run e2e:real:readiness`

Параметри:

- `E2E_MIN_REAL_VEHICLES` — мінімум завершених реальних автомобілів, за замовчуванням 10;
- `E2E_MAX_REPORT_ROWS` — кількість рядків звіту;
- `E2E_AUDIT_LOOKBACK_DAYS` — період, за замовчуванням 180 днів;
- `E2E_AUDIT_INCLUDE_IDENTIFIERS=1` — явний дозвіл показувати повні ID/номери.

Gate має статус PASS лише коли:

- виконано мінімум реальних автомобілів;
- у звіті є щонайменше один завершений автомобіль кожного з трьох маршрутів.

Звіт виводить routeKind, routeLabel, пройдені етапи, блокери, stale booked, stalled diagnostics та покриття маршрутів.

## 5. Дані аудиту

Джерела:

- Vehicle;
- ServiceAppointment;
- DiagnosticRequest;
- DiagnosticCard/DiagnosticCardRevision;
- WorkOrder;
- WorkOrderEstimate;
- WorkOrderLine;
- PartsRequest/PartsRequestItem;
- WorkOrderQualityControl;
- WorkOrderFinanceSnapshot;
- CashTransaction/FinancialObligation.

Аудит використовує lateral/latest-зв'язки, щоб один автомобіль не дублювався через старі цикли без потреби.

## 6. Contract smoke

`scripts/service-route-contract-smoke.ts` перевіряє:

- три коди маршрутів;
- класифікацію комбінацій DiagnosticRequest/WorkOrder;
- повний набір обов'язкових етапів для кожного маршруту;
- відсутність помилкової вимоги estimate для прямого ремонту;
- наявність estimate/approval у комбінованому процесі.

## 7. Acceptance criteria

1. Прямий ремонт не отримує блокерів diagnostics/diagnostic card/estimate/approval.
2. Чиста діагностика не отримує блокерів repair/QC/payment.
3. Комбінований процес вимагає і діагностичну карту, і ремонтний фінансовий контур.
4. Walk-in маршрут без appointment не стає помилково неповним.
5. Наявність обов'язкових запчастин впливає на parts blockers.
6. Звіт маскує персональні ідентифікатори за замовчуванням.
7. Нуль demo-записів потрапляє в production readiness.
8. Contract smoke і production build проходять.
9. Readiness gate показує окреме покриття усіх трьох маршрутів.
10. Завершений звіт збережений як release evidence після проходження реальними даними.

## 8. Наступна операційна дія

Після публікації коду відповідальна команда запускає readiness на production read-only DATABASE_URL, аналізує blockers та проводить щонайменше 10–20 реальних автомобілів через усі три маршрути. Сам запуск із відсутнім production credential не підміняється синтетичним PASS.
