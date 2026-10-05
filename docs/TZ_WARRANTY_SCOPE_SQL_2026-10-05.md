# TURBO LEV CRM — Warranty Location Scope Optimization

**Date:** 2026-10-05  
**Branch:** `perf/warranty-scope-sql-20261005`

## 1. Problem

Warranty endpoints preloaded location access like this:

```text
ServiceAppointment
→ DISTINCT workOrderId
→ take 5000 / 10000
→ Node.js array
→ Warranty query / access check
```

This has two defects:

1. unnecessary DB → Node → DB work;
2. correctness truncation: after a location accumulates more than 5k/10k linked WorkOrders, older otherwise-authorized WorkOrders can fall outside the preload and appear missing or forbidden.

## 2. Target architecture

### Warranty list

For LOCATION/TEAM scope PostgreSQL selects eligible warranty line IDs directly:

- WorkOrderLine.type = LABOR;
- WorkOrderLine.status = COMPLETED;
- closed WorkOrder;
- warrantyKm > 0 or warrantyDays > 0;
- optional WorkOrder/search filters;
- correlated `EXISTS ServiceAppointment` for an allowed location;
- only the final list is bounded to 500 rows.

The final 500 line IDs are then hydrated by Prisma with client, vehicle and claims.

### Point mutations

POST/PATCH/cost actions must not preload historical WorkOrders.

A single WorkOrder is authorized with:

```sql
SELECT EXISTS (
  SELECT 1
  FROM "ServiceAppointment"
  WHERE "workOrderId" = ?
    AND "locationId" IN (...)
)
```

## 3. Permission semantics

Existing behavior is preserved:

- non-ENFORCED → unrestricted;
- ALL → unrestricted;
- LOCATION / TEAM → allowed locations;
- any other restricted scope → fail closed.

Main warranty claim POST/PATCH continues using the existing WARRANTY_READ location-scope semantics after the route has already required WARRANTY_WRITE.

Warranty cost recording uses WARRANTY_WRITE scope.

## 4. Safety

- no Prisma schema change;
- no migration;
- no production data mutation;
- all raw SQL values are parameterized with `Prisma.sql` / `Prisma.join`;
- request-supplied WorkOrder IDs never grant access;
- unrestricted ALL behavior remains unchanged.

## 5. Acceptance criteria

1. no warranty scope preload with `take: 5000`;
2. no warranty cost scope preload with `take: 10000`;
3. no `distinct workOrderId` location preload in warranty routes;
4. restricted list scope is applied in PostgreSQL before the final 500-row bound;
5. point authorization uses a single SQL EXISTS;
6. warranty regression smoke passes in production build;
7. TypeScript/Next build passes on exact commit;
8. exact-commit Vercel preview is READY;
9. merged production deployment is READY;
10. new deployment has no error/fatal regression.
