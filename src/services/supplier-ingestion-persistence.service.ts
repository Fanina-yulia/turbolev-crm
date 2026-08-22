import type { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import type {
  IdentityEvidenceCandidate,
  NormalizedSupplierRecord,
  SupplierFreshnessPolicyContract,
  SupplierImportMode,
  SupplierMappingMethod,
} from "@/src/services/supplier-ingestion-contracts";
import {
  buildOfferKey,
  classifyFreshness,
  decideIdentityMatch,
  decideIncomingOrder,
  deriveAvailability,
  detectPriceAnomaly,
  evaluateSnapshotPublishGate,
  normalizeSupplierRecord,
  semanticFingerprint,
  validateNormalizedRecord,
} from "@/src/services/supplier-ingestion-policy";

const WRITE_ENV_VALUE = "PERSIST_SUPPLIER_INGESTION_V1";
const WRITE_CONFIRMATION = "ALLOW_SUPPLIER_INGESTION_PERSISTENCE";
const DEFAULT_MAX_RECORDS = 5_000;
const DEFAULT_MAX_PRICE_CHANGE_RATIO = 0.5;

type Tx = Prisma.TransactionClient;
type SupplierIngestionEnv = Record<string, string | undefined>;

export class SupplierIngestionWriteDisabledError extends Error {
  constructor() {
    super("Supplier ingestion persistence is disabled. Both server activation and explicit caller confirmation are required.");
    this.name = "SupplierIngestionWriteDisabledError";
  }
}

export class SupplierIngestionInputError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SupplierIngestionInputError";
    this.code = code;
  }
}

export interface SupplierIngestionWriteActivation {
  confirmation: string;
}

export interface SupplierIngestionRecordInput {
  rawChecksum: string;
  normalized: NormalizedSupplierRecord;
  identityCandidates?: IdentityEvidenceCandidate[];
}

export interface PersistSupplierIngestionBatchInput {
  supplierId: string;
  integrationScope: string;
  mode: SupplierImportMode;
  adapterVersion: string;
  schemaVersion: string;
  sourceVersion?: string | null;
  sourceChecksum?: string | null;
  cursorBefore?: string | null;
  cursorAfter?: string | null;
  providerStartedAt?: Date | null;
  providerFinishedAt?: Date | null;
  providerDeclaredComplete?: boolean;
  records: SupplierIngestionRecordInput[];
  minimumFullSnapshotRows?: number;
  maxRejectedRatio?: number;
  maxIdentityProblemRatio?: number;
  maxFullSnapshotDropRatio?: number;
  maxPriceChangeRatio?: number;
  maxRecords?: number;
  metadata?: Record<string, unknown>;
}

export interface PersistSupplierIngestionBatchResult {
  batchId: string;
  idempotent: boolean;
  published: boolean;
  publishBlocked: boolean;
  missingOffersDeactivated: number;
  counters: BatchCounters;
  reasons: string[];
}

interface BatchCounters {
  received: number;
  valid: number;
  matched: number;
  ambiguous: number;
  unmatched: number;
  conflict: number;
  rejected: number;
}

interface PreparedRecord {
  input: SupplierIngestionRecordInput;
  normalized: NormalizedSupplierRecord;
  semanticHash: string;
  validationErrors: string[];
}

interface OfferPlan {
  recordId: string;
  productId: string;
  mappingMethod: SupplierMappingMethod;
  mappingConfidence: number | null;
  normalized: NormalizedSupplierRecord;
  semanticHash: string;
  offerKey: string;
}

function requireNonEmpty(value: string, code: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new SupplierIngestionInputError(code, `${label} is required.`);
  return normalized;
}

export function supplierIngestionWritesEnabled(env: SupplierIngestionEnv = process.env): boolean {
  return env.SUPPLIER_INGESTION_WRITES_ENABLED === WRITE_ENV_VALUE;
}

export function assertSupplierIngestionWritesEnabled(
  activation: SupplierIngestionWriteActivation,
  env: SupplierIngestionEnv = process.env,
): void {
  if (!supplierIngestionWritesEnabled(env) || activation.confirmation !== WRITE_CONFIRMATION) {
    throw new SupplierIngestionWriteDisabledError();
  }
}

function prepareInput(input: PersistSupplierIngestionBatchInput) {
  const supplierId = requireNonEmpty(input.supplierId, "MISSING_SUPPLIER_ID", "supplierId");
  const integrationScope = requireNonEmpty(input.integrationScope, "MISSING_INTEGRATION_SCOPE", "integrationScope");
  const adapterVersion = requireNonEmpty(input.adapterVersion, "MISSING_ADAPTER_VERSION", "adapterVersion");
  const schemaVersion = requireNonEmpty(input.schemaVersion, "MISSING_SCHEMA_VERSION", "schemaVersion");
  const maxRecords = input.maxRecords ?? DEFAULT_MAX_RECORDS;

  if (!Number.isInteger(maxRecords) || maxRecords <= 0 || maxRecords > 50_000) {
    throw new SupplierIngestionInputError("INVALID_MAX_RECORDS", "maxRecords must be an integer between 1 and 50000.");
  }
  if (input.records.length > maxRecords) {
    throw new SupplierIngestionInputError(
      "BATCH_RECORD_LIMIT_EXCEEDED",
      `Batch contains ${input.records.length} records; configured maximum is ${maxRecords}.`,
    );
  }

  const seenKeys = new Set<string>();
  const preparedRecords: PreparedRecord[] = input.records.map((record) => {
    const normalized = normalizeSupplierRecord(record.normalized);
    if (!normalized.supplierRecordKey) {
      throw new SupplierIngestionInputError("MISSING_SUPPLIER_RECORD_KEY", "Every supplier row must have a stable record key.");
    }
    if (seenKeys.has(normalized.supplierRecordKey)) {
      throw new SupplierIngestionInputError(
        "DUPLICATE_SUPPLIER_RECORD_KEY_IN_BATCH",
        `Duplicate supplier record key: ${normalized.supplierRecordKey}`,
      );
    }
    seenKeys.add(normalized.supplierRecordKey);

    const validationErrors = validateNormalizedRecord(normalized);
    if (!record.rawChecksum.trim()) validationErrors.push("MISSING_RAW_CHECKSUM");
    if (normalized.purchasePrice == null) validationErrors.push("MISSING_PURCHASE_PRICE");
    if (!normalized.currency) validationErrors.push("MISSING_CURRENCY");

    const semanticHash = semanticFingerprint({
      externalProductId: normalized.externalProductId,
      supplierArticleNorm: normalized.supplierArticleNorm,
      brandNormalized: normalized.brandNormalized,
      mpnCandidateNorm: normalized.mpnCandidateNorm,
      gtinCandidate: normalized.gtinCandidate,
      currency: normalized.currency,
      purchasePrice: normalized.purchasePrice,
      quantityMode: normalized.quantityMode,
      exactQty: normalized.exactQty,
      availabilityBand: normalized.availabilityBand,
      supplierAvailabilityRaw: normalized.supplierAvailabilityRaw,
      warehouseKey: normalized.warehouseKey,
      minOrderQty: normalized.minOrderQty,
      multiplicity: normalized.multiplicity,
      leadTimeMinHours: normalized.leadTimeMinHours,
      leadTimeMaxHours: normalized.leadTimeMaxHours,
      etaFrom: normalized.etaFrom,
      etaTo: normalized.etaTo,
      sourceUpdatedAt: normalized.sourceUpdatedAt,
      sourceTimeTrusted: normalized.sourceTimeTrusted,
    });

    return { input: record, normalized, semanticHash, validationErrors };
  });

  const batchFingerprint = semanticFingerprint({
    supplierId,
    integrationScope,
    mode: input.mode,
    adapterVersion,
    schemaVersion,
    sourceVersion: input.sourceVersion ?? null,
    sourceChecksum: input.sourceChecksum ?? null,
    cursorBefore: input.cursorBefore ?? null,
    cursorAfter: input.cursorAfter ?? null,
    providerDeclaredComplete: input.providerDeclaredComplete === true,
    minimumFullSnapshotRows: input.minimumFullSnapshotRows ?? null,
    maxRejectedRatio: input.maxRejectedRatio ?? null,
    maxIdentityProblemRatio: input.maxIdentityProblemRatio ?? null,
    maxFullSnapshotDropRatio: input.maxFullSnapshotDropRatio ?? null,
    maxPriceChangeRatio: input.maxPriceChangeRatio ?? DEFAULT_MAX_PRICE_CHANGE_RATIO,
    records: preparedRecords
      .map((record) => ({ key: record.normalized.supplierRecordKey, rawChecksum: record.input.rawChecksum.trim() }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  });

  return { supplierId, integrationScope, adapterVersion, schemaVersion, preparedRecords, batchFingerprint };
}

function freshnessPolicyContract(row: {
  freshTtlSeconds: number;
  staleAllowedSeconds: number;
  hardExpirySeconds: number;
  checkoutRevalidate: boolean;
  staleDisplayAllowed: boolean;
  providerErrorFallback: boolean;
}): SupplierFreshnessPolicyContract {
  return { ...row };
}

function readMetadataString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate ? candidate : null;
}

function reconciliationReasonForIdentity(state: "AMBIGUOUS" | "UNMATCHED" | "CONFLICT" | "MATCHED") {
  if (state === "AMBIGUOUS") return "AMBIGUOUS" as const;
  if (state === "UNMATCHED") return "UNMATCHED" as const;
  if (state === "MATCHED") return "SCHEMA_ERROR" as const;
  return "IDENTITY_CONFLICT" as const;
}

async function createReconciliation(
  tx: Tx,
  input: {
    supplierId: string;
    batchId: string;
    importRecordId: string;
    reason:
      | "UNMATCHED"
      | "AMBIGUOUS"
      | "IDENTITY_CONFLICT"
      | "INVALID_IDENTIFIER"
      | "BRAND_CONFLICT"
      | "PRICE_ANOMALY"
      | "STOCK_ANOMALY"
      | "SCHEMA_ERROR";
    evidence: unknown;
    candidateProductIds?: string[];
  },
) {
  const task = await tx.supplierReconciliationTask.create({
    data: {
      supplierId: input.supplierId,
      batchId: input.batchId,
      importRecordId: input.importRecordId,
      reason: input.reason,
      evidence: toPrismaJson(input.evidence),
    },
  });
  const candidateIds = [...new Set(input.candidateProductIds ?? [])];
  if (candidateIds.length > 0) {
    await tx.supplierReconciliationCandidate.createMany({
      data: candidateIds.map((productId, index) => ({
        taskId: task.id,
        productId,
        rank: index + 1,
        score: Math.max(1, 100 - index * 5),
        reasonCodes: toPrismaJson([input.reason]),
      })),
      skipDuplicates: true,
    });
  }
}

async function approvedMappingCandidate(
  tx: Tx,
  supplierId: string,
  integrationScope: string,
  supplierRecordKey: string,
): Promise<IdentityEvidenceCandidate | null> {
  const mapping = await tx.supplierIdentityMapping.findFirst({
    where: { supplierId, integrationScope, supplierRecordKey, isApproved: true, isActive: true },
    select: { productId: true },
  });
  return mapping ? { productId: mapping.productId, approvedMapping: true } : null;
}

async function upsertObservedMapping(
  tx: Tx,
  input: {
    supplierId: string;
    integrationScope: string;
    supplierRecordKey: string;
    productId: string;
    method: SupplierMappingMethod;
    confidence: number | null;
    evidence: unknown;
    sourceVersion?: string | null;
  },
) {
  const approved = input.method === "APPROVED_MAPPING" || input.method === "MANUAL";
  await tx.supplierIdentityMapping.upsert({
    where: {
      supplierId_integrationScope_supplierRecordKey: {
        supplierId: input.supplierId,
        integrationScope: input.integrationScope,
        supplierRecordKey: input.supplierRecordKey,
      },
    },
    create: {
      supplierId: input.supplierId,
      integrationScope: input.integrationScope,
      supplierRecordKey: input.supplierRecordKey,
      productId: input.productId,
      method: input.method,
      confidence: input.confidence,
      evidence: toPrismaJson(input.evidence),
      sourceVersion: input.sourceVersion ?? null,
      isApproved: approved,
      isActive: true,
    },
    update: {
      productId: input.productId,
      method: input.method,
      confidence: input.confidence,
      evidence: toPrismaJson(input.evidence),
      sourceVersion: input.sourceVersion ?? null,
      isActive: true,
      disabledAt: null,
      disabledReason: null,
      ...(approved ? { isApproved: true } : {}),
    },
  });
}

function commonRecordData(batchId: string, record: PreparedRecord) {
  const n = record.normalized;
  return {
    batchId,
    supplierRecordKey: n.supplierRecordKey,
    rawChecksum: record.input.rawChecksum.trim() || "missing",
    rawPayload: toPrismaJson(n.rawPayload),
    normalizedPayload: toPrismaJson(n),
    externalProductId: n.externalProductId ?? null,
    supplierArticleRaw: n.supplierArticleRaw ?? null,
    supplierArticleNorm: n.supplierArticleNorm ?? null,
    brandRaw: n.brandRaw ?? null,
    brandNormalized: n.brandNormalized ?? null,
    mpnCandidateRaw: n.mpnCandidateRaw ?? null,
    mpnCandidateNorm: n.mpnCandidateNorm ?? null,
    gtinCandidate: n.gtinCandidate ?? null,
    currency: n.currency ?? null,
    purchasePrice: n.purchasePrice ?? null,
    quantityMode: n.quantityMode,
    exactQty: n.exactQty ?? null,
    availabilityBand: n.availabilityBand ?? null,
    supplierAvailabilityRaw: n.supplierAvailabilityRaw ?? null,
    warehouseKey: n.warehouseKey ?? null,
    minOrderQty: n.minOrderQty ?? null,
    multiplicity: n.multiplicity ?? null,
    leadTimeMinHours: n.leadTimeMinHours ?? null,
    leadTimeMaxHours: n.leadTimeMaxHours ?? null,
    etaFrom: n.etaFrom ?? null,
    etaTo: n.etaTo ?? null,
    sourceUpdatedAt: n.sourceUpdatedAt ?? null,
    sourceTimeTrusted: n.sourceTimeTrusted,
  };
}

async function blockBatch(
  tx: Tx,
  batchId: string,
  now: Date,
  counters: BatchCounters,
  reasons: string[],
  anomalySummary: unknown,
): Promise<PersistSupplierIngestionBatchResult> {
  await tx.supplierImportBatch.update({
    where: { id: batchId },
    data: {
      status: "READY_TO_PUBLISH",
      publishStatus: "BLOCKED",
      finishedAt: now,
      validatedAt: now,
      recordsReceived: counters.received,
      recordsValid: counters.valid,
      recordsMatched: counters.matched,
      recordsAmbiguous: counters.ambiguous,
      recordsUnmatched: counters.unmatched,
      recordsConflict: counters.conflict,
      recordsRejected: counters.rejected,
      errorCode: reasons[0] ?? "PUBLISH_GATE_BLOCKED",
      errorSummary: reasons.join(", "),
      anomalySummary: toPrismaJson(anomalySummary),
    },
  });
  return {
    batchId,
    idempotent: false,
    published: false,
    publishBlocked: true,
    missingOffersDeactivated: 0,
    counters,
    reasons,
  };
}

export async function persistSupplierIngestionBatch(
  input: PersistSupplierIngestionBatchInput,
  activation: SupplierIngestionWriteActivation,
): Promise<PersistSupplierIngestionBatchResult> {
  // Fail before opening a connection. There is intentionally no API/cron caller in this PR.
  assertSupplierIngestionWritesEnabled(activation);
  const prepared = prepareInput(input);
  const prisma = getPrisma();
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`supplier-ingestion:${prepared.supplierId}:${prepared.integrationScope}`}))`;

    const supplier = await tx.supplier.findUnique({
      where: { id: prepared.supplierId },
      select: { id: true, isActive: true },
    });
    if (!supplier?.isActive) {
      throw new SupplierIngestionInputError("SUPPLIER_NOT_ACTIVE", "Supplier does not exist or is disabled.");
    }

    const policyRow = await tx.supplierFreshnessPolicy.findFirst({
      where: {
        supplierId: prepared.supplierId,
        integrationScope: prepared.integrationScope,
        offerClass: "DEFAULT",
        isActive: true,
      },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });
    if (!policyRow) {
      throw new SupplierIngestionInputError(
        "MISSING_FRESHNESS_POLICY",
        "A DEFAULT active freshness policy is required before supplier offers can be persisted.",
      );
    }
    const freshnessPolicy = freshnessPolicyContract(policyRow);

    const existingBatch = await tx.supplierImportBatch.findUnique({
      where: {
        supplierId_integrationScope_semanticFingerprint: {
          supplierId: prepared.supplierId,
          integrationScope: prepared.integrationScope,
          semanticFingerprint: prepared.batchFingerprint,
        },
      },
    });
    if (existingBatch) {
      return {
        batchId: existingBatch.id,
        idempotent: true,
        published: existingBatch.publishStatus === "PUBLISHED",
        publishBlocked: existingBatch.publishStatus === "BLOCKED",
        missingOffersDeactivated: 0,
        counters: {
          received: existingBatch.recordsReceived,
          valid: existingBatch.recordsValid,
          matched: existingBatch.recordsMatched,
          ambiguous: existingBatch.recordsAmbiguous,
          unmatched: existingBatch.recordsUnmatched,
          conflict: existingBatch.recordsConflict,
          rejected: existingBatch.recordsRejected,
        },
        reasons: existingBatch.errorCode ? [existingBatch.errorCode] : [],
      };
    }

    const previousPublishedCount = await tx.supplierOffer.count({
      where: { supplierId: prepared.supplierId, integrationScope: prepared.integrationScope, status: "ACTIVE" },
    });

    const batch = await tx.supplierImportBatch.create({
      data: {
        supplierId: prepared.supplierId,
        integrationScope: prepared.integrationScope,
        mode: input.mode,
        status: "RUNNING",
        publishStatus: "NOT_READY",
        sourceVersion: input.sourceVersion ?? null,
        cursorBefore: input.cursorBefore ?? null,
        cursorAfter: input.cursorAfter ?? null,
        sourceChecksum: input.sourceChecksum ?? null,
        adapterVersion: prepared.adapterVersion,
        schemaVersion: prepared.schemaVersion,
        providerStartedAt: input.providerStartedAt ?? null,
        providerFinishedAt: input.providerFinishedAt ?? null,
        startedAt: now,
        semanticFingerprint: prepared.batchFingerprint,
        metadata: toPrismaJson({
          ...(input.metadata ?? {}),
          providerDeclaredComplete: input.providerDeclaredComplete === true,
        }),
      },
    });

    const suppliedCandidateIds = [
      ...new Set(
        prepared.preparedRecords.flatMap((record) =>
          (record.input.identityCandidates ?? []).map((candidate) => candidate.productId),
        ),
      ),
    ];
    const existingCandidateIds = suppliedCandidateIds.length
      ? new Set(
          (
            await tx.product.findMany({ where: { id: { in: suppliedCandidateIds } }, select: { id: true } })
          ).map((product) => product.id),
        )
      : new Set<string>();

    const counters: BatchCounters = {
      received: prepared.preparedRecords.length,
      valid: 0,
      matched: 0,
      ambiguous: 0,
      unmatched: 0,
      conflict: 0,
      rejected: 0,
    };
    const offerPlans: OfferPlan[] = [];

    // Phase 1: staging + identity reconciliation. No SupplierOffer is mutated here.
    for (const record of prepared.preparedRecords) {
      const unknownCandidateIds = (record.input.identityCandidates ?? [])
        .map((candidate) => candidate.productId)
        .filter((productId) => !existingCandidateIds.has(productId));
      const validationErrors = [...record.validationErrors];
      if (unknownCandidateIds.length > 0) validationErrors.push("UNKNOWN_CANDIDATE_PRODUCT");

      if (validationErrors.length > 0) {
        counters.rejected += 1;
        const staged = await tx.supplierImportRecord.create({
          data: {
            ...commonRecordData(batch.id, record),
            state: "REJECTED",
            errorCodes: toPrismaJson(validationErrors),
          },
        });
        await createReconciliation(tx, {
          supplierId: prepared.supplierId,
          batchId: batch.id,
          importRecordId: staged.id,
          reason: "SCHEMA_ERROR",
          evidence: { validationErrors, unknownCandidateIds },
          candidateProductIds: (record.input.identityCandidates ?? [])
            .map((candidate) => candidate.productId)
            .filter((productId) => existingCandidateIds.has(productId)),
        });
        continue;
      }

      counters.valid += 1;
      const stable = await approvedMappingCandidate(
        tx,
        prepared.supplierId,
        prepared.integrationScope,
        record.normalized.supplierRecordKey,
      );
      const candidates = [
        ...(stable ? [stable] : []),
        ...(record.input.identityCandidates ?? []).filter((candidate) => existingCandidateIds.has(candidate.productId)),
      ];
      const identity = decideIdentityMatch(candidates);

      const staged = await tx.supplierImportRecord.create({
        data: {
          ...commonRecordData(batch.id, record),
          state: identity.state,
          matchedProductId: identity.productId ?? null,
          mappingMethod: identity.method ?? null,
          matchConfidence: identity.confidence ?? null,
          identityEvidence: toPrismaJson({ reason: identity.reason, candidates: identity.candidates }),
        },
      });

      if (identity.state !== "MATCHED" || !identity.productId || !identity.method) {
        if (identity.state === "AMBIGUOUS") counters.ambiguous += 1;
        if (identity.state === "UNMATCHED") counters.unmatched += 1;
        if (identity.state === "CONFLICT") counters.conflict += 1;
        await createReconciliation(tx, {
          supplierId: prepared.supplierId,
          batchId: batch.id,
          importRecordId: staged.id,
          reason: reconciliationReasonForIdentity(identity.state),
          evidence: { identity, candidates },
          candidateProductIds: identity.candidates,
        });
        continue;
      }

      counters.matched += 1;
      await upsertObservedMapping(tx, {
        supplierId: prepared.supplierId,
        integrationScope: prepared.integrationScope,
        supplierRecordKey: record.normalized.supplierRecordKey,
        productId: identity.productId,
        method: identity.method,
        confidence: identity.confidence ?? null,
        evidence: { identity, candidates },
        sourceVersion: input.sourceVersion ?? null,
      });
      offerPlans.push({
        recordId: staged.id,
        productId: identity.productId,
        mappingMethod: identity.method,
        mappingConfidence: identity.confidence ?? null,
        normalized: record.normalized,
        semanticHash: record.semanticHash,
        offerKey: buildOfferKey({
          supplierRecordKey: record.normalized.supplierRecordKey,
          externalProductId: record.normalized.externalProductId,
          supplierArticle: record.normalized.supplierArticleNorm ?? record.normalized.supplierArticleRaw,
          warehouseKey: record.normalized.warehouseKey,
        }),
      });
    }

    const publishGate = evaluateSnapshotPublishGate({
      mode: input.mode,
      recordsReceived: counters.received,
      recordsValid: counters.valid,
      recordsMatched: counters.matched,
      recordsAmbiguous: counters.ambiguous,
      recordsUnmatched: counters.unmatched,
      recordsConflict: counters.conflict,
      recordsRejected: counters.rejected,
      previousPublishedCount,
      minimumFullSnapshotRows: input.minimumFullSnapshotRows,
      maxRejectedRatio: input.maxRejectedRatio,
      maxIdentityProblemRatio: input.maxIdentityProblemRatio,
      maxFullSnapshotDropRatio: input.maxFullSnapshotDropRatio,
      providerDeclaredComplete: input.providerDeclaredComplete,
    });
    if (!publishGate.allowPublish) {
      return blockBatch(tx, batch.id, now, counters, publishGate.reasons, publishGate.metrics);
    }

    // Phase 2: commercial preflight. Build deferred actions; execute none until every row passes.
    const deferredOfferWrites: Array<() => Promise<void>> = [];
    let commercialConflicts = 0;

    for (const plan of offerPlans) {
      const existing = await tx.supplierOffer.findUnique({
        where: {
          supplierId_integrationScope_offerKey: {
            supplierId: prepared.supplierId,
            integrationScope: prepared.integrationScope,
            offerKey: plan.offerKey,
          },
        },
      });
      const incomingOrder = decideIncomingOrder({
        currentSourceUpdatedAt: existing?.sourceUpdatedAt ?? null,
        incomingSourceUpdatedAt: plan.normalized.sourceUpdatedAt ?? null,
        currentSourceTimeTrusted: existing?.sourceTimeTrusted ?? false,
        incomingSourceTimeTrusted: plan.normalized.sourceTimeTrusted,
        currentSourceVersion: existing?.sourceVersion ?? null,
        incomingSourceVersion: input.sourceVersion ?? null,
        currentSemanticHash: readMetadataString(existing?.metadata, "semanticHash"),
        incomingSemanticHash: plan.semanticHash,
      });

      if (!incomingOrder.apply && !incomingOrder.idempotent) {
        commercialConflicts += 1;
        await tx.supplierImportRecord.update({
          where: { id: plan.recordId },
          data: { state: "CONFLICT", errorCodes: toPrismaJson([incomingOrder.reason]) },
        });
        await createReconciliation(tx, {
          supplierId: prepared.supplierId,
          batchId: batch.id,
          importRecordId: plan.recordId,
          reason: "SCHEMA_ERROR",
          evidence: { incomingOrder, offerKey: plan.offerKey },
          candidateProductIds: [plan.productId],
        });
        continue;
      }

      const priceAnomaly = detectPriceAnomaly({
        currentPrice: existing ? Number(existing.purchasePrice) : null,
        incomingPrice: plan.normalized.purchasePrice,
        maxChangeRatio: input.maxPriceChangeRatio ?? DEFAULT_MAX_PRICE_CHANGE_RATIO,
      });
      if (priceAnomaly.anomaly) {
        commercialConflicts += 1;
        await tx.supplierImportRecord.update({
          where: { id: plan.recordId },
          data: { state: "CONFLICT", errorCodes: toPrismaJson([priceAnomaly.reason]) },
        });
        await createReconciliation(tx, {
          supplierId: prepared.supplierId,
          batchId: batch.id,
          importRecordId: plan.recordId,
          reason: "PRICE_ANOMALY",
          evidence: { priceAnomaly, offerKey: plan.offerKey },
          candidateProductIds: [plan.productId],
        });
        continue;
      }

      const availability = deriveAvailability({
        exactQty: plan.normalized.exactQty,
        rawLabel: plan.normalized.supplierAvailabilityRaw ?? plan.normalized.availabilityBand,
      });
      const freshness = classifyFreshness({
        now,
        ingestedAt: now,
        sourceUpdatedAt: plan.normalized.sourceUpdatedAt,
        sourceTimeTrusted: plan.normalized.sourceTimeTrusted,
        policy: freshnessPolicy,
      });
      const offerData = {
        productId: plan.productId,
        supplierArticle: plan.normalized.supplierArticleNorm ?? plan.normalized.supplierArticleRaw ?? null,
        externalProductId: plan.normalized.externalProductId ?? null,
        warehouseKey: plan.normalized.warehouseKey ?? null,
        status: "ACTIVE" as const,
        purchasePrice: plan.normalized.purchasePrice!,
        currency: plan.normalized.currency!,
        quantityMode: availability.quantityMode,
        exactQty: availability.exactQty,
        availabilityBand: availability.band,
        availability: availability.state,
        minOrderQty: plan.normalized.minOrderQty ?? null,
        multiplicity: plan.normalized.multiplicity ?? null,
        leadTimeMinHours: plan.normalized.leadTimeMinHours ?? null,
        leadTimeMaxHours: plan.normalized.leadTimeMaxHours ?? null,
        etaFrom: plan.normalized.etaFrom ?? null,
        etaTo: plan.normalized.etaTo ?? null,
        freshnessClass: freshness.freshnessClass,
        sourceUpdatedAt: plan.normalized.sourceUpdatedAt ?? null,
        sourceTimeTrusted: plan.normalized.sourceTimeTrusted,
        ingestedAt: now,
        freshUntil: freshness.freshUntil,
        staleAllowedUntil: freshness.staleAllowedUntil,
        expiresAt: freshness.expiresAt,
        sourceVersion: input.sourceVersion ?? null,
        importBatchId: batch.id,
        mappingMethod: plan.mappingMethod,
        mappingConfidence: plan.mappingConfidence,
        lastSeenBatchId: batch.id,
        notPresentSince: null,
        metadata: toPrismaJson({
          semanticHash: plan.semanticHash,
          sourceRecordKey: plan.normalized.supplierRecordKey,
          checkoutRevalidate: freshness.checkoutRevalidate,
          displayAllowed: freshness.displayAllowed,
          freshnessReason: freshness.reason,
        }),
      };

      deferredOfferWrites.push(async () => {
        if (existing) {
          await tx.supplierOffer.update({ where: { id: existing.id }, data: offerData });
        } else {
          await tx.supplierOffer.create({
            data: {
              supplierId: prepared.supplierId,
              integrationScope: prepared.integrationScope,
              offerKey: plan.offerKey,
              ...offerData,
            },
          });
        }
        await tx.supplierImportRecord.update({ where: { id: plan.recordId }, data: { state: "PUBLISHED" } });
      });
    }

    if (commercialConflicts > 0) {
      counters.conflict += commercialConflicts;
      counters.matched = Math.max(0, counters.matched - commercialConflicts);
      return blockBatch(
        tx,
        batch.id,
        now,
        counters,
        ["COMMERCIAL_RECONCILIATION_REQUIRED"],
        { commercialConflicts },
      );
    }

    // All commercial rows passed preflight: only now mutate SupplierOffer.
    for (const write of deferredOfferWrites) await write();

    const cleanFullSnapshot =
      publishGate.allowMissingOfferDeactivation &&
      counters.rejected === 0 &&
      counters.ambiguous === 0 &&
      counters.unmatched === 0 &&
      counters.conflict === 0;

    let missingOffersDeactivated = 0;
    if (cleanFullSnapshot) {
      const deactivated = await tx.supplierOffer.updateMany({
        where: {
          supplierId: prepared.supplierId,
          integrationScope: prepared.integrationScope,
          status: "ACTIVE",
          NOT: { lastSeenBatchId: batch.id },
        },
        data: {
          status: "NOT_PRESENT",
          availability: "OUT_OF_STOCK",
          exactQty: null,
          notPresentSince: now,
        },
      });
      missingOffersDeactivated = deactivated.count;
    }

    const reasons =
      input.mode === "FULL_SNAPSHOT" && publishGate.allowMissingOfferDeactivation && !cleanFullSnapshot
        ? ["MISSING_ROW_DEACTIVATION_WITHHELD_DUE_TO_NON_CLEAN_ROWS"]
        : [];

    await tx.supplierImportBatch.update({
      where: { id: batch.id },
      data: {
        status: "PUBLISHED",
        publishStatus: "PUBLISHED",
        finishedAt: now,
        validatedAt: now,
        publishedAt: now,
        recordsReceived: counters.received,
        recordsValid: counters.valid,
        recordsMatched: counters.matched,
        recordsAmbiguous: counters.ambiguous,
        recordsUnmatched: counters.unmatched,
        recordsConflict: counters.conflict,
        recordsRejected: counters.rejected,
        anomalySummary: toPrismaJson({
          ...publishGate.metrics,
          missingOffersDeactivated,
          missingRowDeactivationWithheld: reasons.length > 0,
        }),
      },
    });

    await tx.supplierSyncCursor.upsert({
      where: {
        supplierId_integrationScope: {
          supplierId: prepared.supplierId,
          integrationScope: prepared.integrationScope,
        },
      },
      create: {
        supplierId: prepared.supplierId,
        integrationScope: prepared.integrationScope,
        cursorValue: input.cursorAfter ?? null,
        lastSourceVersion: input.sourceVersion ?? null,
        lastSuccessfulBatchId: batch.id,
        lastFullSnapshotAt: input.mode === "FULL_SNAPSHOT" ? now : null,
        lastSuccessfulAt: now,
        lastPublishedAt: now,
        consecutiveFailures: 0,
        version: 1,
      },
      update: {
        cursorValue: input.cursorAfter ?? null,
        lastSourceVersion: input.sourceVersion ?? null,
        lastSuccessfulBatchId: batch.id,
        ...(input.mode === "FULL_SNAPSHOT" ? { lastFullSnapshotAt: now } : {}),
        lastSuccessfulAt: now,
        lastPublishedAt: now,
        lastErrorAt: null,
        lastErrorCode: null,
        consecutiveFailures: 0,
        version: { increment: 1 },
      },
    });

    return {
      batchId: batch.id,
      idempotent: false,
      published: true,
      publishBlocked: false,
      missingOffersDeactivated,
      counters,
      reasons,
    };
  });
}

export const SUPPLIER_INGESTION_WRITE_ACTIVATION = {
  envName: "SUPPLIER_INGESTION_WRITES_ENABLED",
  requiredEnvValue: WRITE_ENV_VALUE,
  requiredConfirmation: WRITE_CONFIRMATION,
} as const;
