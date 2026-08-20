# Business-process tasks — phase 2

Phase 2 extends the personal task queue beyond leads and inbound inquiries.

## Automated sources

- Estimate sent for approval → service manager task.
- Parts request → task follows its current selection / approval / ordering / receiving stage and is reassigned to the appropriate operational role.
- Receivable → payment task for accounting / station management until fully settled.
- Quality control → QC task for station management; failed or recheck states are escalated.
- Warranty claim → warranty handling task for station management until rejected or closed.

## Context links

Auto-generated tasks store their work-order context in metadata. **Open context** routes directly to the matching work order and tab (estimate, parts, payment, QC, history) rather than only opening a broad CRM section.

## Lifecycle

Tasks use stable dedupe keys. A workflow state change updates the same task rather than creating duplicates, and a terminal workflow state closes the task automatically.
