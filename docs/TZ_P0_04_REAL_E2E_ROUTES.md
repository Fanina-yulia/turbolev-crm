# Технічне завдання P0-04 — production E2E трьох маршрутів

## 1. Мета

Перевірити не лише наявність окремих сутностей, а завершеність трьох фактичних операційних маршрутів автомобіля:

1. «Лише діагностика».
2. «Лише ремонт».
3. «Діагностика → ремонт».

Діагностична карта не є обов'язковою для прямого ремонту, але обидва ремонтні маршрути повинні мати актуальну Комерційну пропозицію та підтверджене погодження клієнта. Для автомобіля, який приїхав тільки на діагностику, ремонтні/фінансові етапи не вимагаються.

## 2. Канонічна класифікація

| Маршрут | Умова | Обов'язковий результат |
|---|---|---|
| `DIAGNOSTICS_ONLY` | є DiagnosticRequest, немає WorkOrder | підтверджена діагностика та фінальна діагностична карта |
| `REPAIR_ONLY` | є WorkOrder, немає DiagnosticRequest | КП із прямого складу ремонту, погодження, виконані роботи, QC, фінансовий факт, оплата та закритий наряд |
| `DIAGNOSTICS_TO_REPAIR` | є DiagnosticRequest і WorkOrder | фінальна діагностична карта, КП, погодження, ремонт, QC, фінанси, оплата, закриття |

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

### Лише ремонт / прямий ремонт

Обов'язкові етапи:

- WorkOrder без DiagnosticRequest;
- визначений склад робіт;
- актуальний WorkOrderEstimate;
- погодження актуального estimate;
- виконані правила забезпечення запчастинами згідно `DirectRepairPartsMode`;
- усі роботи завершені або скасовані;
- QC завершений;
- ACTUAL фінансовий snapshot;
- доказ повної оплати;
- закритий WorkOrder.

DiagnosticCard не є обов'язковою. КП формується безпосередньо з відомих робіт, матеріалів та деталей. Для нових прямых ремонтів `directPriceConfirmedAt` не є самостійним bypass для approval gate.

Чотири допустимі моделі запчастин описані у `docs/TZ_DIRECT_REPAIR_COMMERCIAL_FLOW_V1.md`: СТО, клієнт, змішаний варіант, без запчастин.

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
- DirectRepairCommercialConfig/DirectRepairPartSource;
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
- відсутність помилкової вимоги DiagnosticCard для прямого ремонту;
- наявність estimate/approval для обох ремонтних маршрутів.

## 7. Acceptance criteria

1. Прямий ремонт не отримує blocker diagnostics/diagnostic card, але вимагає актуальну КП та approval.
2. Чиста діагностика не отримує blocker repair/QC/payment.
3. Комбінований процес вимагає і діагностичну карту, і ремонтний фінансовий контур.
4. Walk-in маршрут без appointment не стає помилково неповним.
5. Наявність обов'язкових запчастин і їх джерело впливають на parts blockers.
6. CUSTOMER parts не потребують закупівлі, але потребують підтвердження фактичної наявності.
7. Звіт маскує персональні ідентифікатори за замовчуванням.
8. Нуль demo-записів потрапляє в production readiness.
9. Contract smoke і production build проходять.
10. Readiness gate показує окреме покриття усіх трьох маршрутів.
11. Завершений звіт збережений як release evidence після проходження реальними даними.

## 8. Наступна операційна дія

Після публікації коду відповідальна команда запускає readiness на production read-only DATABASE_URL, аналізує blockers та проводить щонайменше 10–20 реальних автомобілів через усі три маршрути. Сам запуск із відсутнім production credential не підміняється синтетичним PASS.