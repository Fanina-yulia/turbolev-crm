# WorkOrder Line Items v3

Financial Core v3 makes `WorkOrderLine` the canonical source of WorkOrder economics whenever at least one line exists for a WorkOrder.

## Why this exists

The v2 finance layer accepted aggregated amounts such as labor revenue, parts revenue and parts cost. That is safe for posting, but it is not enough for an operational CRM because the same information would have to be re-entered in calculation, parts purchasing, mechanic work and finance.

v3 replaces that duplication with one line-item layer.

## Line types

- `LABOR` — internal service work.
- `PART` — parts sold to the customer.
- `EXTERNAL` — subcontracted/external work.
- `CONSUMABLE` — fluids and consumables.
- `OTHER` — other directly attributable WorkOrder revenue/cost.

## Status lifecycle

Canonical path:

`DRAFT → APPROVED → IN_PROGRESS → COMPLETED`

A non-completed line can instead move to `CANCELLED`.

`COMPLETED` and `CANCELLED` are terminal for status transitions in v3.

## Planned vs actual

Each line stores a planned quantity, sale price, direct unit cost and line discount.

Actual quantity, price, cost and discount are optional. If an actual value is not explicitly supplied, completed-line finance falls back to the corresponding planned value. This lets the service manager confirm a job without retyping unchanged values while still supporting real plan/fact differences.

## Automatic planned finance

Every line create/update/cancel operation rebuilds the WorkOrder `PLANNED` finance snapshot in the same database transaction.

Mapping:

- `LABOR` → labor revenue / labor direct cost
- `PART` → parts revenue / parts cost
- `EXTERNAL` → external revenue / external cost
- `CONSUMABLE` → other revenue / consumables cost
- `OTHER` → other revenue / other direct cost

Line discounts are aggregated into WorkOrder discount. They are not treated as operating expense.

## Actual finalization gate

When canonical lines exist, `/finance/finalize` ignores manually supplied aggregate amounts and derives ACTUAL finance from line items.

Finalization is blocked until every line is either `COMPLETED` or `CANCELLED`.

Only completed lines enter ACTUAL revenue and direct cost.

Before P&L posting, v3 locks an ACTUAL snapshot with the line-item finance fingerprint. Once locked, line mutations are rejected. This closes the race window between calculating actual economics and posting P&L/receivables.

The v2 posting engine then performs the existing idempotent operations:

`ACTUAL snapshot → revenue/COGS events → receivable → payment settlement`

## Work price catalog integration

A LABOR line can be created with `catalogItemId` referring to an active `WORK_PRICE` directory item.

The line freezes the current catalog name/code/unit/price/norm-hours as WorkOrder data. Later catalog price edits do not rewrite historical WorkOrder economics.

## Supplier quote integration

A PART line can be created with `supplierQuoteId`.

The line freezes:

- supplier quote identity;
- supplier identity;
- article and brand;
- current purchase price;
- current quote currency;
- calculated customer sale price;
- applied markup percentage in metadata.

If no explicit markup is supplied, the supplier default markup is used. If the supplier quote is expired, creating the line is rejected so the parts manager must refresh the quote first.

Later supplier price changes do not alter the WorkOrder line.

## Currency rule

A WorkOrder may contain line items in different currencies while still being drafted, but finance finalization is blocked if completed line items span more than one currency.

FX conversion is intentionally not invented in v3. A future multi-currency layer must use explicit exchange-rate facts.

## API

### Read line items

`GET /api/work-orders/{workOrderId}/lines`

Returns lines, status counts, planned calculation, actual preview and whether the WorkOrder is ready for actual finalization.

### Add manual line

`POST /api/work-orders/{workOrderId}/lines`

Example payload:

```json
{
  "type": "LABOR",
  "description": "Заміна переднього амортизатора",
  "plannedQuantity": 2,
  "plannedUnitPrice": 1400,
  "plannedUnitCost": 500,
  "unit": "шт"
}
```

### Add labor from the work-price directory

```json
{
  "catalogItemId": "<WORK_PRICE directory id>",
  "plannedQuantity": 1
}
```

### Add a part from a supplier quote

```json
{
  "supplierQuoteId": "<SupplierProductQuote id>",
  "plannedQuantity": 2
}
```

Optional `markupPercent` overrides supplier default markup for that line.

### Update line / workflow status

`PATCH /api/work-orders/{workOrderId}/lines/{lineId}`

Examples include assigning a mechanic, setting actual cost/quantity, or moving the line through its lifecycle.

### Remove planned line

`DELETE /api/work-orders/{workOrderId}/lines/{lineId}`

This is a soft financial cancellation: the row remains for audit history and moves to `CANCELLED`.

## Legacy compatibility

Existing WorkOrders with no canonical lines keep the v2 aggregate finance API behavior.

Once a WorkOrder has at least one `WorkOrderLine`:

- line items become its finance source of truth;
- `PUT /finance` rebuilds PLANNED from lines instead of accepting manual aggregate overrides;
- `POST /finance/finalize` derives ACTUAL from completed lines.

There is no automatic backfill because the CRM must never invent historical line details that do not exist in source data.

## Next steps

1. WorkOrder calculation UI with line editor and live margin.
2. Customer approval at line/calculation level.
3. Supplier order creation directly from approved PART lines.
4. Warehouse reservation/issue against PART and CONSUMABLE lines.
5. Mechanic assignment and labor compensation rules against LABOR lines.
6. Actual-vs-planned variance analytics per line, WorkOrder and location.
7. Reversal/correction workflow for already-finalized WorkOrders.
