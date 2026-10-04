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
  statement_timeout: 20_000,
  query_timeout: 25_000,
  application_name: "turbolev-build-db-perf-audit",
});
function safeRows(rows) {
  return rows.map((row)=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,typeof v==="bigint"?v.toString():v])));
}
function summarizePlan(plan, depth=0) {
  if (!plan || depth > 5) return null;
  return {
    node: plan["Node Type"],
    relation: plan["Relation Name"] || null,
    index: plan["Index Name"] || null,
    join: plan["Join Type"] || null,
    scanDirection: plan["Scan Direction"] || null,
    actualMs: plan["Actual Total Time"] ?? null,
    rows: plan["Actual Rows"] ?? plan["Plan Rows"] ?? null,
    loops: plan["Actual Loops"] ?? null,
    indexCond: plan["Index Cond"] || null,
    filter: plan["Filter"] || null,
    sharedHit: plan["Shared Hit Blocks"] ?? null,
    sharedRead: plan["Shared Read Blocks"] ?? null,
    children: Array.isArray(plan.Plans) ? plan.Plans.map((child)=>summarizePlan(child,depth+1)).filter(Boolean) : [],
  };
}
async function section(name,sql,params=[]) {
  try {
    const r=await client.query(sql,params);
    console.log(`[db-perf-audit:${name}] ${JSON.stringify(safeRows(r.rows))}`);
    return r.rows;
  } catch(error) {
    console.log(`[db-perf-audit:${name}:error] ${JSON.stringify({code:error?.code||null,message:String(error?.message||error).slice(0,600)})}`);
    return [];
  }
}
async function explain(name,sql,params=[],analyze=true) {
  try {
    const prefix=analyze?"EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ":"EXPLAIN (BUFFERS, FORMAT JSON) ";
    const r=await client.query(prefix+sql,params);
    const doc=r.rows?.[0]?.["QUERY PLAN"]?.[0];
    console.log(`[db-perf-audit:plan:${name}] ${JSON.stringify({
      planningMs:doc?.["Planning Time"]??null,
      executionMs:doc?.["Execution Time"]??null,
      plan:summarizePlan(doc?.Plan),
    })}`);
  } catch(error) {
    console.log(`[db-perf-audit:plan:${name}:error] ${JSON.stringify({code:error?.code||null,message:String(error?.message||error).slice(0,600)})}`);
  }
}

await client.connect();
try {
  await section("identity",`
    SELECT current_database() AS database,
           current_setting('server_version') AS server_version,
           EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_stat_statements') AS pg_stat_statements
  `);

  const watched=[
    "VehicleRegistryCompact","ServiceAppointment","WorkOrder","WorkOrderFinanceSnapshot",
    "WorkOrderLine","CashTransaction","FinancialEvent","Lead","DiagnosticAssignment",
    "DiagnosticRequest","Client","Vehicle","CallHistory","CommunicationInquiry"
  ];
  await section("watched-table-stats",`
    SELECT relname,
           n_live_tup::bigint AS live_rows,
           n_dead_tup::bigint AS dead_rows,
           seq_scan::bigint,
           seq_tup_read::bigint,
           idx_scan::bigint,
           pg_total_relation_size(relid)::bigint AS total_bytes,
           last_autovacuum,last_autoanalyze
    FROM pg_stat_user_tables
    WHERE relname = ANY($1::text[])
    ORDER BY pg_total_relation_size(relid) DESC
  `,[watched]);

  await section("watched-indexes",`
    SELECT tablename,indexname,indexdef
    FROM pg_indexes
    WHERE schemaname='public' AND tablename = ANY($1::text[])
    ORDER BY tablename,indexname
  `,[watched]);

  const sample=await client.query(`
    SELECT
      (SELECT "plateKey" FROM "VehicleRegistryCompact" WHERE "plateKey" IS NOT NULL LIMIT 1) AS plate_key,
      (SELECT vin FROM "VehicleRegistryCompact" WHERE vin IS NOT NULL AND btrim(vin)<>'' LIMIT 1) AS vin,
      (SELECT id FROM "ServiceLocation" WHERE "isActive"=TRUE ORDER BY "sortOrder",id LIMIT 1) AS location_id
  `);
  const plateKey=sample.rows[0]?.plate_key;
  const vin=sample.rows[0]?.vin;
  const locationId=sample.rows[0]?.location_id;
  if (plateKey != null) {
    await explain("registry-plate",`
      SELECT vin,brand,model,"makeYear","engineVolumeCm3","fuelType","vehicleTypeRaw","sourceYear"
      FROM "VehicleRegistryCompact"
      WHERE "plateKey"=$1
      LIMIT 1
    `,[plateKey],true);
  }
  if (vin) {
    await explain("registry-vin",`
      SELECT vin,brand,model,"makeYear","engineVolumeCm3","fuelType","vehicleTypeRaw","sourceYear"
      FROM "VehicleRegistryCompact"
      WHERE vin=$1
      ORDER BY "sourceYear" DESC,(model IS NOT NULL) DESC,(brand IS NOT NULL) DESC
      LIMIT 1
    `,[vin],true);
  }
  await explain("registry-source-year",`
    SELECT "sourceYear",count(*)
    FROM "VehicleRegistryCompact"
    WHERE "sourceYear" = ANY(ARRAY[2024,2025,2026]::smallint[])
    GROUP BY "sourceYear"
  `,[],false);

  if (locationId) {
    const from=new Date(Date.now()-30*24*60*60*1000);
    const to=new Date();
    await explain("closed-workorders-location",`
      SELECT wo.id,wo."clientId",wo."vehicleId",wo."closedAt"
      FROM "WorkOrder" wo
      WHERE wo.status='CLOSED'
        AND wo."closedAt">=$1 AND wo."closedAt"<$2
        AND left(wo.id,5)<>'demo_'
        AND EXISTS (
          SELECT 1 FROM "ServiceAppointment" sa
          WHERE sa."workOrderId"=wo.id
            AND sa."locationId"=$3
            AND left(sa.id,5)<>'demo_'
        )
      ORDER BY wo."closedAt" DESC
    `,[from,to,locationId],true);

    await explain("diagnostic-count-location",`
      SELECT dr.status::text,count(*)::bigint
      FROM "DiagnosticRequest" dr
      WHERE dr.status IN ('PENDING','IN_PROGRESS')
        AND EXISTS (
          SELECT 1 FROM "DiagnosticAssignment" da
          WHERE da."diagnosticRequestId"=dr.id
            AND da."locationId"=$1
        )
      GROUP BY dr.status
    `,[locationId],true);

    await explain("completed-labor-location",`
      SELECT wl."mechanicId",wl."workOrderId",wl."laborHours"
      FROM "WorkOrderLine" wl
      WHERE wl.type='LABOR'
        AND wl.status='COMPLETED'
        AND wl."completedAt">=$1 AND wl."completedAt"<$2
        AND wl."mechanicId" IS NOT NULL
        AND left(wl."workOrderId",5)<>'demo_'
        AND EXISTS (
          SELECT 1 FROM "ServiceAppointment" sa
          WHERE sa."workOrderId"=wl."workOrderId"
            AND sa."locationId"=$3
            AND left(sa.id,5)<>'demo_'
        )
    `,[from,to,locationId],true);

    await explain("management-cash-scope",`
      SELECT ct.amount
      FROM "CashTransaction" ct
      WHERE ct.status='POSTED'
        AND ct.kind='INFLOW'
        AND ct."flowSection"='OPERATING'
        AND ct."occurredAt">=$1 AND ct."occurredAt"<$2
        AND ct."clientId" IS NOT NULL
        AND (
          ct."locationId"=$3
          OR EXISTS (
            SELECT 1
            FROM "ServiceAppointment" sa
            WHERE sa."workOrderId"=ct."workOrderId"
              AND sa."locationId"=$3
              AND left(sa.id,5)<>'demo_'
          )
        )
    `,[from,to,locationId],true);
  }

  const monthStart=new Date(Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth(),1));
  await explain("lead-funnel",`
    SELECT count(DISTINCT l.id)::bigint AS leads,
           count(DISTINCT sa."leadId")::bigint AS booked
    FROM "Lead" l
    LEFT JOIN "ServiceAppointment" sa
      ON sa."leadId"=l.id
     AND sa.status NOT IN ('CANCELLED','RESERVE')
     AND left(sa.id,5)<>'demo_'
    WHERE l."createdAt">=$1
      AND left(l.id,5)<>'demo_'
  `,[monthStart],true);
} finally {
  await client.end();
}
