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
export async function acquireTransactionAdvisoryLock(
  tx: Prisma.TransactionClient,
  key: string,
) {
  await tx.$queryRawUnsafe<Array<{ locked: number }>>(
    "SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))",
    key,
  );
}
