# TURBO LEV — Visit Financial State + Planner / Vehicle Card Sync v1

## 1. Мета

У CRM статус виконання робіт і статус розрахунків мають бути двома незалежними фактами.

Поточна проблема: фактична оплата може бути проведена у фінансовому контурі, але Планувальник продовжує показувати `Очікує оплату`, а картка автомобіля не показує суму оплати поточного візиту. Окремо popup Планувальника показує лише `estimatedAmount`, тому фактична оплата walk-in діагностики може виглядати як `Ще не розраховано`.

Ціль v1 — створити один канонічний read-model `VisitFinancialState` і використовувати його в:

1. робочому popup запису Планувальника;
2. картці автомобіля;
3. post-payment сценарії кабінету механіка.

## 2. Принципи

1. **Статус роботи != статус оплати.**
2. Фактичні фінансові факти мають пріоритет над плановими значеннями.
3. `estimatedAmount` використовується тільки як плановий fallback до появи фактичного нарахування.
4. Платіж або передплата не можуть бути приховані лише тому, що `ServiceAppointment.status` ще не переведений у наступний етап.
5. UI не рахує гроші самостійно. Розрахунок виконується серверним read-model.
6. Ніяких нових ledger-таблиць у v1: джерела вже існують.
7. Платіж без сформованого фактичного нарахування — це **передплата**, а не доказ повного розрахунку.
8. Не можна створювати «борг» із планової суми: `outstanding` стає фактичним лише після `FinancialObligation`.

## 3. Канонічні джерела

### 3.1. Work Order

- `FinancialObligation.direction = RECEIVABLE`;
- `FinancialObligation.workOrderId`;
- `FinancialObligation.status != CANCELLED`;
- `amount` — фактично нараховано;
- `settledAmount` — фактично погашено;
- `CashTransaction.status = POSTED`, `kind = INFLOW` — факт платежу/передплати та джерело останньої оплати.

### 3.2. Walk-in діагностика

- `DiagnosticVisitLink` — канонічний зв'язок appointment ↔ diagnostic;
- `FinancialObligation.sourceEntity = WALK_IN_DIAGNOSTIC`;
- `sourceEntityId = <diagnosticId>:receivable`;
- `CashTransaction.sourceEntity = WALK_IN_DIAGNOSTIC_PAYMENT`;
- `sourceEntityId = <diagnosticId>:payment`;
- `status = POSTED`.

### 3.3. Планова сума

`ServiceAppointment.estimatedAmount` — тільки планова цифра. Вона не перетворюється на фактичний борг без `FinancialObligation`.

## 4. Контракт VisitFinancialState

```ts
type VisitFinancialState = {
  appointmentId: string;
  vehicleId: string | null;
  workOrderId: string | null;
  diagnosticId: string | null;
  isCurrentVisit: boolean;
  appointmentStatus: string;
  operationalLabel: string;
  source: "WORK_ORDER" | "WALK_IN_DIAGNOSTIC" | "ESTIMATE" | "NONE";
  actual: boolean; // true, якщо total charge взято з фактичного FinancialObligation
  status: "NOT_FORMED" | "UNPAID" | "PREPAID" | "PARTIAL" | "PAID" | "OVERDUE" | "CANCELLED";
  amount: number | null;
  paid: number;
  outstanding: number | null;
  estimatedAmount: number | null;
  lastPayment: {
    id: string;
    amount: number;
    occurredAt: string;
    method: "CASH" | "TERMINAL" | "ONLINE" | "OTHER" | null;
  } | null;
  diagnostic: {
    reviewState: string | null;
    workflowLabel: string;
    total: number;
    checked: number;
    defects: number;
    completed: boolean;
  } | null;
};
```

## 5. Правила фінансового статусу

1. Немає фактичного нарахування і платежів → `NOT_FORMED`.
2. Є планова сума, але немає фактичного нарахування і платежу → `UNPAID` як робочий індикатор очікуваної оплати; ця сума позначається як **планова**, не як фактичний борг.
3. Є POSTED payment, але ще немає `FinancialObligation` → `PREPAID` / UI: **Передплата**. `paid` показує внесені гроші, `outstanding = null` до формування фактичного нарахування.
4. Є фактичне `FinancialObligation`, `paid == 0` → `UNPAID` / UI: **Очікує оплату**.
5. Є фактичне `FinancialObligation`, `0 < paid < amount` → `PARTIAL` / UI: **Частково оплачено**.
6. Є фактичне `FinancialObligation`, `paid >= amount > 0` → `PAID` / UI: **Оплачено**.
7. Якщо є `OVERDUE` obligation і фактичний залишок > 0 → `OVERDUE`.
8. Фактична `FinancialObligation` завжди має пріоритет над `estimatedAmount`.
9. POSTED payment ніколи не ігнорується лише тому, що obligation ще не сформований.

## 6. Планувальник

### 6.1. Header

У header показується **операційний стан**, а не фінансовий badge.

Для завершеної/submitted діагностики:
- `Діагностика виконана`;
- якщо повна оплата проведена, raw `WAITING_PAYMENT` не повинен візуально трактуватися як `Очікує оплату`;
- фінансовий статус показується окремо в блоці «Оплата».

### 6.2. Діагностика

Компактний блок:
- `Діагностика виконана` / поточний workflow label;
- `checked / total`;
- `N дефектів`;
- дія `Відкрити ДК`.

Completion scope має бути сумісним із механікою submit: якщо присутня `SUSPENSION_MATRIX`, summary рахується за нею; інакше — за всіма inspection цього diagnostic.

### 6.3. Оплата

Компактний блок:
- badge: `Очікує оплату` / `Передплата` / `Частково оплачено` / `Оплачено`;
- `Нараховано` або `Планова сума`;
- `Оплачено`;
- `Залишок`;
- остання оплата та спосіб, якщо є.

Для `PREPAID`:
- показати внесену суму;
- не вигадувати остаточний залишок;
- коротко пояснити, що залишок з'явиться після фактичного нарахування.

При `actual=true` не показувати `Ще не розраховано` на основі порожнього `estimatedAmount`.

## 7. Картка автомобіля

У drawer картки авто додати блок **«Фінанси візиту»** перед клієнтським кабінетом:

- статус оплати;
- фактичне нарахування або планову суму;
- оплачено;
- фактичний залишок, якщо він сформований;
- остання оплата та спосіб;
- операційний стан поточного візиту.

Картка використовує той самий серверний `VisitFinancialState`, що й Планувальник.

Якщо активного appointment немає, показати останній нескасований візит як `Останній візит`, але не називати його поточним.

## 8. Кабінет механіка після оплати

Поточний auto-return після успішного платежу заборонений.

Після `PAY`:
1. показати `Оплачено`;
2. залишити механіка на settlement screen;
3. обов'язково запропонувати:
   - `Завершити візит` → `COMPLETED`;
   - `Передати на розрахунок ремонту` → `WAITING_CALCULATION`;
4. повернення на головний екран — тільки після вибору маршруту.

## 9. Refresh / realtime

Після платежу або вибору маршруту:
- dispatch `turbolev:data-changed`;
- Планувальник і картка авто скидають локальний read-cache і читають `no-store` read-model;
- фінансовий endpoint має `Cache-Control: no-store`.

## 10. API та RBAC

Endpoint: `GET /api/vehicles/visit-financial-state?appointmentId=...` або `?vehicleId=...`.

- знаходиться в чинному `/api/vehicles/*` security contour;
- вимагає `CLIENTS.READ`;
- `strict: true` у route handler;
- без авторизації не повертає бізнес-дані;
- не виконує жодних write-операцій.

## 11. Non-goals v1

- не створювати новий payment ledger;
- не мігрувати історичні платежі;
- не змінювати бухгалтерські проводки;
- не змінювати refund/reversal;
- не дублювати `CashTransaction` або `FinancialObligation`;
- не перетворювати `estimatedAmount` на бухгалтерський борг.

## 12. Acceptance

1. Walk-in diagnostic: obligation 600, paid 600 → Planner показує `Оплачено`, нараховано 600, оплачено 600, залишок 0 — не `Ще не розраховано`.
2. Unpaid factual charge: amount 600, paid 0 → `Очікує оплату`, залишок 600.
3. Partial factual charge: amount 600, paid 200 → `Частково оплачено`, залишок 400.
4. Payment 200 before obligation exists → `Передплата 200`, без вигаданого фактичного залишку.
5. Full payment не змушує header робіт показувати `Очікує оплату`.
6. Planner і Vehicle Card отримують однакові `amount / paid / outstanding / status` для одного appointment.
7. Vehicle Card показує фінанси актуального/останнього візиту.
8. Submitted diagnostic показує фактичний summary і кнопку `Відкрити ДК`.
9. Після `PAY` механік не повертається автоматично на головний екран.
10. Після `PAY` доступні два post-payment маршрути.
11. Повторний `PAY` не створює дубль платежу (існуюча idempotency зберігається).
12. Endpoint без сесії повертає 401/403 згідно RBAC.
13. Production build, Module Scope, diagnostic/walk-in smoke і preview — PASS.
