# Vehicle Registry VIN Color Lookup — Hot-path fix

**Date:** 2026-10-04  
**PR:** #622

## Production evidence

`pg_stat_statements` ranked this query first by cumulative execution time:

```sql
SELECT color, "sourceYear"
FROM public."VehicleRegistryCompact"
WHERE upper(trim(vin))=$1
  AND color IS NOT NULL
  AND btrim(color) <> ''
ORDER BY "sourceYear" DESC
LIMIT 1
```

Observed window:

- calls: 47;
- total execution time: ~633,531 ms;
- mean execution time: ~13,479 ms;
- table rows: ~16.73M;
- shared blocks read: ~16.5M for the normalized statement.

## Root cause

The registry already has:

`VehicleRegistryCompact_vin_idx`

on the raw `vin` column.

Wrapping the indexed column in `upper(trim(vin))` prevents PostgreSQL from using that B-tree index for an ordinary equality lookup.

Application code already normalizes the input VIN before SQL:

- trim;
- uppercase;
- exact 17-character VIN validation.

Therefore the SQL-side expression is redundant.

## Corrected query

```sql
WHERE vin=$1
```

## Plan verification

Old shape, read-only `EXPLAIN`:

- Parallel Seq Scan;
- estimated plan cost ~543k.

Corrected shape, `EXPLAIN (ANALYZE, BUFFERS)`:

- Index Scan;
- index: `VehicleRegistryCompact_vin_idx`;
- execution time: ~1.355 ms;
- shared blocks: 3 hit + 2 read.

## Safety

- no database migration;
- no new index;
- no data mutation;
- no VIN validation change;
- regression contract prevents `upper(trim(vin))` from returning.
