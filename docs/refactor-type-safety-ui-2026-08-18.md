# Type-safety / UI decomposition batch — 2026-08-18

This batch intentionally preserves CRM business behavior while reducing unsafe UI/API boundaries.

## Included

- `LeadsBoardV2` split into contracts, model/runtime parsers, and presentational components.
- Lead API payloads enter client state only after `unknown`-based runtime parsing.
- `NewRequestWizardV5` contracts and model/normalization/parsing extracted from the client component.
- VIN, plate, users, vehicle catalog, planner and intake JSON responses are handled as `unknown` and narrowed before use.
- Security administration transaction helper uses `Prisma.TransactionClient` instead of `any`.

## Intentionally not changed

- Lead workflow semantics.
- Intake / booking business rules.
- Styling and user-facing text, except for accessibility-safe button attributes where needed.
- Existing custom validation stack; no framework migration or new validation dependency is introduced in this batch.
