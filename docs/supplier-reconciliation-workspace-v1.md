# Supplier reconciliation workspace v1

## Scope

ENG-SUP-002 adds a staff-only reconciliation queue for supplier import rows that cannot be safely auto-mapped.

## Safety contract

- Read requires `PROCUREMENT.READ`; mutations require `PROCUREMENT.WRITE` when RBAC enforcement is active.
- UI/API never return `SupplierImportRecord.rawPayload`.
- Evidence DTOs recursively redact credential-like keys (`secret`, `token`, `password`, `authorization`, `credential`, `apiKey`).
- Manual resolution may point only to an `ACTIVE` canonical `Product`.
- Resolve/repoint updates mapping + import record + reconciliation task + `AuditEvent` in one database transaction.
- Reject never auto-disables an existing mapping; that requires a separate controlled action.
- Escalation never creates a Product automatically.
- No reconciliation action creates or updates `SupplierOffer`.
- No reconciliation action mutates `InventoryBalance` or submits a supplier order.
- Commercial publication remains behind the normal supplier ingestion/publish gate.

## Workspace

`Закупівлі та склад` is wrapped by `PartsProcurementWorkspace` with two modes:

1. Operational queue — existing sourcing/order/receiving flow.
2. Reconciliation — supplier identity review and controlled mapping.

The selected mode is reflected only by the non-sensitive `procurementView` query parameter.

## Verification

CI must pass:

- Module Scope
- CRM Production Build / TypeScript
- Supplier Ingestion Policy
- Supplier Ingestion Persistence
- Supplier Reconciliation Workspace

The reconciliation DB smoke applies the full migration history to disposable PostgreSQL 18 and verifies:

- approved MANUAL mapping creation;
- controlled mapping repoint without duplicate mapping;
- import-record/task state transitions;
- audit events;
- reject and catalog-authoring escalation without Product auto-create;
- zero `SupplierOffer` publication;
- secret evidence redaction;
- inactive Product exclusion from manual search.

Production supplier write activation, pricing changes, DB migration execution, and supplier-order submission are outside this PR.
