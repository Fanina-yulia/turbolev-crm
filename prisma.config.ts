import "dotenv/config";
import { defineConfig } from "prisma/config";

const fallbackUrl =
  "postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder";

export default defineConfig({
  schema: "prisma/",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Migrations should prefer the direct Neon connection. Runtime uses
    // DATABASE_URL (pooled) through @prisma/adapter-pg.
    url:
      process.env.DATABASE_URL_UNPOOLED?.trim() ||
      process.env.DIRECT_URL?.trim() ||
      process.env.DATABASE_URL?.trim() ||
      fallbackUrl,
  },
});
