// one-off preview database performance audit
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.log("[db-perf-audit] DATABASE_URL unavailable; skipping.");
  process.exit(0);
}

const client = new Client({
  connectionString,
  statement_timeout: 15_000,
  query_timeout: 20_000,
  application_name: "turbolev-build-db-perf-audit",
});

function compactQuery(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 800);
}
function serialize(rows) {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([k,v]) => {
    if (typeof v === "bigint") return [k, v.toString()];
    return [k, v];
  })));
}
async function section(name, sql, params=[]) {
  try {
    const result = await client.query(sql, params);
    console.log(`[db-perf-audit:${name}] ${JSON.stringify(serialize(result.rows))}`);
  } catch (error) {
    console.log(`[db-perf-audit:${name}:error] ${JSON.stringify({code:error?.code || null,message:String(error?.message || error).slice(0,500)})}`);
  }
}

await client.connect();
try {
  await section("identity", `
    SELECT current_database() AS database,
           current_setting('server_version') AS server_version,
           EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_stat_statements') AS pg_stat_statements
  `);

  await section("table-sizes", `
    SELECT relname,
           n_live_tup::bigint AS live_rows,
           n_dead_tup::bigint AS dead_rows,
           pg_total_relation_size(relid)::bigint AS total_bytes,
           pg_relation_size(relid)::bigint AS heap_bytes,
           pg_indexes_size(relid)::bigint AS index_bytes
    FROM pg_stat_user_tables
    ORDER BY pg_total_relation_size(relid) DESC
    LIMIT 35
  `);

  await section("seq-scans", `
    SELECT relname,
           seq_scan::bigint,
           seq_tup_read::bigint,
           idx_scan::bigint,
           n_live_tup::bigint AS live_rows,
           n_dead_tup::bigint AS dead_rows,
           last_autovacuum,
           last_autoanalyze
    FROM pg_stat_user_tables
    ORDER BY seq_tup_read DESC NULLS LAST
    LIMIT 35
  `);

  const watchedTables = [
    "ServiceAppointment","WorkOrder","WorkOrderFinanceSnapshot","WorkOrderLine",
    "CashTransaction","FinancialEvent","Lead","DiagnosticAssignment","DiagnosticRequest",
    "ManagementPlan","ManagementPlanAllocation","Client","Vehicle","WorkOrderNumber"
  ];
  await section("watched-indexes", `
    SELECT tablename, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname='public' AND tablename = ANY($1::text[])
    ORDER BY tablename, indexname
  `, [watchedTables]);

  try {
    const stats = await client.query(`
      SELECT queryid::text,
             calls::bigint,
             round(total_exec_time::numeric, 2) AS total_ms,
             round(mean_exec_time::numeric, 2) AS mean_ms,
             rows::bigint,
             shared_blks_hit::bigint,
             shared_blks_read::bigint,
             query
      FROM pg_stat_statements
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname=current_database())
        AND query NOT ILIKE '%pg_stat_statements%'
      ORDER BY total_exec_time DESC
      LIMIT 30
    `);
    console.log("[db-perf-audit:outliers] " + JSON.stringify(stats.rows.map((row)=>({
      ...row,
      calls:String(row.calls),
      rows:String(row.rows),
      shared_blks_hit:String(row.shared_blks_hit),
      shared_blks_read:String(row.shared_blks_read),
      query:compactQuery(row.query),
    }))));

    const calls = await client.query(`
      SELECT queryid::text,
             calls::bigint,
             round(total_exec_time::numeric, 2) AS total_ms,
             round(mean_exec_time::numeric, 2) AS mean_ms,
             rows::bigint,
             query
      FROM pg_stat_statements
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname=current_database())
        AND query NOT ILIKE '%pg_stat_statements%'
      ORDER BY calls DESC
      LIMIT 30
    `);
    console.log("[db-perf-audit:calls] " + JSON.stringify(calls.rows.map((row)=>({
      ...row,
      calls:String(row.calls),
      rows:String(row.rows),
      query:compactQuery(row.query),
    }))));
  } catch (error) {
    console.log("[db-perf-audit:pg-stat:error] " + JSON.stringify({code:error?.code || null,message:String(error?.message || error).slice(0,500)}));
  }
} finally {
  await client.end();
}
