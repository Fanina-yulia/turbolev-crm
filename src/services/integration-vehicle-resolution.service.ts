import { createHmac } from "node:crypto";
import { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { maskPlate, maskVin } from "@/src/lib/vehicle-identity";
import type {
  ApiErrorCode,
  ManualVehicleInput,
  VehicleReferenceDto,
  VehicleResolutionCandidateDto,
  VehicleResolutionDto,
  VehicleResolveInputType,
  VehicleResolveRequest,
} from "@/src/lib/contracts/integration/v1";
import {
  resolveUnifiedVehicleIdentity,
  type PublicVehicleIdentityContext,
} from "@/src/services/vehicle-lookup-unified.service";

const RESOLUTION_POLICY = "vehicle-identity-v1";
const DEFAULT_PENDING_TTL_MS = 15 * 60_000;
const DEFAULT_RESOLVED_TTL_MS = 24 * 60 * 60_000;
const MAX_CANDIDATES = 8;

const resolutionInclude = {
  vehicleReference: true,
  candidates: {
    include: { vehicleReference: true },
    orderBy: { rank: "asc" as const },
  },
} satisfies Prisma.VehicleResolutionInclude;

type ResolutionRecord = Prisma.VehicleResolutionGetPayload<{ include: typeof resolutionInclude }>;
type VehicleReferenceRecord = NonNullable<ResolutionRecord["vehicleReference"]>;
type CanonicalCandidate = { reference: VehicleReferenceRecord; score: number; differences: Record<string, string | number | null> };

type VehicleFacts = {
  make: string;
  model: string;
  year: number | null;
  generation: string | null;
  engineCode: string | null;
  engineName: string | null;
  displacementCm3: number | null;
  fuelType: string | null;
  bodyType: string | null;
  driveType: string | null;
  transmissionType: string | null;
};

export class VehicleResolutionRuntimeError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: ApiErrorCode, status: number, message: string, retryable = false) {
    super(message);
    this.name = "VehicleResolutionRuntimeError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

type RuntimeDependencies = {
  now: () => Date;
  resolveIdentity: typeof resolveUnifiedVehicleIdentity;
  fingerprintSecret: () => string;
};

const defaultDependencies: RuntimeDependencies = {
  now: () => new Date(),
  resolveIdentity: resolveUnifiedVehicleIdentity,
  fingerprintSecret: () => process.env.VEHICLE_RESOLUTION_FINGERPRINT_SECRET?.trim() || "",
};

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(Number.isFinite(value) ? value : null);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return "null";
}

function fingerprintForRequest(request: VehicleResolveRequest, principalHash: string, secret: string) {
  if (secret.length < 32) {
    throw new VehicleResolutionRuntimeError(
      "INTEGRATION_UNAVAILABLE",
      503,
      "Vehicle resolution fingerprinting is not configured.",
      true,
    );
  }
  const identity = request.inputType === "VIN"
    ? { inputType: "VIN", vin: request.vin }
    : request.inputType === "PLATE"
      ? { inputType: "PLATE", countryCode: request.countryCode, plate: request.plate }
      : request.inputType === "MANUAL"
        ? { inputType: "MANUAL", vehicle: request.vehicle }
        : { inputType: "SAVED_VEHICLE", publicVehicleRef: request.publicVehicleRef };
  const digest = createHmac("sha256", secret).update(stableJson({ principalHash, identity })).digest("hex");
  return `hmac-sha256:${digest}`;
}

function safeInput(request: VehicleResolveRequest, principalHash: string) {
  if (request.inputType === "VIN") {
    return { inputType: "VIN", maskedIdentifier: maskVin(request.vin), principalHash };
  }
  if (request.inputType === "PLATE") {
    return { inputType: "PLATE", countryCode: "UA", maskedIdentifier: maskPlate(request.plate), principalHash };
  }
  return { inputType: request.inputType, maskedIdentifier: null, principalHash };
}

function manualFacts(vehicle: ManualVehicleInput): VehicleFacts {
  return {
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    generation: vehicle.generation ?? null,
    engineCode: vehicle.engineCode ?? null,
    engineName: vehicle.engineName ?? null,
    displacementCm3: vehicle.displacementCm3 ?? null,
    fuelType: vehicle.fuelType ?? null,
    bodyType: vehicle.bodyType ?? null,
    driveType: vehicle.driveType ?? null,
    transmissionType: vehicle.transmissionType ?? null,
  };
}

function identityFacts(identity: PublicVehicleIdentityContext): VehicleFacts | null {
  const vehicle = identity.vehicle;
  if (!vehicle?.make || !vehicle.model) return null;
  return {
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    generation: null,
    engineCode: null,
    engineName: vehicle.engine,
    displacementCm3: vehicle.engineVolumeL == null ? null : Math.round(vehicle.engineVolumeL * 1000),
    fuelType: vehicle.fuelType,
    bodyType: vehicle.bodyType,
    driveType: vehicle.driveType,
    transmissionType: vehicle.transmission,
  };
}

function referenceDto(reference: VehicleReferenceRecord, year: number | null = null): VehicleReferenceDto {
  const productionFrom = reference.productionStartYear == null
    ? null
    : `${reference.productionStartYear}-${String(reference.productionStartMonth ?? 1).padStart(2, "0")}`;
  const productionTo = reference.productionEndYear == null
    ? null
    : `${reference.productionEndYear}-${String(reference.productionEndMonth ?? 12).padStart(2, "0")}`;
  return {
    id: reference.id,
    fitmentKey: reference.fitmentKey,
    make: reference.make,
    model: reference.model,
    generation: reference.generation,
    year,
    productionFrom,
    productionTo,
    engineName: reference.engineName,
    engineCode: reference.engineCode,
    displacementCm3: reference.displacementCm3,
    fuelType: reference.fuelType,
    bodyType: reference.bodyType,
    driveType: reference.driveType,
    transmissionType: reference.transmissionType,
  };
}

function candidateDifferences(reference: VehicleReferenceRecord) {
  return {
    generation: reference.generation,
    engineCode: reference.engineCode,
    engineName: reference.engineName,
    displacementCm3: reference.displacementCm3,
    fuelType: reference.fuelType,
    transmissionType: reference.transmissionType,
  };
}

function displayLabel(reference: VehicleReferenceRecord) {
  return [reference.make, reference.model, reference.generation, reference.engineCode || reference.engineName]
    .filter(Boolean)
    .join(" · ");
}

function candidateDto(candidate: ResolutionRecord["candidates"][number]): VehicleResolutionCandidateDto {
  const differences = jsonRecord(candidate.discriminators);
  const safeDifferences: Record<string, string | number | null> = {};
  for (const [key, value] of Object.entries(differences)) {
    if (typeof value === "string" || typeof value === "number" || value === null) safeDifferences[key] = value;
  }
  return {
    candidateId: candidate.id,
    displayLabel: displayLabel(candidate.vehicleReference),
    differences: safeDifferences,
    confidence: candidate.score,
  };
}

function persistedInputType(value: string): VehicleResolveInputType {
  if (value === "VIN" || value === "PLATE" || value === "MANUAL") return value;
  return "SAVED_VEHICLE";
}

function resolutionDto(record: ResolutionRecord): VehicleResolutionDto {
  const input = jsonRecord(record.normalizedInput);
  const facts = jsonRecord(record.normalizedFacts);
  const evidence = jsonRecord(record.evidence);
  const year = typeof facts.year === "number" ? Math.trunc(facts.year) : null;
  return {
    vehicleResolutionId: record.id,
    status: record.expiresAt.getTime() <= Date.now() && record.status !== "EXPIRED" ? "EXPIRED" : record.status,
    resolvedInputType: persistedInputType(record.inputType),
    maskedIdentifier: typeof input.maskedIdentifier === "string" ? input.maskedIdentifier : null,
    vehicleReference: record.vehicleReference ? referenceDto(record.vehicleReference, year) : null,
    confidence: record.confidence,
    missingCriteria: stringArray(record.missingCriteria),
    candidates: record.candidates.map(candidateDto),
    pollAfterMs: typeof evidence.pollAfterMs === "number" ? Math.max(0, Math.trunc(evidence.pollAfterMs)) : null,
    expiresAt: record.expiresAt.toISOString(),
  };
}

function withinProduction(reference: VehicleReferenceRecord, year: number | null) {
  if (year == null) return true;
  if (reference.productionStartYear != null && year < reference.productionStartYear) return false;
  if (reference.productionEndYear != null && year > reference.productionEndYear) return false;
  return true;
}

function scoreCandidate(reference: VehicleReferenceRecord, facts: VehicleFacts): CanonicalCandidate {
  let score = 50;
  if (facts.year != null && withinProduction(reference, facts.year)) score += 20;
  if (facts.generation && reference.generationNormalized && normalizeText(facts.generation) === reference.generationNormalized) score += 10;
  if (facts.engineCode && reference.engineCodeNormalized && normalizeText(facts.engineCode) === reference.engineCodeNormalized) score += 15;
  else if (facts.engineName && reference.engineName) {
    const left = normalizeText(facts.engineName);
    const right = normalizeText(reference.engineName);
    if (left === right || left.includes(right) || right.includes(left)) score += 12;
  }
  if (facts.displacementCm3 != null && reference.displacementCm3 != null) {
    const delta = Math.abs(facts.displacementCm3 - reference.displacementCm3);
    if (delta <= 50) score += 10;
    else if (delta <= 150) score += 5;
  }
  if (facts.fuelType && reference.fuelType && normalizeText(facts.fuelType) === normalizeText(reference.fuelType)) score += 5;
  if (facts.bodyType && reference.bodyType && normalizeText(facts.bodyType) === normalizeText(reference.bodyType)) score += 3;
  if (facts.driveType && reference.driveType && normalizeText(facts.driveType) === normalizeText(reference.driveType)) score += 2;
  return { reference, score: Math.min(100, score), differences: candidateDifferences(reference) };
}

function differingCriteria(candidates: CanonicalCandidate[]) {
  const fields: Array<[string, (reference: VehicleReferenceRecord) => unknown]> = [
    ["GENERATION", (reference) => reference.generationNormalized],
    ["ENGINE_CODE", (reference) => reference.engineCodeNormalized],
    ["DISPLACEMENT_CM3", (reference) => reference.displacementCm3],
    ["FUEL_TYPE", (reference) => reference.fuelType],
    ["TRANSMISSION_TYPE", (reference) => reference.transmissionType],
  ];
  const result = fields.filter(([, getter]) => new Set(candidates.map(({ reference }) => JSON.stringify(getter(reference) ?? null))).size > 1)
    .map(([key]) => key);
  return result.length ? result : ["VEHICLE_MODIFICATION"];
}

function missingForSingle(reference: VehicleReferenceRecord, facts: VehicleFacts) {
  const missing: string[] = [];
  if (reference.generation && !facts.generation) missing.push("GENERATION");
  if (reference.engineCode && !facts.engineCode && !facts.engineName) missing.push("ENGINE_CODE");
  if (reference.displacementCm3 != null && facts.displacementCm3 == null) missing.push("DISPLACEMENT_CM3");
  if (reference.transmissionType && !facts.transmissionType) missing.push("TRANSMISSION_TYPE");
  return missing.length ? missing : ["CANONICAL_CONFIRMATION"];
}

async function canonicalCandidates(facts: VehicleFacts) {
  const prisma = getPrisma();
  const makeNormalized = normalizeText(facts.make);
  const modelNormalized = normalizeText(facts.model);
  const references = await prisma.vehicleReference.findMany({
    where: {
      status: "ACTIVE",
      AND: [
        { OR: [{ makeNormalized }, { make: { equals: facts.make, mode: "insensitive" } }] },
        { OR: [{ modelNormalized }, { model: { equals: facts.model, mode: "insensitive" } }] },
      ],
    },
    orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
    take: MAX_CANDIDATES,
  });
  return references.filter((reference) => withinProduction(reference, facts.year))
    .map((reference) => scoreCandidate(reference, facts))
    .sort((a, b) => b.score - a.score);
}

function chooseResolution(candidates: CanonicalCandidate[], facts: VehicleFacts) {
  if (!candidates.length) {
    return { status: "PENDING" as const, reference: null, confidence: 0, candidates: [], missing: ["CANONICAL_REFERENCE"] };
  }
  const top = candidates[0];
  const second = candidates[1];
  if (top.score >= 85 && (!second || top.score - second.score >= 15)) {
    return { status: "RESOLVED" as const, reference: top.reference, confidence: top.score, candidates: [], missing: [] };
  }
  if (candidates.length > 1) {
    return { status: "AMBIGUOUS" as const, reference: null, confidence: top.score, candidates: candidates.slice(0, 5), missing: differingCriteria(candidates.slice(0, 5)) };
  }
  if (top.score >= 75) {
    return { status: "RESOLVED" as const, reference: top.reference, confidence: top.score, candidates: [], missing: [] };
  }
  return { status: "PENDING" as const, reference: null, confidence: top.score, candidates: [], missing: missingForSingle(top.reference, facts) };
}

async function readRecord(id: string) {
  return getPrisma().vehicleResolution.findUnique({ where: { id }, include: resolutionInclude });
}

function principalMatches(record: ResolutionRecord, principalHash: string) {
  return jsonRecord(record.normalizedInput).principalHash === principalHash;
}

export async function getVehicleResolution(
  resolutionId: string,
  principalHash: string,
  dependencies: Pick<RuntimeDependencies, "now"> = defaultDependencies,
): Promise<VehicleResolutionDto | null> {
  const record = await readRecord(resolutionId);
  if (!record || !principalMatches(record, principalHash)) return null;
  if (record.expiresAt.getTime() <= dependencies.now().getTime() && record.status !== "EXPIRED") {
    const updated = await getPrisma().vehicleResolution.update({
      where: { id: record.id },
      data: { status: "EXPIRED" },
      include: resolutionInclude,
    });
    return resolutionDto(updated);
  }
  return resolutionDto(record);
}

export async function resolveVehicleRequest(
  request: VehicleResolveRequest,
  input: { principalHash: string; correlationId: string },
  dependencies: RuntimeDependencies = defaultDependencies,
): Promise<VehicleResolutionDto> {
  if (!input.principalHash) throw new VehicleResolutionRuntimeError("INTEGRATION_UNAVAILABLE", 503, "Missing service principal context.");
  const now = dependencies.now();
  const fingerprint = fingerprintForRequest(request, input.principalHash, dependencies.fingerprintSecret());
  const existing = await getPrisma().vehicleResolution.findFirst({
    where: { requestFingerprint: fingerprint, expiresAt: { gt: now }, status: { not: "EXPIRED" } },
    orderBy: { createdAt: "desc" },
    include: resolutionInclude,
  });
  if (existing && principalMatches(existing, input.principalHash)) return resolutionDto(existing);

  if (request.inputType === "SAVED_VEHICLE") {
    throw new VehicleResolutionRuntimeError(
      "VEHICLE_REFERENCE_NOT_FOUND",
      404,
      "Saved vehicle reference is not connected to the canonical vehicle catalog yet.",
    );
  }

  let facts: VehicleFacts | null = null;
  let source = request.inputType;
  let identityState: string | null = null;
  let pendingReason: string | null = null;
  let pendingMissing: string[] = [];
  let pollAfterMs: number | null = null;

  if (request.inputType === "MANUAL") {
    facts = manualFacts(request.vehicle);
    source = "MANUAL";
  } else {
    const rawIdentifier = request.inputType === "VIN" ? request.vin : request.plate;
    try {
      const identity = await dependencies.resolveIdentity(rawIdentifier, { deepPlateLookup: false });
      identityState = identity.state;
      source = identity.source || request.inputType;
      facts = identityFacts(identity);
      if (!facts) {
        pendingReason = identity.needsVin ? "VIN_REQUIRED" : "VEHICLE_FACTS_INSUFFICIENT";
        pendingMissing = identity.needsVin ? ["VIN"] : ["VEHICLE_FACTS"];
      }
    } catch {
      pendingReason = "UPSTREAM_VEHICLE_LOOKUP_PENDING";
      pendingMissing = ["UPSTREAM_VEHICLE_LOOKUP"];
      pollAfterMs = 5_000;
    }
  }

  const selected = facts
    ? chooseResolution(await canonicalCandidates(facts), facts)
    : { status: "PENDING" as const, reference: null, confidence: 0, candidates: [] as CanonicalCandidate[], missing: pendingMissing.length ? pendingMissing : ["VEHICLE_FACTS"] };

  const expiresAt = new Date(now.getTime() + (selected.status === "RESOLVED" ? DEFAULT_RESOLVED_TTL_MS : DEFAULT_PENDING_TTL_MS));
  const safeNormalizedInput = safeInput(request, input.principalHash);
  const safeFacts = facts ? { ...facts } : null;
  const record = await getPrisma().vehicleResolution.create({
    data: {
      status: selected.status,
      inputType: request.inputType === "SAVED_VEHICLE" ? "CRM_VEHICLE" : request.inputType,
      vehicleReferenceId: selected.reference?.id ?? null,
      confidence: selected.confidence,
      source: source.slice(0, 64),
      requestFingerprint: fingerprint,
      normalizedInput: toPrismaJson(safeNormalizedInput),
      normalizedFacts: safeFacts ? toPrismaJson(safeFacts) : undefined,
      missingCriteria: toPrismaJson(selected.missing),
      evidence: toPrismaJson({
        identityState,
        pendingReason,
        candidateCount: selected.candidates.length,
        pollAfterMs,
      }),
      resolutionPolicy: RESOLUTION_POLICY,
      correlationId: input.correlationId.slice(0, 80),
      resolvedAt: selected.status === "RESOLVED" ? now : null,
      expiresAt,
      candidates: selected.candidates.length
        ? {
            create: selected.candidates.map((candidate, index) => ({
              vehicleReferenceId: candidate.reference.id,
              rank: index + 1,
              score: candidate.score,
              discriminators: toPrismaJson(candidate.differences),
              evidence: toPrismaJson({ policy: RESOLUTION_POLICY }),
              selected: false,
            })),
          }
        : undefined,
    },
    include: resolutionInclude,
  });
  return resolutionDto(record);
}
