import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIGRATION_NAME = "20261006233000_financial_center_v3_cash_close";
const MIGRATION_SQL = `-- Financial Center V3: audited cash-day closing.
-- Create-only: factual CashTransaction ledger remains unchanged.

CREATE TABLE "FinancialCashClose" (
  "id" TEXT NOT NULL,
  "businessDate" DATE NOT NULL,
  "moneyAccountId" TEXT NOT NULL,
  "locationId" VARCHAR(64),
  "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
  "systemAmount" DECIMAL(14,2) NOT NULL,
  "countedAmount" DECIMAL(14,2) NOT NULL,
  "difference" DECIMAL(14,2) NOT NULL,
  "note" TEXT,
  "closedById" VARCHAR(64),
  "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinancialCashClose_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FinancialCashClose_account_businessDate_key"
  ON "FinancialCashClose"("moneyAccountId","businessDate");

CREATE INDEX "FinancialCashClose_locationId_businessDate_idx"
  ON "FinancialCashClose"("locationId","businessDate");

CREATE INDEX "FinancialCashClose_businessDate_idx"
  ON "FinancialCashClose"("businessDate");

ALTER TABLE "FinancialCashClose"
  ADD CONSTRAINT "FinancialCashClose_moneyAccountId_fkey"
  FOREIGN KEY ("moneyAccountId") REFERENCES "MoneyAccount"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;`;

function authorized(request: NextRequest) {
  const expected = process.env.DB_RELEASE_TOKEN?.trim() || "";
  const supplied = request.headers.get("x-db-release-token")?.trim() || "";
  return Boolean(expected && supplied && supplied === expected);
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

function hidden() {
  return NextResponse.json({ ok: false }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

async function readState(client: Client) {
  const migration = await client.query<{ applied: boolean }>(
    `SELECT EXISTS(
       SELECT 1
         FROM "_prisma_migrations"
        WHERE "migration_name"=$1
          AND "finished_at" IS NOT NULL
          AND "rolled_back_at" IS NULL
     ) AS applied`,
    [MIGRATION_NAME],
  );
  const relation = await client.query<{ table_exists: boolean; fk_exists: boolean; index_count: number }>(`
    SELECT
      to_regclass('"FinancialCashClose"') IS NOT NULL AS table_exists,
      EXISTS(
        SELECT 1 FROM pg_constraint
         WHERE conname='FinancialCashClose_moneyAccountId_fkey'
      ) AS fk_exists,
      (
        SELECT COUNT(*)::int
          FROM pg_indexes
         WHERE tablename='FinancialCashClose'
           AND indexname IN (
             'FinancialCashClose_account_businessDate_key',
             'FinancialCashClose_locationId_businessDate_idx',
             'FinancialCashClose_businessDate_idx'
           )
      ) AS index_count
  `);
  return {
    migrationApplied: Boolean(migration.rows[0]?.applied),
    tableExists: Boolean(relation.rows[0]?.table_exists),
    foreignKeyExists: Boolean(relation.rows[0]?.fk_exists),
    indexCount: Number(relation.rows[0]?.index_count || 0),
  };
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return hidden();

  const client = new Client({ connectionString: migrationConnectionString() });
  try {
    await client.connect();

    const before = await readState(client);
    if (before.migrationApplied && before.tableExists && before.foreignKeyExists && before.indexCount === 3) {
      return NextResponse.json(
        { ok: true, alreadyApplied: true, migration: MIGRATION_NAME, verification: before },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (before.migrationApplied !== before.tableExists || before.tableExists) {
      return NextResponse.json(
        { ok: false, error: "MIGRATION_STATE_INCONSISTENT", migration: MIGRATION_NAME, verification: before },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    const checksum = createHash("sha256").update(MIGRATION_SQL).digest("hex");

    await client.query("BEGIN");
    try {
      await client.query(MIGRATION_SQL);
      await client.query(
        'INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","logs","rolled_back_at","started_at","applied_steps_count") VALUES ($1,$2,CURRENT_TIMESTAMP,$3,NULL,NULL,CURRENT_TIMESTAMP,1)',
        [randomUUID(), checksum, MIGRATION_NAME],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }

    const after = await readState(client);
    const verified = after.migrationApplied && after.tableExists && after.foreignKeyExists && after.indexCount === 3;
    return NextResponse.json(
      { ok: verified, alreadyApplied: false, migration: MIGRATION_NAME, verification: after },
      { status: verified ? 200 : 500, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("financial center v3 database release failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "DATABASE_RELEASE_FAILED" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}
