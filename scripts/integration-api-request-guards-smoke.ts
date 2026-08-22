import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { getPrisma } from "@/src/lib/prisma";
import {
  abandonIdempotentOperation,
  beginIdempotentOperation,
  cleanupExpiredIntegrationGuards,
  completeIdempotentOperation,
  correlationIdForRequest,
  enforceIntegrationRateLimit,
  requiredIdempotencyKey,
  stableRequestFingerprint,
} from "@/src/services/integration-api-request-guard.service";
import {
  ServiceAccessError,
  testOnlyResetOidcCache,
  verifyServiceAccessToken,
  type ServiceEnvironment,
  type ServicePolicy,
} from "@/src/security/service-access-context";

const encoder = new TextEncoder();

function b64(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

async function createSigner() {
  const keyPair = await webcrypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await webcrypto.subtle.exportKey("jwk", keyPair.publicKey);
  return {
    publicJwk: { ...publicJwk, kid: "test-key", alg: "RS256", use: "sig" },
    async token(claims: Record<string, unknown>) {
      const header = b64({ typ: "JWT", alg: "RS256", kid: "test-key" });
      const payload = b64(claims);
      const signingInput = `${header}.${payload}`;
      const signature = await webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, encoder.encode(signingInput));
      return `${signingInput}.${Buffer.from(signature).toString("base64url")}`;
    },
  };
}

async function expectServiceError(action: () => Promise<unknown>, status: number, code: string) {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof ServiceAccessError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  });
}

async function authSmoke() {
  process.env.NODE_ENV = "test";
  testOnlyResetOidcCache();
  const signer = await createSigner();
  const issuer = "https://oidc.example.test/turbo-lev";
  const audience = "https://vercel.com/turbo-lev";
  const subject = "owner:turbo-lev:project:turbolev-web:environment:production";
  const now = Math.floor(Date.now() / 1000);
  const policies: ServicePolicy[] = [{
    subject,
    environment: "production",
    scopes: ["vehicle:resolve", "vehicle:read", "fitment:read"],
    owner: "turbo-lev",
    project: "turbolev-web",
  }];
  const config = { issuer, audience, targetEnvironment: "production" as ServiceEnvironment, policies, clockToleranceSeconds: 0 };
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url === `${issuer}/.well-known/openid-configuration`) {
      return new Response(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === `${issuer}/jwks`) {
      return new Response(JSON.stringify({ keys: [signer.publicJwk] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  };

  const baseClaims = {
    iss: issuer,
    aud: audience,
    sub: subject,
    owner: "turbo-lev",
    project: "turbolev-web",
    environment: "production",
    iat: now - 5,
    nbf: now - 5,
    exp: now + 600,
    jti: "token-id-never-persist-raw",
  };

  const valid = await signer.token(baseClaims);
  const context = await verifyServiceAccessToken(valid, "vehicle:resolve", config, fetcher);
  assert.equal(context.project, "turbolev-web");
  assert.equal(context.environment, "production");
  assert.ok(context.tokenJtiHash && context.tokenJtiHash !== baseClaims.jti);

  await expectServiceError(
    () => verifyServiceAccessToken(valid, "lead:submit", config, fetcher),
    403,
    "SERVICE_SCOPE_DENIED",
  );

  const wrongAudience = await signer.token({ ...baseClaims, aud: "https://vercel.com/other" });
  await expectServiceError(
    () => verifyServiceAccessToken(wrongAudience, "vehicle:resolve", config, fetcher),
    401,
    "SERVICE_AUTH_INVALID",
  );

  const expired = await signer.token({ ...baseClaims, exp: now - 60 });
  await expectServiceError(
    () => verifyServiceAccessToken(expired, "vehicle:resolve", config, fetcher),
    401,
    "SERVICE_AUTH_INVALID",
  );

  const unknownProject = await signer.token({
    ...baseClaims,
    sub: "owner:turbo-lev:project:unknown:environment:production",
    project: "unknown",
  });
  await expectServiceError(
    () => verifyServiceAccessToken(unknownProject, "vehicle:resolve", config, fetcher),
    403,
    "SERVICE_PRINCIPAL_DENIED",
  );

  const preview = await signer.token({
    ...baseClaims,
    sub: "owner:turbo-lev:project:turbolev-web:environment:preview",
    environment: "preview",
  });
  await expectServiceError(
    () => verifyServiceAccessToken(preview, "vehicle:resolve", config, fetcher),
    403,
    "SERVICE_PRINCIPAL_DENIED",
  );

  const tamperedParts = valid.split(".");
  const tampered = `${tamperedParts[0]}.${b64({ ...baseClaims, project: "tampered" })}.${tamperedParts[2]}`;
  await expectServiceError(
    () => verifyServiceAccessToken(tampered, "vehicle:resolve", config, fetcher),
    401,
    "SERVICE_AUTH_INVALID",
  );

  const unconfigured = { ...config, policies: [] };
  await expectServiceError(
    () => verifyServiceAccessToken(valid, "vehicle:resolve", unconfigured, fetcher),
    503,
    "SERVICE_AUTH_NOT_CONFIGURED",
  );
}

async function guardDbSmoke() {
  const prisma = getPrisma();
  await prisma.integrationIdempotencyRecord.deleteMany();
  await prisma.integrationRateLimitBucket.deleteMany();

  const service = {
    subject: "owner:turbo-lev:project:turbolev-web:environment:production",
    environment: "production" as const,
  };
  const operationKey = "POST:/integration/v1/vehicle-resolutions";
  const key = "idem-test-key-0001";
  const payload = { vehicle: { year: 2020, make: "Volvo" }, mode: "MANUAL" };

  assert.equal(
    stableRequestFingerprint(operationKey, { b: 2, a: 1 }),
    stableRequestFingerprint(operationKey, { a: 1, b: 2 }),
  );

  const request = new Request("https://crm.example.test/integration/v1/test", {
    method: "POST",
    headers: { "X-Correlation-Id": "trace_test:123", "X-Idempotency-Key": key },
  });
  assert.equal(correlationIdForRequest(request), "trace_test:123");
  assert.equal(requiredIdempotencyKey(request), key);
  const generatedCorrelation = correlationIdForRequest(new Request("https://crm.example.test/integration/v1/test"));
  assert.match(generatedCorrelation, /^[0-9a-f-]{36}$/i);

  const first = await beginIdempotentOperation({ service, operationKey, idempotencyKey: key, payload });
  assert.equal(first.kind, "ACQUIRED");
  if (first.kind !== "ACQUIRED") throw new Error("expected acquisition");

  const parallel = await beginIdempotentOperation({ service, operationKey, idempotencyKey: key, payload });
  assert.equal(parallel.kind, "IN_PROGRESS");

  await completeIdempotentOperation({
    recordId: first.recordId,
    requestFingerprint: first.requestFingerprint,
    responseStatus: 201,
    responseBody: { accepted: true, resolutionId: "opaque-1" },
  });

  const replay = await beginIdempotentOperation({
    service,
    operationKey,
    idempotencyKey: key,
    payload: { mode: "MANUAL", vehicle: { make: "Volvo", year: 2020 } },
  });
  assert.equal(replay.kind, "REPLAY");
  if (replay.kind === "REPLAY") {
    assert.equal(replay.responseStatus, 201);
    assert.deepEqual(replay.responseBody, { accepted: true, resolutionId: "opaque-1" });
  }

  const conflict = await beginIdempotentOperation({
    service,
    operationKey,
    idempotencyKey: key,
    payload: { ...payload, mode: "VIN" },
  });
  assert.equal(conflict.kind, "CONFLICT");

  const persisted = await prisma.integrationIdempotencyRecord.findFirstOrThrow();
  assert.notEqual(persisted.idempotencyKeyHash, key);
  assert.ok(!JSON.stringify(persisted).includes(key));

  const abandonKey = "idem-test-key-abandon";
  const acquiredForAbandon = await beginIdempotentOperation({ service, operationKey, idempotencyKey: abandonKey, payload });
  assert.equal(acquiredForAbandon.kind, "ACQUIRED");
  if (acquiredForAbandon.kind === "ACQUIRED") {
    await abandonIdempotentOperation({ recordId: acquiredForAbandon.recordId, requestFingerprint: acquiredForAbandon.requestFingerprint });
  }
  const reacquired = await beginIdempotentOperation({ service, operationKey, idempotencyKey: abandonKey, payload });
  assert.equal(reacquired.kind, "ACQUIRED");

  const rate1 = await enforceIntegrationRateLimit(service, { bucketKey: "vehicle.resolve", limit: 2, windowSeconds: 60 });
  const rate2 = await enforceIntegrationRateLimit(service, { bucketKey: "vehicle.resolve", limit: 2, windowSeconds: 60 });
  const rate3 = await enforceIntegrationRateLimit(service, { bucketKey: "vehicle.resolve", limit: 2, windowSeconds: 60 });
  assert.equal(rate1.allowed, true);
  assert.equal(rate2.allowed, true);
  assert.equal(rate3.allowed, false);
  assert.equal(rate3.remaining, 0);
  assert.ok(rate3.retryAfterSeconds >= 1 && rate3.retryAfterSeconds <= 60);

  await prisma.integrationIdempotencyRecord.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
  await prisma.integrationRateLimitBucket.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
  const cleaned = await cleanupExpiredIntegrationGuards();
  assert.ok(cleaned.idempotency >= 1);
  assert.ok(cleaned.rateLimits >= 1);

  await prisma.integrationIdempotencyRecord.deleteMany();
  await prisma.integrationRateLimitBucket.deleteMany();
  await prisma.$disconnect();
}

async function main() {
  await authSmoke();
  await guardDbSmoke();
  console.log("integration-api-request-guards-smoke: ok");
}

main().catch((error) => {
  console.error("integration-api-request-guards-smoke: failed", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
