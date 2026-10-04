import "server-only";

import { getSqlPool } from "@/src/lib/sql";

const SNAPSHOT_RETENTION_DAYS = 35;
const DEFAULT_TOP_LIMIT = 25;
const MAX_TOP_LIMIT = 50;
const SNAPSHOT_TOP_LIMIT = 200;

type StatementRow = {
  queryId: string;
  calls: string;
  totalExecMs: string | number;
  meanExecMs: string | number;
  rows: string;
  sharedBlksHit: string;
  sharedBlksRead: string;
  query: string;
};

function finiteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function statementRow(row: Record<string, unknown>): StatementRow {
  return {
    queryId: String(row.queryId ?? ""),
    calls: String(row.calls ?? "0"),
    totalExecMs: finiteNumber(row.totalExecMs),
    meanExecMs: finiteNumber(row.meanExecMs),
    rows: String(row.rows ?? "0"),
    sharedBlksHit: String(row.sharedBlksHit ?? "0"),
    sharedBlksRead: String(row.sharedBlksRead ?? "0"),
    query: String(row.query ?? "").slice(0, 4000),
  };
}

async function capabilities() {
  const result = await getSqlPool().query<{
    extensionInstalled: boolean;
    snapshotTableInstalled: boolean;
    database: string;
    serverVersion: string;
  }>(
    `SELECT
       EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_stat_statements') AS "extensionInstalled",
       to_regclass('public."DatabaseQueryStatSnapshot"') IS NOT NULL AS "snapshotTableInstalled",
       current_database() AS database,
       current_setting('server_version') AS "serverVersion"`,
  );
  return result.rows[0];
}

async function statsResetAt() {
  try {
    const result = await getSqlPool().query<{ statsReset: Date | null }>(
      `SELECT stats_reset AS "statsReset" FROM pg_stat_statements_info LIMIT 1`,
    );
    return result.rows[0]?.statsReset ?? null;
  } catch {
    return null;
  }
}

function statementQuery(orderBy: "total" | "calls") {
  const order = orderBy === "calls"
    ? `calls DESC, total_exec_time DESC`
    : `total_exec_time DESC, calls DESC`;
  return `
    SELECT queryid::text AS "queryId",
           calls::bigint AS calls,
           round(total_exec_time::numeric,3) AS "totalExecMs",
           round(mean_exec_time::numeric,3) AS "meanExecMs",
           rows::bigint AS rows,
           shared_blks_hit::bigint AS "sharedBlksHit",
           shared_blks_read::bigint AS "sharedBlksRead",
           left(regexp_replace(query, '\\s+', ' ', 'g'), 4000) AS query
      FROM pg_stat_statements
     WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database())
       AND userid=(SELECT usesysid FROM pg_user WHERE usename=current_user)
       AND query NOT ILIKE '%pg_stat_statements%'
       AND query NOT ILIKE '%DatabaseQueryStatSnapshot%'
     ORDER BY ${order}
     LIMIT $1
  `;
}

async function currentStatements(limit: number, orderBy: "total" | "calls") {
  const result = await getSqlPool().query(statementQuery(orderBy), [limit]);
  return result.rows.map((row) => statementRow(row as Record<string, unknown>));
}

async function windowStatements(args: {
  baselineAt: Date;
  resetAt: Date | null;
  limit: number;
  orderBy: "total" | "calls";
}) {
  const order = args.orderBy === "calls"
    ? `"windowCalls" DESC, "windowTotalExecMs" DESC`
    : `"windowTotalExecMs" DESC, "windowCalls" DESC`;
  const resetAfterBaseline = Boolean(args.resetAt && args.resetAt.getTime() >= args.baselineAt.getTime());
  const result = await getSqlPool().query(
    `WITH current_stats AS (
       SELECT queryid::text AS "queryId",
              calls::bigint AS calls,
              total_exec_time::numeric AS "totalExecMs",
              mean_exec_time::numeric AS "meanExecMs",
              rows::bigint AS rows,
              shared_blks_hit::bigint AS "sharedBlksHit",
              shared_blks_read::bigint AS "sharedBlksRead",
              left(regexp_replace(query, '\\s+', ' ', 'g'), 4000) AS query
         FROM pg_stat_statements
        WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database())
          AND userid=(SELECT usesysid FROM pg_user WHERE usename=current_user)
          AND query NOT ILIKE '%pg_stat_statements%'
          AND query NOT ILIKE '%DatabaseQueryStatSnapshot%'
     ), baseline AS (
       SELECT "queryId","calls","totalExecMs","rows","sharedBlksHit","sharedBlksRead"
         FROM "DatabaseQueryStatSnapshot"
        WHERE "capturedAt"=$1
     )
     SELECT c."queryId",
            CASE WHEN $2::boolean THEN c.calls ELSE GREATEST(c.calls-COALESCE(b.calls,0),0) END::bigint AS "windowCalls",
            round((CASE WHEN $2::boolean THEN c."totalExecMs" ELSE GREATEST(c."totalExecMs"-COALESCE(b."totalExecMs",0),0) END)::numeric,3) AS "windowTotalExecMs",
            round(c."meanExecMs"::numeric,3) AS "meanExecMs",
            CASE WHEN $2::boolean THEN c.rows ELSE GREATEST(c.rows-COALESCE(b.rows,0),0) END::bigint AS rows,
            CASE WHEN $2::boolean THEN c."sharedBlksHit" ELSE GREATEST(c."sharedBlksHit"-COALESCE(b."sharedBlksHit",0),0) END::bigint AS "sharedBlksHit",
            CASE WHEN $2::boolean THEN c."sharedBlksRead" ELSE GREATEST(c."sharedBlksRead"-COALESCE(b."sharedBlksRead",0),0) END::bigint AS "sharedBlksRead",
            c.query
       FROM current_stats c
       LEFT JOIN baseline b USING ("queryId")
      ORDER BY ${order}
      LIMIT $3`,
    [args.baselineAt, resetAfterBaseline, args.limit],
  );
  return result.rows.map((row: Record<string, unknown>) => ({
    queryId: String(row.queryId ?? ""),
    calls: String(row.windowCalls ?? "0"),
    totalExecMs: finiteNumber(row.windowTotalExecMs),
    meanExecMs: finiteNumber(row.meanExecMs),
    rows: String(row.rows ?? "0"),
    sharedBlksHit: String(row.sharedBlksHit ?? "0"),
    sharedBlksRead: String(row.sharedBlksRead ?? "0"),
    query: String(row.query ?? "").slice(0, 4000),
  }));
}

async function snapshotCoverage(days: number) {
  const target = new Date(Date.now() - days * 86_400_000);
  const [coverage, baseline] = await Promise.all([
    getSqlPool().query<{
      firstCapturedAt: Date | null;
      lastCapturedAt: Date | null;
      captures: number;
    }>(
      `SELECT min("capturedAt") AS "firstCapturedAt",
              max("capturedAt") AS "lastCapturedAt",
              count(DISTINCT "capturedAt")::int AS captures
         FROM "DatabaseQueryStatSnapshot"`,
    ),
    getSqlPool().query<{ capturedAt: Date }>(
      `SELECT DISTINCT "capturedAt"
         FROM "DatabaseQueryStatSnapshot"
        WHERE "capturedAt">=$1
        ORDER BY "capturedAt" ASC
        LIMIT 1`,
      [target],
    ),
  ]);

  let baselineAt: Date | null = baseline.rows[0]?.capturedAt ?? null;
  let partialWindow = false;
  if (!baselineAt) {
    const earliest = coverage.rows[0]?.firstCapturedAt ?? null;
    baselineAt = earliest;
    partialWindow = true;
  } else if (baselineAt.getTime() > target.getTime() + 36 * 60 * 60 * 1000) {
    partialWindow = true;
  }

  return {
    target,
    baselineAt,
    partialWindow,
    firstCapturedAt: coverage.rows[0]?.firstCapturedAt ?? null,
    lastCapturedAt: coverage.rows[0]?.lastCapturedAt ?? null,
    captures: Number(coverage.rows[0]?.captures ?? 0),
  };
}

async function tableHotspots(limit = 25) {
  const result = await getSqlPool().query(
    `SELECT relname AS table,
            n_live_tup::bigint AS "liveRows",
            n_dead_tup::bigint AS "deadRows",
            seq_scan::bigint AS "seqScans",
            seq_tup_read::bigint AS "seqRowsRead",
            idx_scan::bigint AS "indexScans",
            pg_total_relation_size(relid)::bigint AS "totalBytes",
            last_autovacuum AS "lastAutovacuum",
            last_autoanalyze AS "lastAutoanalyze"
       FROM pg_stat_user_tables
      ORDER BY seq_tup_read DESC NULLS LAST
      LIMIT $1`,
    [limit],
  );
  return result.rows.map((row: Record<string, unknown>) => ({
    table: String(row.table ?? ""),
    liveRows: String(row.liveRows ?? "0"),
    deadRows: String(row.deadRows ?? "0"),
    seqScans: String(row.seqScans ?? "0"),
    seqRowsRead: String(row.seqRowsRead ?? "0"),
    indexScans: String(row.indexScans ?? "0"),
    totalBytes: String(row.totalBytes ?? "0"),
    lastAutovacuum: row.lastAutovacuum instanceof Date ? row.lastAutovacuum.toISOString() : null,
    lastAutoanalyze: row.lastAutoanalyze instanceof Date ? row.lastAutoanalyze.toISOString() : null,
  }));
}

export async function captureDatabaseQueryStatSnapshot() {
  const caps = await capabilities();
  if (!caps.extensionInstalled || !caps.snapshotTableInstalled) {
    return {
      captured: false as const,
      reason: !caps.extensionInstalled ? "PG_STAT_STATEMENTS_NOT_INSTALLED" as const : "SNAPSHOT_TABLE_NOT_INSTALLED" as const,
    };
  }

  const client = await getSqlPool().connect();
  try {
    await client.query("BEGIN");
    const lock = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_xact_lock(hashtext('database-query-stat-snapshot')) AS locked`,
    );
    if (lock.rows[0]?.locked !== true) {
      await client.query("ROLLBACK");
      return { captured: false as const, reason: "ALREADY_RUNNING" as const };
    }

    const capturedAt = new Date();
    const reset = await client.query<{ statsReset: Date | null }>(
      `SELECT stats_reset AS "statsReset" FROM pg_stat_statements_info LIMIT 1`,
    ).catch(() => ({ rows: [{ statsReset: null as Date | null }] }));

    const inserted = await client.query(
      `WITH ranked AS (
         SELECT queryid::text AS "queryId",
                calls::bigint AS calls,
                total_exec_time::numeric AS "totalExecMs",
                mean_exec_time::numeric AS "meanExecMs",
                rows::bigint AS rows,
                shared_blks_hit::bigint AS "sharedBlksHit",
                shared_blks_read::bigint AS "sharedBlksRead",
                left(regexp_replace(query, '\\s+', ' ', 'g'), 4000) AS "queryText",
                row_number() OVER (ORDER BY total_exec_time DESC, calls DESC) AS total_rank,
                row_number() OVER (ORDER BY calls DESC, total_exec_time DESC) AS calls_rank
           FROM pg_stat_statements
          WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database())
            AND userid=(SELECT usesysid FROM pg_user WHERE usename=current_user)
            AND query NOT ILIKE '%pg_stat_statements%'
            AND query NOT ILIKE '%DatabaseQueryStatSnapshot%'
       )
       INSERT INTO "DatabaseQueryStatSnapshot"
         ("capturedAt","queryId","statsResetAt","calls","totalExecMs","meanExecMs","rows","sharedBlksHit","sharedBlksRead","queryText")
       SELECT $1,"queryId",$2,calls,round("totalExecMs",3),round("meanExecMs",3),rows,"sharedBlksHit","sharedBlksRead","queryText"
         FROM ranked
        WHERE total_rank<=$3 OR calls_rank<=$3
       ON CONFLICT ("capturedAt","queryId") DO UPDATE SET
         "statsResetAt"=EXCLUDED."statsResetAt",
         "calls"=EXCLUDED."calls",
         "totalExecMs"=EXCLUDED."totalExecMs",
         "meanExecMs"=EXCLUDED."meanExecMs",
         "rows"=EXCLUDED."rows",
         "sharedBlksHit"=EXCLUDED."sharedBlksHit",
         "sharedBlksRead"=EXCLUDED."sharedBlksRead",
         "queryText"=EXCLUDED."queryText"`,
      [capturedAt, reset.rows[0]?.statsReset ?? null, SNAPSHOT_TOP_LIMIT],
    );

    await client.query(
      `DELETE FROM "DatabaseQueryStatSnapshot"
        WHERE "capturedAt" < CURRENT_TIMESTAMP - ($1::text || ' days')::interval`,
      [SNAPSHOT_RETENTION_DAYS],
    );
    await client.query("COMMIT");
    return {
      captured: true as const,
      capturedAt: capturedAt.toISOString(),
      statements: inserted.rowCount ?? 0,
      retentionDays: SNAPSHOT_RETENTION_DAYS,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function getDatabaseObservability(input?: { days?: number; limit?: number }) {
  const days = Math.max(1, Math.min(30, Math.trunc(input?.days || 14)));
  const limit = Math.max(5, Math.min(MAX_TOP_LIMIT, Math.trunc(input?.limit || DEFAULT_TOP_LIMIT)));
  const caps = await capabilities();
  const tables = await tableHotspots();

  if (!caps.extensionInstalled) {
    return {
      ok: true as const,
      enabled: false as const,
      database: caps.database,
      serverVersion: caps.serverVersion,
      reason: "PG_STAT_STATEMENTS_NOT_INSTALLED" as const,
      tables,
    };
  }

  const resetAt = await statsResetAt();
  const [topByTotalTime, topByCalls] = await Promise.all([
    currentStatements(limit, "total"),
    currentStatements(limit, "calls"),
  ]);

  if (!caps.snapshotTableInstalled) {
    return {
      ok: true as const,
      enabled: true as const,
      snapshotHistory: false as const,
      database: caps.database,
      serverVersion: caps.serverVersion,
      statsResetAt: resetAt?.toISOString() ?? null,
      topByTotalTime,
      topByCalls,
      tables,
    };
  }

  const coverage = await snapshotCoverage(days);
  const windowAvailable = Boolean(coverage.baselineAt);
  const [windowTopByTotalTime, windowTopByCalls] = windowAvailable
    ? await Promise.all([
        windowStatements({ baselineAt: coverage.baselineAt!, resetAt, limit, orderBy: "total" }),
        windowStatements({ baselineAt: coverage.baselineAt!, resetAt, limit, orderBy: "calls" }),
      ])
    : [[], []];

  return {
    ok: true as const,
    enabled: true as const,
    snapshotHistory: true as const,
    database: caps.database,
    serverVersion: caps.serverVersion,
    statsResetAt: resetAt?.toISOString() ?? null,
    window: {
      requestedDays: days,
      baselineAt: coverage.baselineAt?.toISOString() ?? null,
      firstCapturedAt: coverage.firstCapturedAt?.toISOString() ?? null,
      lastCapturedAt: coverage.lastCapturedAt?.toISOString() ?? null,
      captures: coverage.captures,
      partial: coverage.partialWindow || !windowAvailable,
      resetDetected: Boolean(resetAt && coverage.baselineAt && resetAt.getTime() >= coverage.baselineAt.getTime()),
    },
    topByTotalTime,
    topByCalls,
    windowTopByTotalTime,
    windowTopByCalls,
    tables,
  };
}
