import "server-only";

import { createHash } from "node:crypto";
import { createNeonAuth } from "@neondatabase/auth/next/server";
import { getNeonAuthBaseUrl, type NeonAuthSession } from "@/src/security/neon-auth-transport";

function getCookieSecret() {
  const explicit = process.env.NEON_AUTH_COOKIE_SECRET?.trim();
  if (explicit && explicit.length >= 32) return explicit;

  // Keep auth functional on existing deployments while a dedicated cookie
  // secret is being rolled out. The fallback is server-only and stable for
  // the current database credentials; changing those credentials signs users out.
  const seed =
    process.env.INTEGRATIONS_MASTER_KEY?.trim() ||
    process.env.DATABASE_URL_UNPOOLED?.trim() ||
    process.env.DIRECT_URL?.trim() ||
    process.env.DATABASE_URL?.trim();

  if (!seed) throw new Error("Neon Auth cookie secret is unavailable");
  return createHash("sha256")
    .update(`turbolev-neon-auth-cookie-v1:${seed}`, "utf8")
    .digest("base64url");
}

type NeonAuthServer = ReturnType<typeof createNeonAuth>;
let cachedNeonAuth: NeonAuthServer | null = null;

/**
 * Resolve Neon Auth only when a request/session actually needs it.
 *
 * Next.js imports route modules while collecting build metadata. CI deliberately
 * does not receive production auth secrets, so eager module-level initialization
 * would make a valid application impossible to build. Runtime requests still fail
 * closed if Neon Auth is not configured; this function does not provide a dummy
 * auth provider or weaken authentication.
 */
export function getNeonAuth() {
  if (cachedNeonAuth) return cachedNeonAuth;
  const baseUrl = getNeonAuthBaseUrl();
  if (!baseUrl) throw new Error("Neon Auth is not configured");
  cachedNeonAuth = createNeonAuth({
    baseUrl,
    cookies: { secret: getCookieSecret() },
  });
  return cachedNeonAuth;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanOrNull(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

export async function getNeonAuthSdkSession(): Promise<NeonAuthSession | null> {
  try {
    const result = await getNeonAuth().getSession();
    const resultRecord = asRecord(result);
    const payload = asRecord(resultRecord?.data);
    if (!payload) return null;

    const user = asRecord(payload.user);
    if (!user) return null;
    const id = stringOrNull(user.id);
    if (!id) return null;

    return {
      user: {
        id,
        email: stringOrNull(user.email)?.toLowerCase() ?? null,
        name: stringOrNull(user.name),
        emailVerified:
          booleanOrNull(user.emailVerified) ??
          booleanOrNull(user.email_verified) ??
          booleanOrNull(user.verified) ??
          null,
      },
      session: asRecord(payload.session),
      raw: payload,
    };
  } catch {
    return null;
  }
}
