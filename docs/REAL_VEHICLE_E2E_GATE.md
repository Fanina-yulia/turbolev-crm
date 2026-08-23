# Turbo LEV CRM — Real Vehicle E2E Gate

## Purpose

This gate validates the production CRM on real service traffic. It must not be satisfied with demo fixtures, synthetic customers, fake payments, or manually fabricated WorkOrders.

The canonical requirement is **10–20 distinct real vehicles** that have completed the operational chain with evidence stored in CRM.

The audit evaluates real service cycles from the recent production window and counts a vehicle only once toward the PASS threshold, even if the same vehicle has multiple completed visits.

## Core evidence per completed vehicle

A complete WorkOrder cycle must prove:

1. an appointment linked to the WorkOrder exists;
2. factual arrival is recorded;
3. the WorkOrder has its diagnostic request;
4. diagnostics are confirmed;
5. a FINAL DiagnosticCard revision exists;
6. WorkOrder exists;
7. estimate exists;
8. estimate is approved;
9. required-parts request exists when the repair actually requires parts;
10. received/installed quantities cover each non-cancelled `requiredForRepair` part line;
11. at least one WorkOrder line is completed and no non-cancelled line remains active;
12. QC is completed;
13. ACTUAL WorkOrderFinanceSnapshot exists;
14. ACTUAL gross revenue is fully covered by posted inflow or a fully paid receivable;
15. WorkOrder is closed.

A repair with no non-cancelled `requiredForRepair` part lines is not forced to create a fake PartsRequest. Its parts stages are treated as not applicable / passed.

Appointments and diagnostics that have not reached a WorkOrder are still returned as partial cycles so their blockers remain visible, but they cannot count as complete vehicles.

## Safety contract

`npm run e2e:real:readiness` is deliberately **read-only**:

- database transaction begins `READ ONLY`;
- the script performs SELECT-only evidence collection and rolls the transaction back;
- it is not part of `npm run build`;
- it cannot create Client, Vehicle, Appointment, DiagnosticRequest, WorkOrder, PartsRequest, QC, finance, payment or portal records;
- vehicle plates and internal IDs are masked in output by default;
- exact identifiers require explicit `E2E_AUDIT_INCLUDE_IDENTIFIERS=1`;
- default lookback is 180 days and can only be configured within 30–365 days;
- the PASS threshold defaults to 10 and can only be configured within the canonical 10–20 vehicle range.

A blocked gate exits with code `2`; execution/configuration failures exit with code `1`.

## Production baseline — 2026-08-23

Initial read-only production inventory:

- real vehicles: **8**;
- vehicles with plates: **8**;
- real ServiceAppointment records: **8**;
- distinct vehicles currently represented by a recent service cycle: **7**;
- real diagnostic requests: **1**;
- real WorkOrders: **0**;
- finance snapshots attached to real WorkOrders: **0**;
- real PartsRequests: **0**;
- real WorkOrder QC rows: **0**.

The final cycle-consistent SQL verification returned:

- **7** appointment cycles;
- **0** WorkOrder cycles;
- **0** cycles with ACTUAL finance;
- **0** paid cycles;
- **0** cycles with completed QC.

Operational readiness findings:

- six current audited cycles are still `BOOKED`; five of those have already passed their planned start, while one is an upcoming booking;
- one vehicle is `ARRIVED` and has a diagnostic request in `IN_PROGRESS` without confirmation;
- no real appointment has reached a WorkOrder yet.

Therefore the canonical 10–20 vehicle E2E gate is currently **BLOCKED BY REAL TRAFFIC / OPERATIONAL COMPLETION**, not by a synthetic test failure.

## Rule for completion

Do not mark this phase DONE until the audit reports at least 10 distinct complete real vehicles and the corresponding production UI/API paths have no runtime errors.

The vehicles must advance through CRM as part of normal service operations. Do not rewrite old production statuses, create synthetic repairs, fabricate payments, or manually insert WorkOrders merely to make the metric pass.

After the first 10 complete vehicles:

1. run the read-only audit against production;
2. inspect blockers for any partial cycles;
3. verify production runtime logs;
4. verify at least one real mixed estimate/client-portal decision where the workflow requires it;
5. record the evidence date and final count here;
6. only then move the canonical roadmap to cosmetics / MVS.
