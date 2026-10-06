import { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";

function num(value: unknown) {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value && typeof value === "object" && "toString" in value) {
    const parsed = Number(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

type Scope = {
  from: Date;
  to: Date;
  locationId?: string | null;
  allowedLocationIds?: string[];
};

function locationSql(scope: Scope, alias: string) {
  const column = Prisma.raw(`${alias}."serviceLocationId"`);
  if (scope.locationId) return Prisma.sql`AND ${column} = ${scope.locationId}`;
  if (scope.allowedLocationIds?.length) return Prisma.sql`AND ${column} IN (${Prisma.join(scope.allowedLocationIds)})`;
  return Prisma.sql``;
}

export async function getFinanceExpenseCenterInventoryFacts(scope: Scope) {
  const prisma = getPrisma();
  const ledgerLocation = locationSql(scope, "ile");
  const balanceLocation = locationSql(scope, "b");

  const [flowRows, balanceRows] = await Promise.all([
    prisma.$queryRaw<Array<{
      receiptValue: unknown;
      receiptCount: bigint;
      issueValue: unknown;
      issueCount: bigint;
      returnValue: unknown;
      returnCount: bigint;
      missingReceiptCostCount: bigint;
      missingIssueCostCount: bigint;
    }>>(Prisma.sql`
      SELECT
        COALESCE(SUM(
          CASE WHEN ile."direction"::text = 'IN' AND ile."reason"::text = 'RECEIPT'
            THEN ile."quantity" * COALESCE(ile."unitCost", 0) ELSE 0 END
        ), 0) AS "receiptValue",
        COUNT(*) FILTER (
          WHERE ile."direction"::text = 'IN' AND ile."reason"::text = 'RECEIPT'
        )::bigint AS "receiptCount",
        COALESCE(SUM(
          CASE WHEN ile."direction"::text = 'OUT' AND ile."reason"::text IN ('ISSUE','RESERVATION_CONSUME')
            THEN ile."quantity" * COALESCE(ile."unitCost", 0) ELSE 0 END
        ), 0) AS "issueValue",
        COUNT(*) FILTER (
          WHERE ile."direction"::text = 'OUT' AND ile."reason"::text IN ('ISSUE','RESERVATION_CONSUME')
        )::bigint AS "issueCount",
        COALESCE(SUM(
          CASE WHEN ile."direction"::text = 'IN' AND ile."reason"::text = 'RETURN'
            THEN ile."quantity" * COALESCE(ile."unitCost", 0) ELSE 0 END
        ), 0) AS "returnValue",
        COUNT(*) FILTER (
          WHERE ile."direction"::text = 'IN' AND ile."reason"::text = 'RETURN'
        )::bigint AS "returnCount",
        COUNT(*) FILTER (
          WHERE ile."direction"::text = 'IN'
            AND ile."reason"::text = 'RECEIPT'
            AND ile."unitCost" IS NULL
        )::bigint AS "missingReceiptCostCount",
        COUNT(*) FILTER (
          WHERE ile."direction"::text = 'OUT'
            AND ile."reason"::text IN ('ISSUE','RESERVATION_CONSUME')
            AND ile."unitCost" IS NULL
        )::bigint AS "missingIssueCostCount"
      FROM "InventoryLedgerEntry" ile
      WHERE ile."occurredAt" >= ${scope.from}
        AND ile."occurredAt" < ${scope.to}
        ${ledgerLocation}
    `),
    prisma.$queryRaw<Array<{
      stockValue: unknown;
      stockLines: bigint;
      unknownCostLines: bigint;
      reservedUnits: unknown;
      onHandUnits: unknown;
    }>>(Prisma.sql`
      SELECT
        COALESCE(SUM(b."onHand" * COALESCE(last_cost."unitCost", 0)), 0) AS "stockValue",
        COUNT(*)::bigint AS "stockLines",
        COUNT(*) FILTER (WHERE last_cost."unitCost" IS NULL)::bigint AS "unknownCostLines",
        COALESCE(SUM(b."reserved"), 0) AS "reservedUnits",
        COALESCE(SUM(b."onHand"), 0) AS "onHandUnits"
      FROM "InventoryBalance" b
      LEFT JOIN LATERAL (
        SELECT ile."unitCost"
        FROM "InventoryLedgerEntry" ile
        WHERE ile."warehouseKey" = b."warehouseKey"
          AND ile."stockKey" = b."stockKey"
          AND ile."unitCost" IS NOT NULL
        ORDER BY ile."occurredAt" DESC, ile."createdAt" DESC
        LIMIT 1
      ) last_cost ON TRUE
      WHERE b."onHand" > 0
        ${balanceLocation}
    `),
  ]);

  const flow = flowRows[0];
  const balance = balanceRows[0];

  return {
    period: {
      receiptValue: num(flow?.receiptValue),
      receiptCount: Number(flow?.receiptCount || 0n),
      issueValue: num(flow?.issueValue),
      issueCount: Number(flow?.issueCount || 0n),
      returnValue: num(flow?.returnValue),
      returnCount: Number(flow?.returnCount || 0n),
      missingReceiptCostCount: Number(flow?.missingReceiptCostCount || 0n),
      missingIssueCostCount: Number(flow?.missingIssueCostCount || 0n),
    },
    inventory: {
      stockValue: num(balance?.stockValue),
      stockLines: Number(balance?.stockLines || 0n),
      unknownCostLines: Number(balance?.unknownCostLines || 0n),
      reservedUnits: num(balance?.reservedUnits),
      onHandUnits: num(balance?.onHandUnits),
      valuationMethod: "LAST_FACTUAL_UNIT_COST" as const,
    },
  };
}
