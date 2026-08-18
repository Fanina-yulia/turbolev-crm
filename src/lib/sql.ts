import { Pool } from "pg";
import { requireDatabaseUrl } from "@/src/lib/database-url";

const globalForSql = globalThis as unknown as { turboLevSqlPool?: Pool };

export function getSqlPool(): Pool {
  globalForSql.turboLevSqlPool ??= new Pool({
    connectionString: requireDatabaseUrl(),
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  return globalForSql.turboLevSqlPool;
}
