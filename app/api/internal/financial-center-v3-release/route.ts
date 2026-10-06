import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIGRATION_NAME = "20261006233000_financial_center_v3_cash_close";
const MIGRATION_SQL = "-- Financial Center V3: audited cash-day closing.\n-- Create-only: factual CashTransaction ledger remains unchanged.\n\nCREATE TABLE \"FinancialCashClose\" (\n  \"id\" TEXT NOT NULL,\n  \"businessDate\" DATE NOT NULL,\n  \"moneyAccountId\" TEXT NOT NULL,\n  \"locationId\" VARCHAR(64),\n  \"currency\" VARCHAR(3) NOT NULL DEFAULT 'UAH',\n  \"systemAmount\" DECIMAL(14,2) NOT NULL,\n  \"countedAmount\" DECIMAL(14,2) NOT NULL,\n  \"difference\" DECIMAL(14,2) NOT NULL,\n  \"note\" TEXT,\n  \"closedById\" VARCHAR(64),\n  \"closedAt\" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  \"createdAt\" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  \"updatedAt\" TIMESTAMP(3) NOT NULL,\n  CONSTRAINT \"FinancialCashClose_pkey\" PRIMARY KEY (\"id\")\n);\n\nCREATE UNIQUE INDEX \"FinancialCashClose_account_businessDate_key\"\n  ON \"FinancialCashClose\"(\"moneyAccountId\",\"businessDate\");\n\nCREATE INDEX \"FinancialCashClose_locationId_businessDate_idx\"\n  ON \"FinancialCashClose\"(\"locationId\",\"businessDate\");\n\nCREATE INDEX \"FinancialCashClose_businessDate_idx\"\n  ON \"FinancialCashClose\"(\"businessDate\");\n\nALTER TABLE \"FinancialCashClose\"\n  ADD CONSTRAINT \"FinancialCashClose_moneyAccountId_fkey\"\n  FOREIGN KEY (\"moneyAccountId\") REFERENCES \"MoneyAccount\"(\"id\")\n  ON DELETE RESTRICT ON UPDATE CASCADE;\n";

const EXPECTED_COLUMNS = [
  ["id", "text", true],
  ["businessDate", "date", true],
  ["moneyAccountId", "text", true],
  ["locationId", "character varying(64)", false],
  ["currency", "character varying(3)", true],
  ["systemAmount", "numeric(14,2)", true],
  ["countedAmount", "numeric(14,2)", true],
  ["difference", "numeric(14,2)", true],
  ["note", "text", false],
  ["closedById", "character varying(64)", false],
  ["closedAt", "timestamp(3) without time zone", true],
  ["createdAt", "timestamp(3) without time zone", true],
  ["updatedAt", "timestamp(3) without time zone", true],
] as const;

function allowedPreview(request: NextRequest) {
  const confirm = request.nextUrl.searchParams.get("confirm");
  return process.env.VERCEL_ENV === "preview"
    && process.env.VERCEL_GIT_COMMIT_REF === "ops/financial-center-v3-db-release-20261007"
    && (confirm === "inspect-financial-center-v3" || confirm === "resolve-financial-center-v3");
}

function migrationConnectionString() {
  const raw = (
    process.env.DATABASE_URL_UNPOOLED
    || process.env.DIRECT_URL
    || process.env.DATABASE_URL
    || ""
  ).trim();
  if (!raw) throw new Error("Database release connection is not configured.");
  try {
    const url = new URL(raw);
    if (url.hostname.includes("-pooler.") && url.hostname.endsWith(".neon.tech")) {
      url.hostname = url.hostname.replace("-pooler.", ".");
    }
    return url.toString();
  } catch {
    return raw;
  }
}

async function inspectState(client: Client) {
  const migrationRows = await client.query<{
    id: string;
    checksum: string;
    finished_at: Date | null;
    rolled_back_at: Date | null;
    started_at: Date;
    applied_steps_count: number;
  }>(
    'SELECT "id","checksum","finished_at","rolled_back_at","started_at","applied_steps_count" FROM "_prisma_migrations" WHERE "migration_name"=$1 ORDER BY "started_at" ASC',
    [MIGRATION_NAME],
  );

  const columns = await client.query<{
    name: string;
    type: string;
    not_null: boolean;
    default_expr: string | null;
  }>(`
    SELECT
      a.attname AS name,
      format_type(a.atttypid, a.atttypmod) AS type,
      a.attnotnull AS not_null,
      pg_get_expr(d.adbin, d.adrelid) AS default_expr
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = current_schema()
      AND c.relname = 'FinancialCashClose'
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY a.attnum
  `);

  const constraints = await client.query<{ name: string; type: string; definition: string }>(`
    SELECT con.conname AS name, con.contype::text AS type, pg_get_constraintdef(con.oid) AS definition
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = current_schema()
       AND c.relname = 'FinancialCashClose'
     ORDER BY con.conname
  `);

  const indexes = await client.query<{ indexname: string; indexdef: string }>(`
    SELECT indexname, indexdef
      FROM pg_indexes
     WHERE schemaname = current_schema()
       AND tablename = 'FinancialCashClose'
     ORDER BY indexname
  `);

  const rowCount = await client.query<{ count: number }>(
    'SELECT CASE WHEN to_regclass(\'"FinancialCashClose"\') IS NULL THEN 0 ELSE (SELECT COUNT(*)::int FROM "FinancialCashClose") END AS count',
  );

  const normalizedColumns = columns.rows.map((row) => [row.name, row.type, row.not_null] as const);
  const columnsExact = JSON.stringify(normalizedColumns) === JSON.stringify(EXPECTED_COLUMNS);
  const defaultsExact =
    columns.rows.find((row) => row.name === "currency")?.default_expr === "'UAH'::character varying"
    && columns.rows.find((row) => row.name === "closedAt")?.default_expr === "CURRENT_TIMESTAMP"
    && columns.rows.find((row) => row.name === "createdAt")?.default_expr === "CURRENT_TIMESTAMP"
    && columns.rows.find((row) => row.name === "id")?.default_expr == null
    && columns.rows.find((row) => row.name === "updatedAt")?.default_expr == null;

  const primaryKeyExact = constraints.rows.some((row) =>
    row.name === "FinancialCashClose_pkey" && row.type === "p" && /PRIMARY KEY \("id"\)/.test(row.definition),
  );
  const foreignKeyExact = constraints.rows.some((row) =>
    row.name === "FinancialCashClose_moneyAccountId_fkey"
    && row.type === "f"
    && /FOREIGN KEY \("moneyAccountId"\) REFERENCES "MoneyAccount"\("id"\) ON UPDATE CASCADE ON DELETE RESTRICT/.test(row.definition),
  );
  const uniqueExact = indexes.rows.some((row) =>
    row.indexname === "FinancialCashClose_account_businessDate_key"
    && /UNIQUE INDEX/.test(row.indexdef)
    && /\("moneyAccountId", "businessDate"\)/.test(row.indexdef),
  );
  const locationIndexExact = indexes.rows.some((row) =>
    row.indexname === "FinancialCashClose_locationId_businessDate_idx"
    && /\("locationId", "businessDate"\)/.test(row.indexdef),
  );
  const dateIndexExact = indexes.rows.some((row) =>
    row.indexname === "FinancialCashClose_businessDate_idx"
    && /\("businessDate"\)/.test(row.indexdef),
  );

  const exactSchema = columnsExact && Boolean(defaultsExact) && primaryKeyExact && foreignKeyExact
    && uniqueExact && locationIndexExact && dateIndexExact;
  const applied = migrationRows.rows.some((row) => row.finished_at && !row.rolled_back_at);

  return {
    applied,
    exactSchema,
    checksum: createHash("sha256").update(MIGRATION_SQL).digest("hex"),
    migrationRows: migrationRows.rows.map((row) => ({
      id: row.id,
      checksum: row.checksum,
      finishedAt: row.finished_at?.toISOString() || null,
      rolledBackAt: row.rolled_back_at?.toISOString() || null,
      startedAt: row.started_at.toISOString(),
      appliedStepsCount: row.applied_steps_count,
    })),
    columns: columns.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
    rowCount: Number(rowCount.rows[0]?.count || 0),
    checks: {
      columnsExact,
      defaultsExact: Boolean(defaultsExact),
      primaryKeyExact,
      foreignKeyExact,
      uniqueExact,
      locationIndexExact,
      dateIndexExact,
    },
  };
}

export async function GET(request: NextRequest) {
  if (!allowedPreview(request)) {
    return NextResponse.json({ ok: false }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const client = new Client({ connectionString: migrationConnectionString() });
  try {
    await client.connect();
    const before = await inspectState(client);
    const mode = request.nextUrl.searchParams.get("confirm");

    if (mode === "inspect-financial-center-v3") {
      return NextResponse.json({ ok: true, migration: MIGRATION_NAME, state: before }, { headers: { "Cache-Control": "no-store" } });
    }

    if (before.applied) {
      return NextResponse.json({ ok: true, alreadyApplied: true, migration: MIGRATION_NAME, state: before }, { headers: { "Cache-Control": "no-store" } });
    }

    if (!before.exactSchema || before.migrationRows.length > 0) {
      return NextResponse.json(
        { ok: false, error: "MIGRATION_STATE_REQUIRES_MANUAL_REVIEW", migration: MIGRATION_NAME, state: before },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    await client.query("BEGIN");
    try {
      await client.query(
        'INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","logs","rolled_back_at","started_at","applied_steps_count") VALUES ($1,$2,CURRENT_TIMESTAMP,$3,NULL,NULL,CURRENT_TIMESTAMP,1)',
        [randomUUID(), before.checksum, MIGRATION_NAME],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }

    const after = await inspectState(client);
    const verified = after.applied && after.exactSchema;
    return NextResponse.json(
      { ok: verified, resolvedAsApplied: true, migration: MIGRATION_NAME, before, after },
      { status: verified ? 200 : 500, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("financial center v3 migration reconciliation failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "DATABASE_RELEASE_FAILED" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}
