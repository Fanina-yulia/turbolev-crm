# Turbo LEV CRM — Real Vehicle E2E Gate

## Purpose

This gate validates the production CRM on real service traffic. It must not be satisfied with demo fixtures, synthetic customers, fake payments, or manually fabricated WorkOrders.

The canonical requirement is **10–20 distinct real vehicles** that have completed the operational chain with evidence stored in CRM.

## Core evidence per vehicle

The read-only audit checks the latest service cycle for each real vehicle:

1. appointment exists;
2. factual arrival is recorded;
3. diagnostic request exists;
4. diagnostics are confirmed;
5. FINAL DiagnosticCard revision exists;
6. WorkOrder exists;
7. estimate exists;
8. estimate is approved;
9. required-parts request exists when the repair actually requires parts;
10. required parts are received when applicable;
11. at least one WorkOrder line is factually completed;
12. QC is completed;
13. ACTUAL WorkOrderFinanceSnapshot exists;
14. posted payment or paid receivable evidence exists;
15. WorkOrder is closed.

A repair with no `requiredForRepair` part lines is not forced to create a fake PartsRequest. Its parts stages are treated as not applicable / passed.

## Safety contract

`npm run e2e:real:readiness` is deliberately **read-only**:

- database transaction begins `READ ONLY`;
- the script performs SELECT-only evidence collection;
- it is not part of `npm run build`;
- it cannot create Client, Vehicle, Appointment, DiagnosticRequest, WorkOrder, PartsRequest, QC, finance, payment or portal records;
- vehicle plates are masked in output by default;
- exact identifiers require explicit `E2E_AUDIT_INCLUDE_IDENTIFIERS=1`;
- the default gate is PASS only when at least 10 distinct real vehicles are complete.

A blocked gate exits with code `2`; execution/configuration failures exit with code `1`.

## Production baseline — 2026-08-23

Initial read-only production inventory:

- real vehicles: **8**;
- vehicles with plates: **8**;
- real service appointments: **8**;
- real diagnostic requests: **1**;
- real WorkOrders: **0**;
- ACTUAL/PLANNED finance snapshots attached to real WorkOrders: **0**;
- real PartsRequests: **0**;
- real WorkOrder QC rows: **0**.

Operational readiness findings from the same read-only check:

- seven past/current appointments are still `BOOKED` without factual arrival/end evidence;
- one vehicle is `ARRIVED` and has a diagnostic request in `IN_PROGRESS`;
- no real appointment has reached a WorkOrder yet.

Therefore the canonical 10–20 vehicle E2E gate is currently **BLOCKED BY REAL TRAFFIC / OPERATIONAL COMPLETION**, not by a synthetic test failure.

## Rule for completion

Do not mark this phase DONE until the audit reports at least 10 complete real vehicles and the corresponding production UI/API paths have no runtime errors.

The vehicles must advance through CRM as part of normal service operations. Do not change old production statuses merely to make the metric pass.

After the first 10 complete vehicles:

1. run the read-only audit against production;
2. inspect blockers for any partial cycles;
3. verify production runtime logs;
4. verify at least one real mixed estimate/client-portal decision where the workflow requires it;
5. record the evidence date and final count here;
6. only then move the canonical roadmap to cosmetics / MVS.
