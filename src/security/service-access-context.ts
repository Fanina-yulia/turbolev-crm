import { createHash, randomUUID, webcrypto } from "node:crypto";

export const SERVICE_SCOPES = [
  "vehicle:resolve",
  "vehicle:read",
  "fitment:read",
  "catalog:read",
  "lead:submit",
  "order:submit",
] as const;

export type ServiceScope = (typeof SERVICE_SCOPES)[number];
export type ServiceEnvironment = "production" | "preview" | "development";

export type ServicePolicy = {
  subject: string;
  environment: ServiceEnvironment;
  scopes: ServiceScope[];
  owner?: string;
  project?: string;
};

export type ServiceAccessContext = {
  authenticated: true;
  principalType: "VERCEL_PROJECT";
  subject: string;
  owner: string | null;
  project: string | null;
  environment: ServiceEnvironment;
  scopes: ServiceScope[];
  tokenJtiHash: string | null;
};

type JwtHeader = { alg?: unknown; kid?: unknown; typ?: unknown };
type JwtClaims = {
  iss?: unknown;
  aud?: unknown;
  sub?: unknown;
  exp?: unknown;
  nbf?: unknown;
  iat?: unknown;
  jti?: unknown;
  owner?: unknown;
  project?: unknown;
  environment?: unknown;
};

type OidcConfig = {
  issuer: string;
  audience: string;
  targetEnvironment: ServiceEnvironment;
  policies: ServicePolicy[];
  clockToleranceSeconds?: number;
  jwksCacheMs?: number;
};

type FetchLike = typeof fetch;

type DiscoveryDocument = { issuer?: string; jwks_uri?: string };
type JwkSet = { keys?: JsonWebKey[] };

type CachedJwks = { issuer: string; jwksUri: string; keys: JsonWebKey[]; expiresAt: number };
let cachedJwks: CachedJwks | null = null;

export class ServiceAccessError extends Error {
  readonly status: 401 | 403 | 503;
  readonly code:
    | "SERVICE_AUTH_MISSING"
    | "SERVICE_AUTH_INVALID"
    | "SERVICE_AUTH_NOT_CONFIGURED"
    | "SERVICE_PRINCIPAL_DENIED"
    | "SERVICE_SCOPE_DENIED";

  constructor(status: ServiceAccessError["status"], code: ServiceAccessError["code"], message: string) {
    super(message);
    this.name = "ServiceAccessError";
    this.status = status;
    this.code = code;
  }
}

function base64urlDecode(value: string) {
  return Buffer.from(value, "base64url");
}

function parseJsonPart<T>(value: string): T {
  return JSON.parse(base64urlDecode(value).toString("utf8")) as T;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asEnvironment(value: unknown): ServiceEnvironment | null {
  return value === "production" || value === "preview" || value === "development" ? value : null;
}

function parseAudience(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeIssuer(value: string) {
  return value.trim().replace(/\/$/, "");
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization")?.trim() || "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() || null;
}

export function parseServicePolicies(raw = process.env.INTEGRATION_SERVICE_POLICIES_JSON || ""): ServicePolicy[] {
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const policies: ServicePolicy[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const row = item as Record<string, unknown>;
      const subject = asString(row.subject);
      const environment = asEnvironment(row.environment);
      if (!subject || !environment || !Array.isArray(row.scopes)) continue;
      const scopes = row.scopes.filter((scope): scope is ServiceScope =>
        typeof scope === "string" && (SERVICE_SCOPES as readonly string[]).includes(scope));
      if (!scopes.length) continue;
      policies.push({
        subject,
        environment,
        scopes: [...new Set(scopes)],
        owner: asString(row.owner) || undefined,
        project: asString(row.project) || undefined,
      });
    }
    return policies;
  } catch {
    return [];
  }
}

export function serviceOidcConfigFromEnv(): OidcConfig {
  const issuer = normalizeIssuer(process.env.VERCEL_OIDC_ISSUER || "");
  const audience = (process.env.VERCEL_OIDC_AUDIENCE || "").trim();
  const targetEnvironment = asEnvironment(process.env.INTEGRATION_TARGET_ENVIRONMENT) ||
    (process.env.VERCEL_ENV === "production" ? "production" : process.env.VERCEL_ENV === "preview" ? "preview" : "development");
  return {
    issuer,
    audience,
    targetEnvironment,
    policies: parseServicePolicies(),
  };
}

function assertConfigured(config: OidcConfig) {
  if (!config.issuer || !config.audience || !config.policies.length) {
    throw new ServiceAccessError(503, "SERVICE_AUTH_NOT_CONFIGURED", "Integration service authentication is not configured.");
  }
}

async function fetchJson<T>(url: string, fetcher: FetchLike, timeoutMs = 1500): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`OIDC_HTTP_${response.status}`);
    return await response.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

async function getJwks(config: OidcConfig, fetcher: FetchLike) {
  const now = Date.now();
  const issuer = normalizeIssuer(config.issuer);
  if (cachedJwks?.issuer === issuer && cachedJwks.expiresAt > now) return cachedJwks;

  const discoveryUrl = `${issuer}/.well-known/openid-configuration`;
  const discovery = await fetchJson<DiscoveryDocument>(discoveryUrl, fetcher);
  const discoveredIssuer = asString(discovery.issuer);
  const jwksUri = asString(discovery.jwks_uri);
  if (discoveredIssuer && normalizeIssuer(discoveredIssuer) !== issuer) throw new Error("OIDC_DISCOVERY_ISSUER_MISMATCH");
  if (!jwksUri) throw new Error("OIDC_JWKS_URI_MISSING");
  const jwks = await fetchJson<JwkSet>(jwksUri, fetcher);
  const keys = Array.isArray(jwks.keys) ? jwks.keys : [];
  if (!keys.length) throw new Error("OIDC_JWKS_EMPTY");
  cachedJwks = { issuer, jwksUri, keys, expiresAt: now + Math.max(config.jwksCacheMs ?? 300_000, 30_000) };
  return cachedJwks;
}

async function verifyRs256(token: string, header: JwtHeader, config: OidcConfig, fetcher: FetchLike) {
  const kid = asString(header.kid);
  if (header.alg !== "RS256" || !kid) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const jwks = await getJwks(config, fetcher);
  const jwk = jwks.keys.find((candidate) => candidate.kid === kid && (!candidate.alg || candidate.alg === "RS256"));
  if (!jwk) return false;
  const key = await webcrypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return webcrypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64urlDecode(parts[2]),
    Buffer.from(`${parts[0]}.${parts[1]}`, "utf8"),
  );
}

export async function verifyServiceAccessToken(
  token: string,
  requiredScope: ServiceScope,
  config: OidcConfig = serviceOidcConfigFromEnv(),
  fetcher: FetchLike = fetch,
): Promise<ServiceAccessContext> {
  assertConfigured(config);
  const parts = token.split(".");
  if (parts.length !== 3) throw new ServiceAccessError(401, "SERVICE_AUTH_INVALID", "Invalid service token.");

  let header: JwtHeader;
  let claims: JwtClaims;
  try {
    header = parseJsonPart<JwtHeader>(parts[0]);
    claims = parseJsonPart<JwtClaims>(parts[1]);
  } catch {
    throw new ServiceAccessError(401, "SERVICE_AUTH_INVALID", "Invalid service token.");
  }

  try {
    if (!(await verifyRs256(token, header, config, fetcher))) {
      throw new ServiceAccessError(401, "SERVICE_AUTH_INVALID", "Invalid service token.");
    }
  } catch (error) {
    if (error instanceof ServiceAccessError) throw error;
    throw new ServiceAccessError(503, "SERVICE_AUTH_NOT_CONFIGURED", "Service identity verification is temporarily unavailable.");
  }

  const issuer = asString(claims.iss);
  const subject = asString(claims.sub);
  const environment = asEnvironment(claims.environment);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const tolerance = Math.max(config.clockToleranceSeconds ?? 30, 0);
  const exp = typeof claims.exp === "number" ? claims.exp : NaN;
  const nbf = typeof claims.nbf === "number" ? claims.nbf : null;
  const audiences = parseAudience(claims.aud);

  if (!issuer || normalizeIssuer(issuer) !== normalizeIssuer(config.issuer) ||
      !audiences.includes(config.audience) || !subject || !Number.isFinite(exp) || exp < nowSeconds - tolerance ||
      (nbf !== null && nbf > nowSeconds + tolerance)) {
    throw new ServiceAccessError(401, "SERVICE_AUTH_INVALID", "Invalid service token.");
  }

  const policy = config.policies.find((candidate) => candidate.subject === subject && candidate.environment === config.targetEnvironment);
  if (!policy || environment !== config.targetEnvironment) {
    throw new ServiceAccessError(403, "SERVICE_PRINCIPAL_DENIED", "Service principal is not allowed for this environment.");
  }
  if (!policy.scopes.includes(requiredScope)) {
    throw new ServiceAccessError(403, "SERVICE_SCOPE_DENIED", "Service principal does not have the required scope.");
  }

  return {
    authenticated: true,
    principalType: "VERCEL_PROJECT",
    subject,
    owner: asString(claims.owner) || policy.owner || null,
    project: asString(claims.project) || policy.project || null,
    environment,
    scopes: policy.scopes,
    tokenJtiHash: asString(claims.jti) ? sha256(asString(claims.jti)!) : null,
  };
}

export async function requireServiceScope(
  request: Request,
  requiredScope: ServiceScope,
  options: { config?: OidcConfig; fetcher?: FetchLike } = {},
) {
  const token = bearerToken(request);
  if (!token) throw new ServiceAccessError(401, "SERVICE_AUTH_MISSING", "Service authentication is required.");
  return verifyServiceAccessToken(token, requiredScope, options.config, options.fetcher);
}

export function servicePrincipalHash(context: Pick<ServiceAccessContext, "subject" | "environment">) {
  return sha256(`${context.environment}:${context.subject}`);
}

export function testOnlyResetOidcCache() {
  if (process.env.NODE_ENV === "production") throw new Error("OIDC cache reset is test-only.");
  cachedJwks = null;
}

export function newOpaqueTraceId() {
  return randomUUID();
}
