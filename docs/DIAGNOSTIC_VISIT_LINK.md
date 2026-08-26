# Diagnostic visit → Diagnostic Card contract

## Canonical chain

`ServiceAppointment → DiagnosticVisitLink → DiagnosticRequest → DiagnosticCard`

`DiagnosticVisitLink` is the explicit visit-level identity of a diagnostic cycle. It prevents a card from being resolved only by `vehicleId`, which is ambiguous when the same vehicle has multiple visits.

## Creation

- Planner arrival links the appointment to the diagnostic request before diagnostic assignment/review is prepared.
- Mechanic walk-in links the generated appointment to the generated/reused diagnostic request.
- Follow-up repair appointments do not replace the original diagnostic visit link.
- Historical diagnostics can lazily recover the link from `AuditEvent`; vehicle identity is verified before persisting the backfill.

## Diagnostic Card snapshot

Every newly generated REVIEW/FINAL snapshot stores visit context when available: appointment id, planned/actual timestamps, location, post, mechanic, problem and source.

## Vehicle status

The diagnostic workflow icon is derived from the latest non-cancelled diagnostic cycle:

- red — no non-cancelled diagnostic;
- yellow — diagnostic is in progress or returned for rework;
- green — mechanic submitted a formed REVIEW card or the card is FINAL/confirmed.

The status target is always the exact `DiagnosticRequest.id`, so clicking the icon opens the corresponding Diagnostic Card.

## UI refresh

Mechanic diagnostic changes emit `turbolev:data-changed`. Vehicle cards and vehicle diagnostic history reload their server state from no-store endpoints, so a newly formed card is reflected without a manual page refresh when the relevant CRM surface is active or reopened.
