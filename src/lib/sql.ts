import { Pool } from "pg";

const globalForSql = globalThis as unknown as { turboLevSqlPool?: Pool };

export function getSqlPool(): Pool {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is not configured");

  globalForSql.turboLevSqlPool ??= new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  return globalForSql.turboLevSqlPool;
}
