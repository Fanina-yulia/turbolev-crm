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
3. `estimatedAmount` використовується тільки як fallback до появи фактичного фінансового документа.
4. Платіж не може бути прихований лише тому, що `ServiceAppointment.status` ще не переведений у наступний етап.
5. UI не рахує гроші самостійно. Розрахунок виконується серверним read-model.
6. Ніяких нових ledger-таблиць у v1: джерела вже існують.

## 3. Канонічні джерела

### 3.1. Work Order

- `FinancialObligation.direction = RECEIVABLE`;
- `FinancialObligation.workOrderId`;
- `FinancialObligation.status != CANCELLED`;
- `amount` — нараховано;
- `settledAmount` — оплачено;
- `CashTransaction.status = POSTED`, `kind = INFLOW` — факт останньої оплати.

### 3.2. Walk-in діагностика

- `DiagnosticVisitLink` — канонічний зв'язок appointment ↔ diagnostic;
- `FinancialObligation.sourceEntity = WALK_IN_DIAGNOSTIC`;
- `sourceEntityId = <diagnosticId>:receivable`;
- `CashTransaction.sourceEntity = WALK_IN_DIAGNOSTIC_PAYMENT`;
- `sourceEntityId = <diagnosticId>:payment`;
- `status = POSTED`.

### 3.3. Планова сума

`ServiceAppointment.estimatedAmount` — тільки плановий fallback, якщо немає FinancialObligation і фактичного платежу.

## 4. Контракт VisitFinancialState

```ts
type VisitFinancialState = {
  appointmentId: string;
  vehicleId: string | null;
  workOrderId: string | null;
  diagnosticId: string | null;
  source: "WORK_ORDER" | "WALK_IN_DIAGNOSTIC" | "ESTIMATE" | "NONE";
  actual: boolean;
  status: "NOT_FORMED" | "UNPAID" | "PARTIAL" | "PAID" | "OVERDUE" | "CANCELLED";
  amount: number | null;
  paid: number;
  outstanding: number | null;
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

1. `amount == null / 0`, `paid == 0` → `NOT_FORMED`.
2. `amount > 0`, `paid == 0` → `UNPAID` / UI: **Очікує оплату**.
3. `paid > 0`, `paid < amount` → `PARTIAL` / UI: **Частково оплачено**.
4. `paid >= amount > 0` → `PAID` / UI: **Оплачено**.
5. Якщо є `OVERDUE` obligation і залишок > 0 → `OVERDUE`.
6. Фактична `FinancialObligation` має пріоритет над `estimatedAmount`.
7. Якщо obligation ще немає, але є POSTED walk-in payment, сума платежу стає фактичною `amount` і `paid`.

## 6. Планувальник

### 6.1. Header

У header показується **операційний стан**, а не помилковий фінансовий текст.

Для завершеної/submitted діагностики:
- `Діагностика виконана`;
- якщо оплата проведена, raw `WAITING_PAYMENT` не повинен візуально трактуватися як `Очікує оплату`.

### 6.2. Діагностика

Компактний блок:
- `Діагностика виконана` / поточний workflow label;
- `checked / total`;
- `N дефектів`;
- дія `Відкрити ДК`.

Completion scope має бути сумісним з механікою submit: якщо присутня `SUSPENSION_MATRIX`, summary рахується за нею; інакше — за всіма inspection цього diagnostic.

### 6.3. Оплата

Компактний блок:
- badge: `Очікує оплату` / `Частково оплачено` / `Оплачено`;
- `Нараховано`;
- `Оплачено`;
- `Залишок`;
- остання оплата та спосіб, якщо є.

При `actual=true` не показувати `Ще не розраховано` на основі порожнього `estimatedAmount`.

## 7. Картка автомобіля

У drawer картки авто додати блок **«Фінанси поточного візиту»** перед клієнтським кабінетом:

- статус оплати;
- нараховано;
- оплачено;
- залишок;
- остання оплата;
- операційний стан поточного візиту.

Картка використовує той самий серверний `VisitFinancialState`, що й Планувальник.

Якщо активного appointment немає, можна показати останній візит як `Останній візит`, але не називати його поточним.

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
- Планувальник / картка авто при наступному відкритті або refresh читають `no-store` read-model;
- фінансовий endpoint має `Cache-Control: no-store`.

## 10. RBAC

- Endpoint не повинен відкривати фінанси неавторизованому користувачу.
- Для CRM-перегляду автомобіля достатньо `CLIENTS.READ` з чинним scope.
- Планувальник використовує endpoint тільки в уже авторизованому CRM-контексті.

## 11. Non-goals v1

- не створювати новий payment ledger;
- не мігрувати історичні платежі;
- не змінювати бухгалтерські проводки;
- не змінювати логіку refund/reversal;
- не дублювати `CashTransaction` або `FinancialObligation`.

## 12. Acceptance

1. Walk-in diagnostic: obligation 600, paid 600 → Planner показує `Оплачено 600 грн`, залишок 0, а не `Ще не розраховано`.
2. Unpaid: amount 600, paid 0 → `Очікує оплату`, залишок 600.
3. Partial: amount 600, paid 200 → `Частково оплачено`, залишок 400.
4. Full payment не змушує header роботи показувати `Очікує оплату`.
5. Planner і Vehicle Card отримують однакові `amount / paid / outstanding / status` для одного appointment.
6. Vehicle Card показує фінанси актуального/останнього візиту.
7. Submitted diagnostic показує фактичний summary і кнопку `Відкрити ДК`.
8. Після `PAY` механік не повертається автоматично на головний екран.
9. Після `PAY` доступні два post-payment маршрути.
10. Повторний `PAY` не створює дубль платежу (існуюча idempotency зберігається).
11. Endpoint без сесії повертає 401/403 згідно RBAC.
12. Production build, Module Scope, diagnostic/walk-in smoke і preview — PASS.
