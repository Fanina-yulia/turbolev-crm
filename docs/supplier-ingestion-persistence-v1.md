# Supplier Ingestion Persistence v1 — verification note

This stacked change is intentionally fail-closed and inactive in production by default.

Verification contract:
- Prisma schema validates.
- Full migration history replays on disposable PostgreSQL 18.
- TypeScript contracts compile.
- Supplier policy golden smoke passes.
- Persistence smoke covers batch idempotency, atomic commercial preflight, full-snapshot deactivation safety, reconciliation and legacy quote isolation.
- Advisory transaction locking uses `$executeRaw` because `pg_advisory_xact_lock` returns PostgreSQL `void`, which must not be deserialized through `$queryRaw`.

No API route, cron, webhook or supplier network adapter activates persistence in this change. Production writes remain disabled unless both activation gates are explicitly provided.
