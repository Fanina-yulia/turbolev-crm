import type { Prisma } from "@/src/generated/prisma/client";

/**
 * Acquire a PostgreSQL transaction-scoped advisory lock without exposing the
 * database function's `void` return type to Prisma.
 *
 * Prisma 7.10 cannot deserialize PostgreSQL `void` from
 * `SELECT pg_advisory_xact_lock(...)`. Selecting a supported scalar from the
 * function instead keeps the exact locking semantics while returning only an
 * integer column to Prisma.
 */
export const PRISMA_TRANSACTION_ADVISORY_LOCK_SQL =\n  "SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))";\n\nexport async function acquireTransactionAdvisoryLock(
  tx: Prisma.TransactionClient,
  key: string,
) {
  await tx.$queryRawUnsafe<Array<{ locked: number }>>(
    PRISMA_TRANSACTION_ADVISORY_LOCK_SQL,
    key,
  );
}
