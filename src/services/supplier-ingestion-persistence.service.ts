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

export class SupplierIngestionWriteDisabledError extends Error {
  constructor() {
    super("Supplier ingestion persistence is disabled. Both the server activation flag and explicit caller confirmation are required.");
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
  counters: {
    received: number;
    valid: number;
    matched: number;
    ambiguous: number;
    unmatched: number;
    conflict: number;
    rejected: number;
  };
  reasons: string[];
}

interface PreparedRecord {
  input: SupplierIngestionRecordInput;
  normalized: NormalizedSupplierRecord;
  semanticHash: string;
  validationErrors: string[];
}

interface PersistedOfferPlan {
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

export function supplierIngestionWritesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SUPPLIER_INGESTION_WRITES_ENABLED === WRITE_ENV_VALUE;
}

export function assertSupplierIngestionWritesEnabled(
  activation: SupplierIngestionWriteActivation,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!supplierIngestionWritesEnabled(env) || activation.confirmation !== WRITE_CONFIRMATION) {
    throw new SupplierIngestionWriteDisabledError();
  }
}

function prepareInput(input: PersistSupplierIngestionBatchInput): {
  supplierId: string;
  integrationScope: string;
  adapterVersion: string;
  schemaVersion: string;
  preparedRecords: PreparedRecord[];
  batchFingerprint: string;
} {
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
  const preparedRecords = input.records.map((record) => {
    const normalized = normalizeSupplierRecord(record.normalized);
    const validationErrors = validateNormalizedRecord(normalized);
    if (!record.rawChecksum.trim()) validationErrors.push("MISSING_RAW_CHECKSUM");
    if (normalized.purchasePrice == null) validationErrors.push("MISSING_PURCHASE_PRICE");
    if (!normalized.currency) validationErrors.push("MISSING_CURRENCY");
    if (seenKeys.has(normalized.supplierRecordKey)) validationErrors.push("DUPLICATE_SUPPLIER_RECORD_KEY_IN_BATCH");
    seenKeys.add(normalized.supplierRecordKey);

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
  return {
    freshTtlSeconds: row.freshTtlSeconds,
    staleAllowedSeconds: row.staleAllowedSeconds,
    hardExpirySeconds: row.hardExpirySeconds,
    checkoutRevalidate: row.checkoutRevalidate,
    staleDisplayAllowed: row.staleDisplayAllowed,
    providerErrorFallback: row.providerErrorFallback,
  };
}

function readMetadataString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate ? candidate : null;
}

function reconciliationReasonForState(state: "AMBIGUOUS" | "UNMATCHED" | "CONFLICT") {
  if (state === "AMBIGUOUS") return "AMBIGUOUS" as const;
  if (state === "UNMATCHED") return "UNMATCHED" as const;
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
  return task;
}

async function loadApprovedStableMapping(
  tx: Tx,
  supplierId: string,
  integrationScope: string,
  supplierRecordKey: string,
): Promise<IdentityEvidenceCandidate | null> {
  const mapping = await tx.supplierIdentityMapping.findFirst({
    where: {
      supplierId,
      integrationScope,
      supplierRecordKey,
      isApproved: true,
      isActive: true,
    },
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
  const isApproved = input.method === "APPROVED_MAPPING" || input.method === "MANUAL";
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
      isApproved,
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
      ...(isApproved ? { isApproved: true } : {}),
    },
  });
}

export async function persistSupplierIngestionBatch(
  input: PersistSupplierIngestionBatchInput,
  activation: SupplierIngestionWriteActivation,
): Promise<PersistSupplierIngestionBatchResult> {
  // Deliberately checked before `getPrisma()` so disabled code cannot even open a DB connection.
  assertSupplierIngestionWritesEnabled(activation);
  const prepared = prepareInput(input);
  const prisma = getPrisma();
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`supplier-ingestion:${prepared.supplierId}:${prepared.integrationScope}`}))`;

    const supplier = await tx.supplier.findUnique({
      where: { id: prepared.supplierId },
      select: { id: true, isActive: true },
    });
    if (!supplier || !supplier.isActive) {
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
      where: {
        supplierId: prepared.supplierId,
        integrationScope: prepared.integrationScope,
        status: "ACTIVE",
      },
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
        bytesReceived: null,
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
            await tx.product.findMany({
              where: { id: { in: suppliedCandidateIds } },
              select: { id: true },
            })
          ).map((product) => product.id),
        )
      : new Set<string>();

    const counters = {
      received: prepared.preparedRecords.length,
      valid: 0,
      matched: 0,
      ambiguous: 0,
      unmatched: 0,
      conflict: 0,
      rejected: 0,
    };
    const offerPlans: PersistedOfferPlan[] = [];

    for (const preparedRecord of prepared.preparedRecords) {
      const { normalized } = preparedRecord;
      const validationErrors = [...preparedRecord.validationErrors];
      const unknownCandidateIds = (preparedRecord.input.identityCandidates ?? [])
        .map((candidate) => candidate.productId)
        .filter((productId) => !existingCandidateIds.has(productId));
      if (unknownCandidateIds.length > 0) validationErrors.push("UNKNOWN_CANDIDATE_PRODUCT");

      if (validationErrors.length > 0) {
        const staged = await tx.supplierImportRecord.create({
          data: {
            batchId: batch.id,
            supplierRecordKey: normalized.supplierRecordKey,
            state: "REJECTED",
            rawChecksum: preparedRecord.input.rawChecksum.trim() || "missing",
            rawPayload: toPrismaJson(normalized.rawPayload),
            normalizedPayload: toPrismaJson(normalized),
            externalProductId: normalized.externalProductId ?? null,
            supplierArticleRaw: normalized.supplierArticleRaw ?? null,
            supplierArticleNorm: normalized.supplierArticleNorm ?? null,
            brandRaw: normalized.brandRaw ?? null,
            brandNormalized: normalized.brandNormalized ?? null,
            mpnCandidateRaw: normalized.mpnCandidateRaw ?? null,
            mpnCandidateNorm: normalized.mpnCandidateNorm ?? null,
            gtinCandidate: normalized.gtinCandidate ?? null,
            currency: normalized.currency ?? null,
            purchasePrice: normalized.purchasePrice ?? null,
            quantityMode: normalized.quantityMode,
            exactQty: normalized.exactQty ?? null,
            availabilityBand: normalized.availabilityBand ?? null,
            supplierAvailabilityRaw: normalized.supplierAvailabilityRaw ?? null,
            warehouseKey: normalized.warehouseKey ?? null,
            minOrderQty: normalized.minOrderQty ?? null,
            multiplicity: normalized.multiplicity ?? null,
            leadTimeMinHours: normalized.leadTimeMinHours ?? null,
            leadTimeMaxHours: normalized.leadTimeMaxHours ?? null,
            etaFrom: normalized.etaFrom ?? null,
            etaTo: normalized.etaTo ?? null,
            sourceUpdatedAt: normalized.sourceUpdatedAt ?? null,
            sourceTimeTrusted: normalized.sourceTimeTrusted,
            errorCodes: toPrismaJson(validationErrors),
          },
        });
        counters.rejected += 1;
        await createReconciliation(tx, {
          supplierId: prepared.supplierId,
          batchId: batch.id,
          importRecordId: staged.id,
          reason: "SCHEMA_ERROR",
          evidence: { validationErrors, unknownCandidateIds },
          candidateProductIds: (preparedRecord.input.identityCandidates ?? [])
            .map((candidate) => candidate.productId)
            .filter((productId) => existingCandidateIds.has(productId)),
        });
        continue;
      }

      counters.valid += 1;
      const approvedStableMapping = await loadApprovedStableMapping(
        tx,
        prepared.supplierId,
        prepared.integrationScope,
        normalized.supplierRecordKey,
      );
      const candidates = [
        ...(approvedStableMapping ? [approvedStableMapping] : []),
        ...(preparedRecord.input.identityCandidates ?? []).filter((candidate) => existingCandidateIds.has(candidate.productId)),
      ];
      const identityDecision = decideIdentityMatch(candidates);

      const staged = await tx.supplierImportRecord.create({
        data: {
          batchId: batch.id,
          supplierRecordKey: normalized.supplierRecordKey,
          state: identityDecision.state,
          rawChecksum: preparedRecord.input.rawChecksum.trim(),
          rawPayload: toPrismaJson(normalized.rawPayload),
          normalizedPayload: toPrismaJson(normalized),
          externalProductId: normalized.externalProductId ?? null,
          supplierArticleRaw: normalized.supplierArticleRaw ?? null,
          supplierArticleNorm: normalized.supplierArticleNorm ?? null,
          brandRaw: normalized.brandRaw ?? null,
          brandNormalized: normalized.brandNormalized ?? null,
          mpnCandidateRaw: normalized.mpnCandidateRaw ?? null,
          mpnCandidateNorm: normalized.mpnCandidateNorm ?? null,
          gtinCandidate: normalized.gtinCandidate ?? null,
          currency: normalized.currency ?? null,
          purchasePrice: normalized.purchasePrice ?? null,
          quantityMode: normalized.quantityMode,
          exactQty: normalized.exactQty ?? null,
          availabilityBand: normalized.availabilityBand ?? null,
          supplierAvailabilityRaw: normalized.supplierAvailabilityRaw ?? null,
          warehouseKey: normalized.warehouseKey ?? null,
          minOrderQty: normalized.minOrderQty ?? null,
          multiplicity: normalized.multiplicity ?? null,
          leadTimeMinHours: normalized.leadTimeMinHours ?? null,
          leadTimeMaxHours: normalized.leadTimeMaxHours ?? null,
          etaFrom: normalized.etaFrom ?? null,
          etaTo: normalized.etaTo ?? null,
          sourceUpdatedAt: normalized.sourceUpdatedAt ?? null,
          sourceTimeTrusted: normalized.sourceTimeTrusted,
          matchedProductId: identityDecision.productId ?? null,
          mappingMethod: identityDecision.method ?? null,
          matchConfidence: identityDecision.confidence ?? null,
          identityEvidence: toPrismaJson({
            reason: identityDecision.reason,
            candidates: identityDecision.candidates,
          }),
        },
      });

      if (identityDecision.state !== "MATCHED" || !identityDecision.productId || !identityDecision.method) {
        if (identityDecision.state === "AMBIGUOUS") counters.ambiguous += 1;
        if (identityDecision.state === "UNMATCHED") counters.unmatched += 1;
        if (identityDecision.state === "CONFLICT") counters.conflict += 1;
        await createReconciliation(tx, {
          supplierId: prepared.supplierId,
          batchId: batch.id,
          importRecordId: staged.id,
          reason: reconciliationReasonForState(identityDecision.state),
          evidence: { identityDecision, candidates },
          candidateProductIds: identityDecision.candidates,
        });
        continue;
      }

      counters.matched += 1;
      await upsertObservedMapping(tx, {
        supplierId: prepared.supplierId,
        integrationScope: prepared.integrationScope,
        supplierRecordKey: normalized.supplierRecordKey,
        productId: identityDecision.productId,
        method: identityDecision.method,
        confidence: identityDecision.confidence ?? null,
        evidence: { identityDecision, candidates },
        sourceVersion: input.sourceVersion ?? null,
      });

      offerPlans.push({
        recordId: staged.id,
        productId: identityDecision.productId,
        mappingMethod: identityDecision.method,
        mappingConfidence: identityDecision.confidence ?? null,
        normalized,
        semanticHash: preparedRecord.semanticHash,
        offerKey: buildOfferKey({
          supplierRecordKey: normalized.supplierRecordKey,
          externalProductId: normalized.externalProductId,
          supplierArticle: normalized.supplierArticleNorm ?? normalized.supplierArticleRaw,
          warehouseKey: normalized.warehouseKey,
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
      await tx.supplierImportBatch.update({
        where: { id: batch.id },
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
          errorCode: publishGate.reasons[0] ?? "PUBLISH_GATE_BLOCKED",
          errorSummary: publishGate.reasons.join(", "),
          anomalySummary: toPrismaJson(publishGate.metrics),
        },
      });
      return {
        batchId: batch.id,
        idempotent: false,
        published: false,
        publishBlocked: true,
        missingOffersDeactivated: 0,
        counters,
        reasons: publishGate.reasons,
      };
    }

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
          data: {
            state: "CONFLICT",
            errorCodes: toPrismaJson([incomingOrder.reason]),
          },
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
          data: {
            state: "CONFLICT",
            errorCodes: toPrismaJson([priceAnomaly.reason]),
          },
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
      const ingestedAt = now;
      const freshness = classifyFreshness({
        now,
        ingestedAt,
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
        ingestedAt,
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

      if (existing) {
        await tx.supplierOffer.update({
          where: { id: existing.id },
          data: offerData,
        });
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
      await tx.supplierImportRecord.update({
        where: { id: plan.recordId },
        data: { state: "PUBLISHED" },
      });
    }

    if (commercialConflicts > 0) {
      counters.conflict += commercialConflicts;
      counters.matched = Math.max(0, counters.matched - commercialConflicts);
      await tx.supplierImportBatch.update({
        where: { id: batch.id },
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
          errorCode: "COMMERCIAL_RECONCILIATION_REQUIRED",
          errorSummary: `${commercialConflicts} offer(s) require reconciliation before this batch can be considered fully published.`,
          anomalySummary: toPrismaJson({ commercialConflicts }),
        },
      });
      // Do not deactivate missing rows when any offer in the incoming batch was rejected after the pre-publish gate.
      return {
        batchId: batch.id,
        idempotent: false,
        published: false,
        publishBlocked: true,
        missingOffersDeactivated: 0,
        counters,
        reasons: ["COMMERCIAL_RECONCILIATION_REQUIRED"],
      };
    }

    let missingOffersDeactivated = 0;
    if (publishGate.allowMissingOfferDeactivation) {
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
      reasons: [],
    };
  });
}

export const SUPPLIER_INGESTION_WRITE_ACTIVATION = {
  envName: "SUPPLIER_INGESTION_WRITES_ENABLED",
  requiredEnvValue: WRITE_ENV_VALUE,
  requiredConfirmation: WRITE_CONFIRMATION,
} as const;
