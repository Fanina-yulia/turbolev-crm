# TURBO LEV CRM — P2-03 Customer LTV v1

## 1. Мета

Додати управлінський показник довгострокової економічної цінності клієнта без підміни LTV оборотом і без створення паралельного customer/finance ledger.

## 2. Canonical identity

Customer identity v1 = `Client.id`.

- усі авто клієнта агрегуються через canonical `Vehicle.clientId` / `WorkOrder.clientId`;
- два або більше авто одного клієнта не створюють окремі LTV;
- phone залишається унікальним ідентифікаційним атрибутом Client, але розрахунок не групує по текстовому телефону;
- demo entities виключаються.

Нова CustomerDimension у v1 не створюється, бо canonical Client уже існує.

## 3. Визначення LTV v1

### 3.1 Net revenue

Джерело: locked `WorkOrderFinanceSnapshot(kind=ACTUAL)` закритих Work Order.

`grossRevenue` в canonical finance domain вже дорівнює:

`labor + parts + external + other − discount − refund`.

Тому refund не додається вдруге і не може завищувати LTV.

### 3.2 Lifetime gross profit

`Σ ACTUAL grossProfit` всіх закритих Work Order canonical клієнта в доступному station scope.

### 3.3 Warranty cost

Тільки `WarrantyClaimCostFact`, створений у P2-02. Primary repair price/revenue або первинна собівартість не використовуються як warranty cost.

### 3.4 LTV contribution

`LTV contribution = lifetime gross profit − factual warranty cost`.

Це **gross contribution before OPEX/CAC**, а не net profit клієнта.

### 3.5 CAC

У v1 `acquisitionCost = n.a.`. Lead source може бути показаний, але витрати маркетингу не віднімаються, доки немає canonical client-level acquisition-cost attribution. Будь-яке ділення рекламних витрат «на око» заборонене.

## 4. Coverage gate

Primary LTV показується тільки коли одночасно:

1. кожен закритий Work Order клієнта в scope має `ACTUAL` finance snapshot;
2. snapshot locked/finalized;
3. усі snapshots мають одну валюту;
4. кожен warranty claim клієнта має factual cost fact (для нульової витрати має бути explicit 0 fact);
5. warranty cost facts сумісні з валютою lifetime cohort.

Інакше:

- `lifetimeRevenue = null`;
- `lifetimeGrossProfit = null`;
- `warrantyCost = null`;
- `lifetimeContribution = null`;
- UI показує finance/warranty coverage та конкретні blockers.

CRM не екстраполює missing facts.

## 5. Customer metrics

Для canonical Client:

- visits = count closed Work Orders;
- distinct vehicles;
- lifetime net revenue;
- lifetime gross profit;
- factual warranty cost;
- lifetime contribution;
- average check;
- gross margin %;
- first / last closed visit;
- lifetime days;
- days since last visit;
- earliest factual Lead.source, якщо є;
- finance coverage %;
- warranty cost coverage %.

## 6. Cohort

В Owner Analytics глобальний період визначає cohort: клієнти, які мали закритий Work Order у вибраному періоді.

Для кожного клієнта cohort показується весь доступний lifetime у дозволеному location scope.

Aggregate cohort LTV показується тільки якщо всі клієнти cohort complete. Інакше aggregate money KPI = n.a. і показується coverage.

## 7. Client card

У `Клієнти → картка клієнта` додається блок «Цінність клієнта»:

- LTV contribution;
- visits / vehicles;
- net revenue;
- gross profit;
- warranty cost;
- average check;
- margin;
- acquisition source;
- first/last visit;
- days since last visit;
- coverage warning;
- explicit `CAC: n.a.`;
- drill-down до останнього Work Order.

Доступ до фінансових значень має тільки користувач із:

- `CLIENTS.READ`;
- `ANALYTICS.READ`;
- `ANALYTICS.FINANCIAL_READ`.

Station scope не може бути розширений запитом clientId.

## 8. API

`GET /api/analytics/client-ltv/[clientId]`

Server-side:

- provisioning/auth check;
- Clients permission;
- Analytics + Financial Analytics permissions;
- location scope through linked ServiceAppointment/WorkOrder;
- private no-store.

## 9. Existing owner economics

`owner-analytics-economics.service.ts` перестає мати власну спрощену LTV-формулу і використовує canonical `getCustomerLifetimeMetrics()`.

Таким чином card і cohort analytics не можуть розійтися у визначенні LTV.

## 10. Non-goals v1

- CAC без factual attribution;
- allocation OPEX до клієнта;
- прогнозований future LTV;
- probabilistic churn score;
- dedupe/merge різних Client rows за fuzzy identity;
- currency conversion без canonical FX facts.

## 11. Acceptance

1. Два авто одного `Client.id` входять в один LTV.
2. Refund зменшує net revenue через canonical ACTUAL finance calculation, не дублюється окремо.
3. Warranty cost віднімається тільки з `WarrantyClaimCostFact`.
4. Missing ACTUAL snapshot → LTV n.a., coverage <100%.
5. Missing warranty cost fact → LTV n.a., coverage <100%.
6. Mixed currency → LTV n.a.
7. CAC завжди n.a. у v1.
8. Client card і Owner Analytics використовують один service/read-model.
9. Client endpoint server-side захищений RBAC і location scope.
10. Static contract `scripts/check-customer-ltv.mjs` входить у production build.
11. No DB migration in P2-03.
12. Module Scope / schema validation / migration drift / security / typecheck / production build / preview PASS.
13. Після merge production deployment READY.
14. Production smoke: root 200, unauth client-LTV endpoint 401, runtime error/fatal 0.
15. Authenticated financial data-path не позначати «Перевірено», доки немає реальної authorized session.
