# Diagnostic flow smoke test

`scripts/diagnostic-flow-smoke.ts` verifies the agreed Turbo LEV diagnostic workflow against a disposable PostgreSQL database in CI.

Covered invariants:

- booked appointment arrival creates exactly one diagnostic request;
- mechanic start moves diagnostics from `PENDING` to `IN_PROGRESS` and creates structured checks;
- completed required checks allow submission to the service manager;
- WorkOrder creation is blocked before diagnostic confirmation;
- submitting or confirming diagnostics does not auto-create a WorkOrder;
- confirmed diagnostics can create an active client diagnostic-card share;
- active share exposes the `CARD_SENT` business state (`Надіслана ДК`);
- WorkOrder is created only after an explicit next-step action;
- a follow-up booked visit with the WorkOrder reuses the confirmed diagnostic instead of creating a second diagnostic cycle.

The smoke test creates isolated records with a unique suffix and removes them in `finally`.