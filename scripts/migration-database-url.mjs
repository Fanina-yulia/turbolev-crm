function clean(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeNeonDirectUrl(value) {
  const source = clean(value);
  if (!source) return null;

  try {
    const url = new URL(source);
    const hostname = url.hostname.toLowerCase();
    if (!hostname.endsWith(".neon.tech")) return source;

    const labels = url.hostname.split(".");
    if (!labels[0]?.endsWith("-pooler")) return source;

    labels[0] = labels[0].slice(0, -"-pooler".length);
    url.hostname = labels.join(".");
    return url.toString();
  } catch {
    return source;
  }
}

export function resolveMigrationDatabaseUrl(env = process.env) {
  const source =
    clean(env.DATABASE_URL_UNPOOLED) ||
    clean(env.DIRECT_URL) ||
    clean(env.DATABASE_URL);

  return normalizeNeonDirectUrl(source);
}

export function createMigrationEnvironment(env = process.env) {
  const databaseUrl = resolveMigrationDatabaseUrl(env);
  if (!databaseUrl) return { env: { ...env }, databaseUrl: null, usesDirectNeon: false };

  let usesDirectNeon = false;
  try {
    const parsed = new URL(databaseUrl);
    usesDirectNeon = parsed.hostname.toLowerCase().endsWith(".neon.tech") && !parsed.hostname.includes("-pooler.");
  } catch {
    // Leave false for non-URL values. Prisma will report an actionable connection error.
  }

  return {
    env: {
      ...env,
      // prisma.config.ts prefers DATABASE_URL_UNPOOLED/DIRECT_URL. Override all
      // datasource aliases only for the migration subprocess so Prisma Migrate
      // cannot fall back to a PgBouncer pooled Neon session.
      DATABASE_URL: databaseUrl,
      DATABASE_URL_UNPOOLED: databaseUrl,
      DIRECT_URL: databaseUrl,
    },
    databaseUrl,
    usesDirectNeon,
  };
}
