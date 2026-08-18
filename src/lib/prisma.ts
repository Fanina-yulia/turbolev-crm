import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/src/generated/prisma/client";
import { requireDatabaseUrl } from "@/src/lib/database-url";

const globalForPrisma = globalThis as unknown as {
  turboLevPrisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: requireDatabaseUrl() });
  return new PrismaClient({ adapter });
}

/**
 * Lazy singleton so `next build` can compile before a database is attached.
 * The connection is created only when a server route actually accesses DB.
 */
export function getPrisma(): PrismaClient {
  globalForPrisma.turboLevPrisma ??= createPrismaClient();
  return globalForPrisma.turboLevPrisma;
}
