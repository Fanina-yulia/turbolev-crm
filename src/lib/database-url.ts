const LEGACY_STRONG_SSL_MODES = /([?&]sslmode=)(prefer|require|verify-ca)(?=(&|$))/gi;
const LIBPQ_COMPAT = /[?&]uselibpqcompat=true(?=(&|$))/i;

/**
 * pg currently treats prefer/require/verify-ca as verify-full, but pg v9 will
 * switch those names to libpq-compatible (weaker) semantics. Preserve today's
 * verified-certificate + hostname behavior explicitly and silence the runtime
 * deprecation/security warning without changing the stored DATABASE_URL secret.
 */
export function normalizePostgresRuntimeUrl(value: string): string {
  const connectionString = value.trim();
  if (!connectionString || LIBPQ_COMPAT.test(connectionString)) return connectionString;
  return connectionString.replace(LEGACY_STRONG_SSL_MODES, "$1verify-full");
}

export function requireDatabaseUrl(value = process.env.DATABASE_URL): string {
  const connectionString = value?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  return normalizePostgresRuntimeUrl(connectionString);
}
