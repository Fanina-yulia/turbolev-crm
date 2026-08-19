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

const baseUrl = getNeonAuthBaseUrl();
if (!baseUrl) throw new Error("Neon Auth is not configured");

export const neonAuth = createNeonAuth({
  baseUrl,
  cookies: { secret: getCookieSecret() },
});

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
    const result = await neonAuth.getSession();
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
