import "server-only";

const NEON_HOST_SUFFIX = ".neon.tech";
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const REQUEST_HEADERS = ["accept", "authorization", "content-type", "cookie", "origin", "referer", "user-agent"] as const;
const RESPONSE_HEADERS = ["cache-control", "content-type", "location", "set-auth-jwt", "set-auth-token", "vary", "x-neon-ret-request-id"] as const;

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function deriveAuthUrlFromDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!databaseUrl) return null;

  try {
    const url = new URL(databaseUrl);
    if (!url.hostname.endsWith(NEON_HOST_SUFFIX)) return null;

    const hostParts = url.hostname.split(".");
    if (hostParts.length < 3) return null;

    const endpoint = hostParts[0]?.replace(/-pooler$/, "");
    if (!endpoint?.startsWith("ep-")) return null;

    const rest = hostParts.slice(1).join(".");
    const databaseName = url.pathname.replace(/^\//, "").split("/")[0] || "neondb";
    return `https://${endpoint}.neonauth.${rest}/${encodeURIComponent(databaseName)}/auth`;
  } catch {
    return null;
  }
}

export function getNeonAuthBaseUrl() {
  const explicit = process.env.NEON_AUTH_BASE_URL?.trim();
  if (explicit) return normalizeBaseUrl(explicit);
  return deriveAuthUrlFromDatabaseUrl();
}

export function isNeonAuthConfigured() {
  return Boolean(getNeonAuthBaseUrl());
}

function copyRequestHeaders(source: Headers) {
  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = source.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("accept")) headers.set("accept", "application/json");
  return headers;
}

function copyResponseHeaders(source: Headers) {
  const headers = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = source.get(name);
    if (value) headers.set(name, value);
  }

  const getSetCookie = (source as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === "function") {
    for (const cookie of getSetCookie.call(source)) headers.append("set-cookie", cookie);
  } else {
    const cookie = source.get("set-cookie");
    if (cookie) headers.set("set-cookie", cookie);
  }
  return headers;
}

function safePath(path: string[]) {
  return path
    .filter(Boolean)
    .map((part) => encodeURIComponent(decodeURIComponent(part)))
    .join("/");
}

export async function proxyNeonAuthRequest(request: Request, path: string[]) {
  const baseUrl = getNeonAuthBaseUrl();
  if (!baseUrl) {
    return Response.json(
      { ok: false, error: "AUTH_NOT_CONFIGURED", message: "Neon Auth is not configured for this environment." },
      { status: 503 },
    );
  }

  if (!ALLOWED_METHODS.has(request.method)) {
    return Response.json({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405 });
  }

  const sourceUrl = new URL(request.url);
  const upstream = new URL(`${baseUrl}/${safePath(path)}`);
  upstream.search = sourceUrl.search;

  const headers = copyRequestHeaders(request.headers);
  const body = request.method === "GET" ? undefined : await request.arrayBuffer();

  try {
    const response = await fetch(upstream, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store",
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: copyResponseHeaders(response.headers),
    });
  } catch (error) {
    console.error("[security] Neon Auth proxy unavailable", error instanceof Error ? error.message : "unknown error");
    return Response.json({ ok: false, error: "AUTH_UPSTREAM_UNAVAILABLE" }, { status: 503 });
  }
}

export type NeonAuthSession = {
  user: {
    id: string;
    email: string | null;
    name: string | null;
    emailVerified: boolean | null;
  };
  session: Record<string, unknown> | null;
  raw: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanOrNull(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

export async function getNeonAuthSession(headers: Headers): Promise<NeonAuthSession | null> {
  const baseUrl = getNeonAuthBaseUrl();
  if (!baseUrl) return null;
  const cookie = headers.get("cookie");
  const authorization = headers.get("authorization");
  if (!cookie && !authorization) return null;

  const requestHeaders = copyRequestHeaders(headers);
  try {
    const response = await fetch(`${baseUrl}/get-session`, {
      method: "GET",
      headers: requestHeaders,
      cache: "no-store",
    });
    if (response.status === 401 || response.status === 403 || response.status === 404) return null;
    if (!response.ok) return null;

    const payload = asRecord(await response.json().catch(() => null));
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
