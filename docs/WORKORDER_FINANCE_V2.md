# Turbo LEV CRM — WorkOrder Finance v2

## Мета

Другий фінансовий контур з'єднує операційний WorkOrder з Financial Core без подвійного обліку.

Ключова послідовність:

`WorkOrder → PLANNED snapshot → ACTUAL snapshot → P&L posting → Receivable → Payment → Cash Flow settlement`

## 1. PLANNED snapshot

`PUT /api/work-orders/{id}/finance`

Записує актуальну планову економіку замовлення-наряду. Джерелом сум має бути калькуляція CRM, а не Lead preliminary amount.

Поля:

- laborRevenue;
- partsRevenue;
- externalRevenue;
- otherRevenue;
- discountAmount;
- refundAmount;
- partsCost;
- laborCost;
- externalCost;
- consumablesCost;
- otherDirectCost;
- currency.

CRM сама рахує:

- gross revenue before discounts;
- net gross revenue;
- direct cost;
- gross profit;
- gross margin %.

PLANNED snapshot можна оновлювати до фіналізації ACTUAL.

## 2. ACTUAL finalization

`POST /api/work-orders/{id}/finance/finalize`

Фіналізація виконується однією DB transaction і:

1. блокує конкурентну повторну фіналізацію;
2. створює/фіксує ACTUAL snapshot;
3. постить revenue events у FinancialEvent;
4. постить COGS events у FinancialEvent;
5. створює клієнтську дебіторку FinancialObligation;
6. записує AuditEvent.

ACTUAL snapshot після фіналізації вважається immutable. Повторний запит з тим самим fingerprint є idempotent; запит з іншими сумами блокується і в майбутньому має проходити через окремий reversal/correction workflow.

### Discounts and refunds

Financial Core v1 не має окремої contra-revenue секції. Тому v2 не помилково класифікує знижки як OPEX. Замість цього чиста виручка після discount/refund пропорційно розподіляється між revenue buckets, а початкові gross amounts та reductions залишаються в ACTUAL snapshot.

## 3. Revenue recognition

Revenue створюється при explicit ACTUAL finalization, а не при оплаті.

Категорії:

- REV_LABOR;
- REV_PARTS;
- REV_EXTERNAL;
- REV_OTHER.

Це не дозволяє Cash In повторно збільшувати P&L.

## 4. COGS recognition

Прямі витрати постяться окремими фактами:

- COGS_PARTS;
- COGS_LABOR;
- COGS_EXTERNAL;
- COGS_CONSUMABLES;
- COGS_OTHER.

`COGS_OTHER` створюється як системна категорія при першій необхідності.

## 5. Receivable

Після ACTUAL finalization CRM створює одну дебіторську вимогу на суму net gross revenue.

Якщо revenue = 0, наприклад для окремого гарантійного сценарію, дебіторка не створюється.

Повторна фіналізація не дублює receivable.

## 6. Payment

`POST /api/work-orders/{id}/payments`

Платіж:

- не створює revenue;
- створює POSTED CashTransaction INFLOW;
- прив'язується до конкретного MoneyAccount;
- погашає FinancialObligation частково або повністю;
- не дозволяє оплату понад outstanding amount;
- потребує стабільний `idempotencyKey`, щоб подвійний клік або повтор HTTP-запиту не створив дубль.

Prepayment/advance понад поточну дебіторку у v2 навмисно не підтримується. Для цього потрібен окремий customer-advance liability workflow.

## 7. Money accounts

`GET /api/finance/accounts`

Повертає каси, банки, карти та еквайринг.

`POST /api/finance/accounts`

Створює реальний грошовий рахунок. CRM не seed-ить вигадані банківські або касові залишки.

## 8. Idempotency and concurrency

v2 використовує PostgreSQL transaction advisory locks для:

- WorkOrder finance plan update;
- ACTUAL finalization;
- payment posting.

FinancialEvent/FinancialObligation/CashTransaction мають стабільні `sourceEntity + sourceEntityId`, тому retry не створює повторний фінансовий факт.

## 9. Current limitations

v2 ще не робить автоматичну калькуляцію з WorkOrder line items, тому що canonical моделей `WorkOrderLine`, `WorkOrderPart` та `WorkOrderLabor` у CRM ще немає.

Наступний етап має створити саме ці операційні рядки, після чого PLANNED/ACTUAL snapshot буде формуватися без ручної передачі сум.

Також окремими етапами залишаються:

- supplier payable і supplier payment;
- customer advances;
- refunds/reversals after finalization;
- payroll accrual automation;
- strict WorkOrder status transition enforcement;
- payment calendar and cash forecast.
