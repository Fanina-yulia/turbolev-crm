# TURBO LEV CRM — Vehicle Image Deduplication + Database Observability

**Date:** 2026-10-04  
**Branch:** `fix/image-queue-db-observability-20261004`  
**Base production commit:** `3999e8c9f19b1c46684927c3c9d220cffa9b2a2f`

## 1. Goals

1. Eliminate runtime errors caused by the partial unique index:
   `VehicleImageLibraryAsset_template_variant_unique`.
2. Keep one canonical image asset for the same `templateKey + variantKey`, even when prompt/library versions produce a different `libraryKey`.
3. Enable PostgreSQL statement observability with `pg_stat_statements`.
4. Store bounded daily snapshots so Turbo LEV can compare cumulative query workload over 7–14 days.
5. Expose the data only through strict ALL-scope integration administration.
6. Keep production application builds read-only; DB changes remain in the explicit database release step.

## 2. Root cause of the image error

The image library has two uniqueness contracts:

- `libraryKey` is unique;
- `(templateKey, variantKey)` is also unique when both are non-null.

The previous queue INSERT handled only:

```sql
ON CONFLICT ("libraryKey") DO UPDATE
```

When a new prompt/library version generated a different `libraryKey` for an already existing template/color pair, PostgreSQL correctly raised a duplicate-key error on `VehicleImageLibraryAsset_template_variant_unique`.

## 3. Image fix

The queue now:

1. resolves an asset by either `libraryKey` or `templateKey + variantKey`;
2. serializes queue registration with an advisory transaction lock based on the template and variant, not only the library key;
3. uses `INSERT ... ON CONFLICT DO NOTHING` so either unique constraint is safe;
4. re-selects and updates the canonical row;
5. creates the generation job using the canonical asset ID and canonical library key;
6. returns READY immediately if another concurrent request completed the asset while the caller waited for the lock.

The direct generation path uses the same identity-aware lookup and conflict-safe claim strategy.

No unique index is removed. The database invariant stays intact.

## 4. pg_stat_statements

Migration:

`20261004143000_database_query_observability`

enables:

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

and creates `DatabaseQueryStatSnapshot`.

Neon documents `pg_stat_statements` as the supported mechanism for cumulative statement execution statistics. The application does not log bind values itself.

## 5. Snapshot model

Each snapshot stores, per normalized query ID:

- cumulative calls;
- cumulative execution time;
- mean execution time;
- cumulative returned rows;
- shared blocks hit/read;
- normalized query text;
- pg_stat_statements reset timestamp;
- capture timestamp.

Retention: **35 days**.

Daily snapshot size is bounded to the union of the top 200 statements by:

- total execution time;
- call count.

## 6. 7/14 day ranking

The protected read service compares current cumulative values with the first available daily baseline inside the requested window.

If full history is not yet available, the response explicitly marks:

`window.partial = true`.

If `pg_stat_statements` was reset after the baseline, the response explicitly marks:

`window.resetDetected = true`

and avoids returning a negative delta.

## 7. Protected API

`GET /api/settings/database-observability?days=14&limit=25`

requires:

- authenticated CRM session;
- `SETTINGS.INTEGRATIONS`;
- strict enforcement;
- scope `ALL`.

Response includes:

- current top SQL by cumulative execution time;
- current top SQL by calls;
- requested-window top SQL by execution-time delta;
- requested-window top SQL by calls delta;
- snapshot coverage;
- sequential-scan/table statistics.

## 8. Daily collection

Vercel Cron:

`/api/internal/database-observability-snapshot`

schedule:

`17 2 * * *` UTC.

Authorization:

- `CRON_SECRET` bearer when configured;
- trusted `vercel-cron/*` fallback only when the secret is absent.

Unauthorized callers receive 404.

## 9. Safety

The release does **not**:

- reset `pg_stat_statements`;
- run EXPLAIN automatically;
- log SQL bind values;
- expose SQL statistics to ordinary staff;
- run Prisma migration during Vercel application build;
- remove or weaken image uniqueness constraints.

## 10. Acceptance criteria

1. TypeScript passes.
2. Full migration history passes on PostgreSQL 18 CI.
3. Prisma drift check passes.
4. API policy smoke passes.
5. DB observability contract smoke passes.
6. Exact-commit Vercel preview is READY.
7. Controlled `db:release` applies the migration to production.
8. Production deployment is READY.
9. `pg_stat_statements` is confirmed installed.
10. An initial snapshot is captured.
11. New production deployment has no `VehicleImageLibraryAsset_template_variant_unique` runtime errors.

## 11. Expected collection timeline

- immediately after release: current cumulative SQL ranking becomes available;
- after first snapshot: baseline history exists;
- after 7 days: representative 7-day delta becomes available;
- after 14 days: representative 14-day delta becomes available.

This is intentionally evidence-based. Index recommendations should be made only after the collected workload proves which queries dominate actual database time.
