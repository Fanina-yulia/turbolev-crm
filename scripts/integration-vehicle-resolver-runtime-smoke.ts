import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { getPrisma } from "@/src/lib/prisma";
import { servicePrincipalHash, testOnlyResetOidcCache } from "@/src/security/service-access-context";
import { resolveVehicleRequest } from "@/src/services/integration-vehicle-resolution.service";

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
    publicJwk: { ...publicJwk, kid: "runtime-test-key", alg: "RS256", use: "sig" },
    async token(claims: Record<string, unknown>) {
      const header = b64({ typ: "JWT", alg: "RS256", kid: "runtime-test-key" });
      const payload = b64(claims);
      const signingInput = `${header}.${payload}`;
      const signature = await webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, encoder.encode(signingInput));
      return `${signingInput}.${Buffer.from(signature).toString("base64url")}`;
    },
  };
}

const prisma = getPrisma();
const issuer = "https://oidc.example.test/turbo-lev-runtime";
const audience = "https://vercel.com/turbo-lev-runtime";
const primarySubject = "owner:turbo-lev:project:turbolev-web:environment:production";
const secondSubject = "owner:turbo-lev:project:turbolev-web-secondary:environment:production";
const fingerprintSecret = "runtime-smoke-secret-vehicle-resolution-2026";

process.env.VERCEL_OIDC_ISSUER = issuer;
process.env.VERCEL_OIDC_AUDIENCE = audience;
process.env.INTEGRATION_TARGET_ENVIRONMENT = "production";
process.env.VERCEL_ENV = "production";
process.env.VEHICLE_RESOLUTION_FINGERPRINT_SECRET = fingerprintSecret;
process.env.INTEGRATION_SERVICE_POLICIES_JSON = JSON.stringify([
  {
    subject: primarySubject,
    environment: "production",
    scopes: ["vehicle:resolve", "vehicle:read"],
    owner: "turbo-lev",
    project: "turbolev-web",
  },
  {
    subject: secondSubject,
    environment: "production",
    scopes: ["vehicle:resolve", "vehicle:read"],
    owner: "turbo-lev",
    project: "turbolev-web-secondary",
  },
]);

testOnlyResetOidcCache();
const signer = await createSigner();
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url === `${issuer}/.well-known/openid-configuration`) {
    return new Response(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url === `${issuer}/jwks`) {
    return new Response(JSON.stringify({ keys: [signer.publicJwk] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  throw new Error(`Unexpected fetch in runtime smoke: ${url}`);
}) as typeof fetch;

const nowSeconds = Math.floor(Date.now() / 1000);
function claims(subject: string, project: string) {
  return {
    iss: issuer,
    aud: audience,
    sub: subject,
    owner: "turbo-lev",
    project,
    environment: "production",
    iat: nowSeconds - 5,
    nbf: nowSeconds - 5,
    exp: nowSeconds + 600,
    jti: `${project}-runtime-smoke-token`,
  };
}

const primaryToken = await signer.token(claims(primarySubject, "turbolev-web"));
const secondToken = await signer.token(claims(secondSubject, "turbolev-web-secondary"));

const { POST, GET } = await import("@/app/api/integration/v1/vehicle/resolve/route");

function authHeaders(token: string, idempotencyKey?: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-Correlation-Id": "runtime-smoke-correlation",
    ...(idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {}),
  };
}

function publicIdentity(inputType: "VIN" | "PLATE") {
  return {
    state: "PARTIAL" as const,
    inputType,
    maskedIdentifier: inputType === "VIN" ? "WVW••••••••••0001" : "KA••••CI",
    confidence: 98,
    source: "RUNTIME_SMOKE",
    vehicle: {
      make: "Volkswagen",
      model: "Passat",
      year: 2018,
      engine: "2.0 TDI DFGA",
      engineVolumeL: 1.968,
      fuelType: "DIESEL",
      bodyType: "SEDAN",
      driveType: "FWD",
      transmission: "AUTOMATIC",
    },
    vinAvailable: true,
    canonicalReferenceReady: false as const,
    exactFitmentReady: false as const,
    needsVin: false,
    message: "runtime smoke",
  };
}

try {
  await prisma.integrationIdempotencyRecord.deleteMany();
  await prisma.integrationRateLimitBucket.deleteMany();
  await prisma.vehicleResolution.deleteMany();
  await prisma.vehicleReferenceExternalId.deleteMany({ where: { provider: "RUNTIME_SMOKE" } });
  await prisma.vehicleReference.deleteMany({ where: { fitmentKey: { startsWith: "runtime-smoke-" } } });

  await prisma.vehicleReference.create({
    data: {
      id: "runtime_smoke_reference",
      fitmentKey: "runtime-smoke-vw-passat-b8-dfga",
      status: "ACTIVE",
      make: "Volkswagen",
      makeNormalized: "VOLKSWAGEN",
      model: "Passat",
      modelNormalized: "PASSAT",
      generation: "B8",
      generationNormalized: "B8",
      productionStartYear: 2015,
      productionEndYear: 2020,
      engineName: "2.0 TDI DFGA",
      engineCode: "DFGA",
      engineCodeNormalized: "DFGA",
      displacementCm3: 1968,
      fuelType: "DIESEL",
      bodyType: "SEDAN",
      driveType: "FWD",
      transmissionType: "AUTOMATIC",
      confidence: 99,
    },
  });

  const unauthenticated = await POST(new Request("https://crm.example.test/api/integration/v1/vehicle/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inputType: "MANUAL", vehicle: { make: "Volkswagen", model: "Passat", year: 2018 } }),
  }));
  assert.equal(unauthenticated.status, 401);
  assert.equal((await unauthenticated.json()).error.code, "SERVICE_AUTH_MISSING");

  const manualBody = {
    inputType: "MANUAL",
    vehicle: {
      make: "Volkswagen",
      model: "Passat",
      year: 2018,
      generation: "B8",
      engineCode: "DFGA",
      displacementCm3: 1968,
      fuelType: "DIESEL",
      bodyType: "SEDAN",
      driveType: "FWD",
      transmissionType: "AUTOMATIC",
    },
  };
  const postRequest = () => new Request("https://crm.example.test/api/integration/v1/vehicle/resolve", {
    method: "POST",
    headers: authHeaders(primaryToken, "runtime-smoke-idempotency-0001"),
    body: JSON.stringify(manualBody),
  });

  const created = await POST(postRequest());
  assert.equal(created.status, 200);
  const createdBody = await created.json();
  assert.equal(createdBody.ok, true);
  assert.equal(createdBody.data.status, "RESOLVED");
  assert.equal(createdBody.data.vehicleReference.fitmentKey, "runtime-smoke-vw-passat-b8-dfga");
  const resolutionId = createdBody.data.vehicleResolutionId as string;
  assert.ok(resolutionId);

  const replay = await POST(postRequest());
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("x-idempotency-replayed"), "true");
  const replayBody = await replay.json();
  assert.equal(replayBody.data.vehicleResolutionId, resolutionId);
  assert.equal(await prisma.vehicleResolution.count(), 1, "idempotent replay must not create another resolution");

  const poll = await GET(new Request(`https://crm.example.test/api/integration/v1/vehicle/resolve?resolutionId=${encodeURIComponent(resolutionId)}`, {
    headers: authHeaders(primaryToken),
  }));
  assert.equal(poll.status, 200);
  assert.equal((await poll.json()).data.vehicleResolutionId, resolutionId);

  const isolatedPoll = await GET(new Request(`https://crm.example.test/api/integration/v1/vehicle/resolve?resolutionId=${encodeURIComponent(resolutionId)}`, {
    headers: authHeaders(secondToken),
  }));
  assert.equal(isolatedPoll.status, 404, "another service principal must not read the first principal resolution");

  const primaryPrincipalHash = servicePrincipalHash({ subject: primarySubject, environment: "production" });
  const vin = "WVWZZZ1JZXW000001";
  const vinResult = await resolveVehicleRequest(
    { inputType: "VIN", vin },
    { principalHash: primaryPrincipalHash, correlationId: "runtime-smoke-vin" },
    {
      now: () => new Date(),
      fingerprintSecret: () => fingerprintSecret,
      resolveIdentity: (async () => publicIdentity("VIN")) as any,
    },
  );
  const vinRow = await prisma.vehicleResolution.findUniqueOrThrow({ where: { id: vinResult.vehicleResolutionId } });
  assert.ok(!JSON.stringify(vinRow).includes(vin), "raw VIN must never be persisted in VehicleResolution");
  assert.ok(vinRow.requestFingerprint.startsWith("hmac-sha256:"));

  const plate = "KA7584CI";
  const plateResult = await resolveVehicleRequest(
    { inputType: "PLATE", plate, countryCode: "UA" },
    { principalHash: primaryPrincipalHash, correlationId: "runtime-smoke-plate" },
    {
      now: () => new Date(),
      fingerprintSecret: () => fingerprintSecret,
      resolveIdentity: (async () => publicIdentity("PLATE")) as any,
    },
  );
  const plateRow = await prisma.vehicleResolution.findUniqueOrThrow({ where: { id: plateResult.vehicleResolutionId } });
  assert.ok(!JSON.stringify(plateRow).includes(plate), "raw plate must never be persisted in VehicleResolution");
  assert.ok(plateRow.requestFingerprint.startsWith("hmac-sha256:"));

  const resolutionColumns = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'VehicleResolution'
  `;
  const names = new Set(resolutionColumns.map((row) => row.column_name.toLowerCase()));
  assert.equal(names.has("vin"), false);
  assert.equal(names.has("plate"), false);
  assert.equal(names.has("platenumber"), false);

  console.log("integration-vehicle-resolver-runtime-smoke: ok");
} finally {
  globalThis.fetch = originalFetch;
  await prisma.integrationIdempotencyRecord.deleteMany();
  await prisma.integrationRateLimitBucket.deleteMany();
  await prisma.vehicleResolution.deleteMany();
  await prisma.vehicleReferenceExternalId.deleteMany({ where: { provider: "RUNTIME_SMOKE" } });
  await prisma.vehicleReference.deleteMany({ where: { fitmentKey: { startsWith: "runtime-smoke-" } } });
  await prisma.$disconnect();
}
