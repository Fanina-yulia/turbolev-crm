# TURBO LEV CRM — TECH SPEC: Deployment Pipeline, DB Access, Polling & RBAC Optimization

**Date:** 2026-10-04  
**Status:** Implemented in branch `fix/deployment-db-rbac-polling-20261004`  
**Scope:** production deployment safety, database access pressure, authorization hot path, high-frequency client polling  
**Out of scope:** business workflow redesign, Prisma schema changes, supplier search logic, UI redesign

## 1. Objective

Stabilize production delivery and reduce avoidable database/API load without changing CRM business behavior. The release must be reversible, must not require a data migration, and must preserve fail-closed authorization.

## 2. Problems being solved

### 2.1 Production build mutates production data

The application build previously ran `prisma migrate deploy` when `VERCEL_ENV=production`, and ran the parts knowledge seed after compilation. This coupled artifact creation to database mutation.

Failure mode:

1. deployment starts;
2. migration changes production schema;
3. application compilation or a contract test fails;
4. previous application artifact remains live against a changed database.

This violates atomic-release principles.

### 2.2 RBAC work is repeated on every protected request

A protected API call rebuilds access state from database data: security mode, user mapping, role assignments, role permissions, permission overrides and location scope. High-frequency UI polling magnifies this cost.

### 2.3 Polling is too aggressive while idle and can overlap

The telephony bridge polled every 2.5 seconds even with no active call. Communications polled every 7 seconds. Mechanic notifications polled every 15 seconds. Fixed `setInterval` can schedule a new request before the previous request completes.

### 2.4 Access caching must have bounded staleness

Caching authorization is acceptable only when:

- TTL is short;
- concurrent misses are coalesced;
- role/user/override mutations invalidate the cache;
- stale in-flight loaders cannot repopulate an invalidated cache;
- authorization remains fail-closed.

## 3. Target architecture

### 3.1 Deployment

```text
feature branch
  -> Pull Request
  -> GitHub CI
     - npm ci
     - Prisma validation
     - optimization contract checks
     - TypeScript
     - clean PostgreSQL migration replay
     - Prisma drift check
     - security/workflow smoke tests
     - Next.js production build
  -> merge to main
  -> Vercel application build (READ-ONLY to production DB)
  -> publish artifact
```

Database release becomes a separate explicit operation:

```text
controlled release step
  -> ALLOW_PRODUCTION_DB_RELEASE=1
  -> prefer DATABASE_URL_UNPOOLED / DIRECT_URL
  -> prisma migrate deploy
  -> idempotent canonical parts terminology seed
```

The application build MUST NOT execute migrations, seeds, imports, backfills or any other production mutation.

### 3.2 RBAC cache

Per warm server instance:

- security mode TTL: **15 seconds**;
- effective RBAC snapshot TTL: **20 seconds**;
- concurrent misses for the same key share one Promise;
- security/personnel access mutations clear the cache;
- cache invalidation increments an epoch, preventing an already-running stale loader from re-populating the cache after invalidation.

Cached payload contains only:

- role list;
- computed permission scopes;
- denied permissions;
- location IDs.

It does **not** cache request headers, cookies, owner view-as state or another user's auth identity.

### 3.3 Last-seen writes

Increase minimum `lastSeenAt` touch interval from **2 minutes** to **5 minutes**. This reduces write amplification while keeping operational presence sufficiently current.

### 3.4 Adaptive polling

Optimized pollers use recursive `setTimeout`, not fixed `setInterval`.

Required behavior:

- one request maximum in flight per poller;
- hidden tabs stop scheduling;
- returning to a visible tab triggers immediate refresh;
- optional window-focus refresh;
- next timer is scheduled only after the current request finishes.

Intervals:

| Surface | Active | Idle |
|---|---:|---:|
| Telephony live | 2.5 s | 8 s |
| Communications inbox | 15 s | 15 s |
| OLX poll | 60 s | 60 s |
| Mechanic notifications | 30 s | 30 s |
| Binotel reconciliation | 30 min | 30 min |

Telephony keeps the 2.5-second cadence only while a call is `RINGING` or `ANSWERED`.

## 4. Database access requirements

1. Runtime continues using the pooled `DATABASE_URL`.
2. Database release prefers `DATABASE_URL_UNPOOLED`, then `DIRECT_URL`, then the existing Neon pooler-to-direct normalization fallback.
3. Production application build must compile without touching production data.
4. This optimization package introduces no Prisma schema change.
5. `npm run build` must not run migrations or seed data.
6. `npm run db:release` must fail before any DB mutation unless `ALLOW_PRODUCTION_DB_RELEASE=1`.

## 5. Authorization safety requirements

1. Existing `authorize()` behavior remains fail-closed.
2. SHADOW mode remains diagnostic only and never becomes a permission bypass.
3. Inactive-account checks occur before cached permission grants are used.
4. Security mode has a 15-second TTL and is explicitly invalidated after mode changes.
5. Role assignment changes invalidate cache.
6. Role permission changes invalidate cache.
7. Permission override changes invalidate cache.
8. Personnel flows that create/deactivate CRM access invalidate cache.
9. Independent serverless instances that do not observe local invalidation are bounded by the 15–20 second TTL.

## 6. CI requirements

Dependency installation changes from `npm install` to:

```bash
npm ci --no-audit --no-fund
```

This makes CI installation lockfile-deterministic.

New optimization contract checks verify:

- application build cannot mutate DB;
- DB release has an explicit guard;
- RBAC cache TTL/coalescing/invalidation contracts exist;
- target pollers use adaptive polling and expected intervals.

Full CI explicitly runs `npx tsc --noEmit` before database replay and production build.

## 7. Vercel requirements

After successful merge:

- production must point to the tested main commit;
- preview deployments should be disabled unless explicitly needed, to avoid a build for every research/feature commit;
- post-deploy runtime error scan must show no new error cluster caused by the release.

## 8. GitHub branch protection

Desired repository rule for `main`:

- PR required;
- successful `CRM Production Build` required;
- direct pushes blocked;
- force pushes blocked.

The current GitHub connector available to this implementation does not expose repository branch-protection/ruleset mutation. Therefore code changes are released through a PR and green CI, but repository-level enforcement must be configured separately by an admin-capable interface.

## 9. Acceptance criteria

The release is accepted when all are true:

- `npm run build` contains no migration or seed call;
- `npm run db:release` refuses to run without explicit confirmation;
- CI uses `npm ci`;
- optimization smoke tests pass;
- TypeScript passes;
- clean PostgreSQL migration replay passes;
- Prisma drift check passes;
- production build passes;
- RBAC cache smoke contract passes;
- polling smoke contract passes;
- PR is merged only after green CI;
- Vercel production deployment reaches `READY`;
- post-deploy runtime error scan is clean;
- authentication, communications, mechanic cabinet and telephony routes continue to work.

## 10. Rollback

This package introduces no schema migration, so application rollback is straightforward:

1. promote/rollback to previous Vercel production artifact;
2. no database rollback is required;
3. access cache disappears with the rolled-back runtime instance;
4. old polling behavior returns with the old artifact.

## 11. Expected impact

### 11.1 Deployment safety

Eliminates the failure class where a failed application build can leave the old application running against a newly migrated database.

### 11.2 RBAC/DB load

On a warm server instance, repeated RBAC permission reads for one user collapse to one RBAC load per ~20 seconds instead of one RBAC load per protected request.

Actual production reduction depends on traffic and serverless instance reuse; this is an architectural expectation, not a measured production percentage.

### 11.3 Polling calculations

**Telephony idle**

Previous cadence:

```text
60 / 2.5 = 24 requests/minute
```

New idle cadence:

```text
60 / 8 = 7.5 requests/minute
```

Theoretical timer-driven idle reduction:

```text
1 - 7.5 / 24 = 68.75%
```

**Communications**

Previous cadence:

```text
60 / 7 ≈ 8.57 requests/minute
```

New cadence:

```text
60 / 15 = 4 requests/minute
```

Theoretical reduction:

```text
1 - 4 / 8.57 ≈ 53.3%
```

**Mechanic notifications**

Previous:

```text
60 / 15 = 4 requests/minute
```

New:

```text
60 / 30 = 2 requests/minute
```

Reduction: **50%**.

These are timer cadence calculations only. Manual actions, focus events and CRM data-change events can add requests.

## 12. Changed implementation surfaces

- `scripts/build-production.mjs`
- `scripts/release-database.mjs`
- `package.json`
- `.github/workflows/ci.yml`
- `src/security/access-context-cache.ts`
- `src/security/access-context.ts`
- access/security/personnel mutation paths
- `src/lib/client/adaptive-polling.ts`
- telephony realtime bridge
- communications hub
- mechanic standalone cabinet
- optimization contract smoke tests

## 13. Post-release verification

After production becomes READY:

1. query Vercel runtime errors for the new deployment;
2. verify no new 5xx/fatal cluster;
3. verify `/api/auth/me` returns normal authenticated behavior;
4. verify Communications loads;
5. verify mechanic notifications still refresh;
6. verify telephony live endpoint remains functional;
7. verify no build log contains `prisma migrate deploy`;
8. confirm no DB schema change was introduced by this PR.

## 14. Follow-up recommendations

Not required for this release, but recommended as the next optimization package:

1. replace large `DB -> Node IDs -> DB WHERE IN (...)` scope flows with SQL `EXISTS/JOIN`;
2. add production slow-query telemetry/inspection;
3. migrate integration credential encryption from `DATABASE_URL` fallback to a dedicated `INTEGRATIONS_MASTER_KEY` with controlled re-encryption;
4. enforce protected `main` with required CI checks;
5. use previews only on demand.
