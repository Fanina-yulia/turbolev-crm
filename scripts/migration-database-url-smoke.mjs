import {
  createMigrationEnvironment,
  normalizeNeonDirectUrl,
  resolveMigrationDatabaseUrl,
} from "./migration-database-url.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const pooled = "postgresql://user:secret@ep-example-123-pooler.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require";
const direct = "postgresql://user:secret@ep-example-123.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require";

const normalized = normalizeNeonDirectUrl(pooled);
assert(normalized, "pooled Neon URL should normalize");
assert(new URL(normalized).hostname === "ep-example-123.c-4.us-east-2.aws.neon.tech", "Neon -pooler suffix should be removed");
assert(new URL(normalized).searchParams.get("sslmode") === "require", "connection query parameters should be preserved");

const fromRuntime = resolveMigrationDatabaseUrl({ DATABASE_URL: pooled });
assert(fromRuntime && new URL(fromRuntime).hostname === new URL(direct).hostname, "pooled runtime URL should resolve to direct Neon host");

const fromMisconfiguredUnpooled = resolveMigrationDatabaseUrl({ DATABASE_URL_UNPOOLED: pooled, DATABASE_URL: pooled });
assert(
  fromMisconfiguredUnpooled && new URL(fromMisconfiguredUnpooled).hostname === new URL(direct).hostname,
  "pooled DATABASE_URL_UNPOOLED should still be normalized to direct Neon host",
);

const explicitDirect = resolveMigrationDatabaseUrl({ DATABASE_URL_UNPOOLED: direct, DATABASE_URL: pooled });
assert(explicitDirect === direct, "explicit direct Neon URL should remain unchanged");

const otherDatabase = "postgresql://user:secret@postgres.example.com/app";
assert(normalizeNeonDirectUrl(otherDatabase) === otherDatabase, "non-Neon database URL should not be rewritten");

const migration = createMigrationEnvironment({ DATABASE_URL: pooled, OTHER_VALUE: "keep" });
assert(migration.usesDirectNeon === true, "migration environment should identify a direct Neon endpoint");
assert(new URL(migration.env.DATABASE_URL).hostname === new URL(direct).hostname, "migration DATABASE_URL should be direct");
assert(migration.env.DATABASE_URL_UNPOOLED === migration.env.DATABASE_URL, "unpooled alias should use the same direct URL");
assert(migration.env.DIRECT_URL === migration.env.DATABASE_URL, "direct alias should use the same direct URL");
assert(migration.env.OTHER_VALUE === "keep", "unrelated environment values should be preserved");

const missing = createMigrationEnvironment({ OTHER_VALUE: "keep" });
assert(missing.databaseUrl === null, "missing database URL should remain missing");
assert(missing.usesDirectNeon === false, "missing database URL should not claim direct Neon");

console.log("Migration database URL smoke: OK");
