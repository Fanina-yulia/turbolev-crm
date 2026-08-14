import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/src/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  turboLevPrisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL?.trim();

  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  const adapter = new PrismaPg({ connectionString });
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
