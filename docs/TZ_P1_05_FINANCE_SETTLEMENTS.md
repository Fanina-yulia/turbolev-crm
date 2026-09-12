# P1-05 — Payments, advances, refunds and supplier payables

## Goal

Close the cash-to-obligation loop without replacing existing factual finance tables:

- CashTransaction remains the cash fact.
- FinancialObligation remains the receivable/payable fact.
- FinancialSettlement is the idempotent operation envelope and allocation journal.
- FinancialSettlementAllocation records exactly which obligation a settlement changes.
- Every mutation is transactional, locked and audited.

## Supported flows

1. Customer payment: RECEIVABLE -> CashTransaction INFLOW -> FinancialSettlement PAYMENT -> allocation -> obligation settledAmount/status.
2. Supplier payment: PAYABLE -> CashTransaction OUTFLOW -> FinancialSettlement SUPPLIER_PAYMENT -> allocation -> payable settledAmount/status.
3. Customer advance receipt: CashTransaction INFLOW -> CustomerAdvance -> FinancialSettlement ADVANCE_RECEIPT.
4. Advance application: CustomerAdvance appliedAmount + receivable settledAmount + FinancialSettlement ADVANCE_APPLY allocation; no second cash movement.
5. Unused advance return: CashTransaction OUTFLOW + FinancialSettlement ADVANCE_REFUND; applied remainder is protected.
6. Settlement reversal: compensating CashTransaction + FinancialSettlement REFUND; original settlement is marked REVERSED and the obligation is reopened/partially paid.

## APIs

- GET/POST /api/finance/settlements
- GET/POST /api/finance/payables
- GET/POST /api/finance/advances
- POST /api/finance/v2 with CREATE_CUSTOMER_ADVANCE, APPLY_CUSTOMER_ADVANCE and REFUND_CUSTOMER_ADVANCE now routes to the canonical settlement service.

POST /api/finance/settlements accepts direction, obligationId, amount, moneyAccountId, occurredAt and idempotencyKey.
POST /api/finance/payables accepts the same payment fields and forces direction PAYABLE.
POST /api/finance/advances accepts action RECEIVE, APPLY or REFUND.
POST /api/finance/settlements with action REVERSE accepts settlementId.

## Invariants

- Amounts are positive, rounded to two decimals and cannot exceed outstanding obligation/advance balance.
- Account must be active and have the same currency.
- Location scope is checked before reading or changing a financial row.
- Repeating the same sourceEntity/sourceEntityId or idempotency key returns the original result and creates no second cash fact.
- A reversed settlement cannot be reversed twice.
- An applied advance cannot be returned for more than its unused remainder.
- All changes generate AuditEvent records.

## Acceptance criteria

- Partial and full customer payments update receivable status OPEN/PARTIALLY_PAID/PAID.
- Partial and full supplier payments update payable status OPEN/PARTIALLY_PAID/PAID.
- Overdue obligations remain OVERDUE until a payment changes the settled amount.
- Customer advance receipt, application and unused return are visible in one settlement history.
- A payment reversal creates a compensating cash fact and reopens the linked obligation.
- Existing expense posting and subsequent expense payments create settlement records alongside the existing payable/cash facts.
- Contract smoke and production build pass.
