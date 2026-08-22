import type { IdentityEvidenceCandidate, NormalizedSupplierRecord } from "@/src/services/supplier-ingestion-contracts";
import {
  normalizeBrand,
  normalizePartNumber,
  semanticFingerprint,
} from "@/src/services/supplier-ingestion-policy";
import {
  persistSupplierIngestionBatch,
  SUPPLIER_INGESTION_WRITE_ACTIVATION,
  type PersistSupplierIngestionBatchInput,
  type PersistSupplierIngestionBatchResult,
  type SupplierIngestionRecordInput,
} from "@/src/services/supplier-ingestion-persistence.service";
import { getPrisma } from "@/src/lib/prisma";
import { ensureSupplierRecord } from "@/src/services/suppliers/order.service";
import { uniqueTradeAdapter } from "@/src/services/suppliers/unique-trade.adapter";
import type { SupplierOffer, SupplierStock } from "@/src/services/suppliers/types";

const INTEGRATION_SCOPE = "UNIQUE_TRADE_SEARCH_SHADOW_V1";
const ADAPTER_VERSION = "unique-trade-search-shadow/1";
const SCHEMA_VERSION = "supplier-ingestion/v1";
const SHADOW_ENV_NAME = "UNIQUE_TRADE_SHADOW_INGESTION_ENABLED";
const SHADOW_ENV_VALUE = "SHADOW_UNIQUE_TRADE_V1";
const SHADOW_CONFIRMATION = "ALLOW_UNIQUE_TRADE_SHADOW_INGESTION";

type Env = Record<string, string | undefined>;

type IdentityResolver = (
  record: NormalizedSupplierRecord,
) => Promise<IdentityEvidenceCandidate[]>;

export class UniqueTradeShadowWriteDisabledError extends Error {
  constructor() {
    super(
      "Unique Trade shadow persistence is disabled. Shadow activation and supplier-ingestion persistence activation are both required.",
    );
    this.name = "UniqueTradeShadowWriteDisabledError";
  }
}

export class UniqueTradeShadowDuplicateRecordConflictError extends Error {
  readonly supplierRecordKey: string;

  constructor(supplierRecordKey: string) {
    super(
      `Unique Trade returned conflicting commercial rows for the same shadow identity: ${supplierRecordKey}.`,
    );
    this.name = "UniqueTradeShadowDuplicateRecordConflictError";
    this.supplierRecordKey = supplierRecordKey;
  }
}

export type UniqueTradeShadowRunInput = {
  query: string;
  limit?: number;
  persist?: boolean;
  shadowConfirmation?: string;
  persistenceConfirmation?: string;
};

export type UniqueTradeShadowPreview = {
  provider: "UNIQUE_TRADE";
  integrationScope: typeof INTEGRATION_SCOPE;
  offerCount: number;
  recordCount: number;
  recordsWithIdentityCandidates: number;
  batch: PersistSupplierIngestionBatchInput;
};

export type UniqueTradeShadowRunResult = UniqueTradeShadowPreview & {
  persisted: boolean;
  persistenceResult: PersistSupplierIngestionBatchResult | null;
};

function stableQueryHash(query: string) {
  return semanticFingerprint(query.trim().normalize("NFKC").toUpperCase()).slice(0, 24);
}

function warehouseKey(stock: SupplierStock | null) {
  if (!stock) return null;
  const id = stock.warehouseId?.trim();
  if (id) return `UTR:${id}`;
  const label = stock.warehouse?.trim();
  if (!label) return null;
  return `UTRNAME:${semanticFingerprint(label.normalize("NFKC").toUpperCase()).slice(0, 16)}`;
}

function quantityContract(stock: SupplierStock | null, available: boolean) {
  const raw = stock?.quantity?.trim() || "";
  const numeric = Number(raw.replace(",", "."));
  if (raw && Number.isFinite(numeric) && numeric >= 0) {
    return {
      quantityMode: "EXACT" as const,
      exactQty: numeric,
      availabilityBand: null,
      supplierAvailabilityRaw: raw,
    };
  }
  if (/^\d+\+$/.test(raw)) {
    return {
      quantityMode: "BAND" as const,
      exactQty: null,
      availabilityBand: raw,
      supplierAvailabilityRaw: raw,
    };
  }
  if (raw || available) {
    return {
      quantityMode: "BOOLEAN_ONLY" as const,
      exactQty: null,
      availabilityBand: null,
      supplierAvailabilityRaw: raw || "available",
    };
  }
  return {
    quantityMode: "EXACT" as const,
    exactQty: 0,
    availabilityBand: null,
    supplierAvailabilityRaw: "0",
  };
}

function stableRecordKey(offer: SupplierOffer, stock: SupplierStock | null) {
  const identity = {
    externalProductId: offer.externalProductId?.trim() || null,
    brand: normalizeBrand(offer.brand),
    article: normalizePartNumber(offer.article),
    warehouseKey: warehouseKey(stock),
  };
  return `UTR:${semanticFingerprint(identity).slice(0, 40)}`;
}

function normalizedRecord(offer: SupplierOffer, stock: SupplierStock | null): NormalizedSupplierRecord {
  const quantity = quantityContract(stock, offer.available);
  return {
    supplierRecordKey: stableRecordKey(offer, stock),
    externalProductId: offer.externalProductId?.trim() || null,
    supplierArticleRaw: offer.article?.trim() || null,
    supplierArticleNorm: normalizePartNumber(offer.article),
    brandRaw: offer.brand?.trim() || null,
    brandNormalized: normalizeBrand(offer.brand),
    mpnCandidateRaw: offer.article?.trim() || null,
    mpnCandidateNorm: normalizePartNumber(offer.article),
    gtinCandidate: null,
    currency: offer.currency?.trim().toUpperCase() || null,
    purchasePrice: offer.purchasePrice,
    quantityMode: quantity.quantityMode,
    exactQty: quantity.exactQty,
    availabilityBand: quantity.availabilityBand,
    supplierAvailabilityRaw: quantity.supplierAvailabilityRaw,
    warehouseKey: warehouseKey(stock),
    minOrderQty: null,
    multiplicity: offer.multiplicity,
    leadTimeMinHours: null,
    leadTimeMaxHours: null,
    etaFrom: null,
    etaTo: null,
    // Unique Trade search currently gives us a current observation, not an authoritative
    // provider-side updated_at/version. Keep that distinction explicit and fail-closed.
    sourceUpdatedAt: null,
    sourceTimeTrusted: false,
    rawPayload: {
      provider: "UNIQUE_TRADE",
      externalProductId: offer.externalProductId?.trim() || null,
      article: offer.article?.trim() || null,
      brand: offer.brand?.trim() || null,
      name: offer.name?.trim() || null,
      purchasePrice: offer.purchasePrice,
      currency: offer.currency?.trim().toUpperCase() || null,
      multiplicity: offer.multiplicity,
      available: offer.available,
      warehouse: stock?.warehouse?.trim() || null,
      warehouseId: stock?.warehouseId?.trim() || null,
      quantity: stock?.quantity?.trim() || null,
      sourceUrl: offer.sourceUrl,
    },
  };
}

function commercialFingerprint(record: NormalizedSupplierRecord) {
  return semanticFingerprint({
    externalProductId: record.externalProductId ?? null,
    supplierArticleNorm: record.supplierArticleNorm ?? null,
    brandNormalized: record.brandNormalized ?? null,
    mpnCandidateNorm: record.mpnCandidateNorm ?? null,
    currency: record.currency ?? null,
    purchasePrice: record.purchasePrice ?? null,
    quantityMode: record.quantityMode,
    exactQty: record.exactQty ?? null,
    availabilityBand: record.availabilityBand ?? null,
    supplierAvailabilityRaw: record.supplierAvailabilityRaw ?? null,
    warehouseKey: record.warehouseKey ?? null,
    minOrderQty: record.minOrderQty ?? null,
    multiplicity: record.multiplicity ?? null,
  });
}

export function buildUniqueTradeShadowRecords(offers: SupplierOffer[]): SupplierIngestionRecordInput[] {
  const records = offers.flatMap((offer) => {
    const stocks = offer.stock.length > 0 ? offer.stock : [null];
    return stocks.map((stock) => {
      const normalized = normalizedRecord(offer, stock);
      return {
        normalized,
        rawChecksum: semanticFingerprint(normalized.rawPayload),
      } satisfies SupplierIngestionRecordInput;
    });
  });

  const byKey = new Map<
    string,
    { record: SupplierIngestionRecordInput; commercialHash: string }
  >();
  for (const record of records) {
    const key = record.normalized.supplierRecordKey;
    const commercialHash = commercialFingerprint(record.normalized);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { record, commercialHash });
      continue;
    }
    if (existing.commercialHash !== commercialHash) {
      throw new UniqueTradeShadowDuplicateRecordConflictError(key);
    }
    // Exact commercial duplicate: keep the first raw observation deterministically.
  }
  return [...byKey.values()].map((item) => item.record);
}

function mergeCandidate(
  map: Map<string, IdentityEvidenceCandidate>,
  productId: string,
  patch: Omit<IdentityEvidenceCandidate, "productId">,
) {
  const current = map.get(productId) ?? { productId };
  map.set(productId, { ...current, ...patch, productId });
}

export async function resolveUniqueTradeIdentityCandidates(
  record: NormalizedSupplierRecord,
): Promise<IdentityEvidenceCandidate[]> {
  const prisma = getPrisma();
  const candidates = new Map<string, IdentityEvidenceCandidate>();

  if (record.externalProductId) {
    const external = await prisma.productExternalReference.findUnique({
      where: {
        provider_externalType_externalId: {
          provider: "UNIQUE_TRADE",
          externalType: "DETAIL_ID",
          externalId: record.externalProductId,
        },
      },
      select: { product: { select: { id: true, status: true } } },
    });
    if (external?.product.status === "ACTIVE") {
      mergeCandidate(candidates, external.product.id, { trustedExternalId: true });
    }
  }

  if (record.brandNormalized && record.mpnCandidateNorm) {
    const exactProducts = await prisma.product.findMany({
      where: {
        status: "ACTIVE",
        mpnNormalized: record.mpnCandidateNorm,
        brand: { normalizedName: record.brandNormalized, status: "ACTIVE" },
      },
      select: { id: true },
      take: 5,
    });
    for (const product of exactProducts) {
      mergeCandidate(candidates, product.id, { brandMpnExact: true });
    }
  }

  return [...candidates.values()].sort((a, b) => a.productId.localeCompare(b.productId));
}

export async function buildUniqueTradeShadowBatch(input: {
  supplierId: string;
  query: string;
  offers: SupplierOffer[];
  providerStartedAt?: Date | null;
  providerFinishedAt?: Date | null;
  resolveIdentity?: IdentityResolver;
}): Promise<PersistSupplierIngestionBatchInput> {
  const resolveIdentity = input.resolveIdentity ?? resolveUniqueTradeIdentityCandidates;
  const records = buildUniqueTradeShadowRecords(input.offers);
  const recordsWithIdentity = await Promise.all(
    records.map(async (record) => ({
      ...record,
      identityCandidates: await resolveIdentity(record.normalized),
    })),
  );
  const queryHash = stableQueryHash(input.query);
  const sourceChecksum = semanticFingerprint(
    recordsWithIdentity.map((record) => ({
      key: record.normalized.supplierRecordKey,
      checksum: record.rawChecksum,
      candidates: record.identityCandidates,
    })),
  );

  return {
    supplierId: input.supplierId,
    integrationScope: INTEGRATION_SCOPE,
    mode: "API_POLL",
    adapterVersion: ADAPTER_VERSION,
    schemaVersion: SCHEMA_VERSION,
    // A query hash is not a provider version. Leave sourceVersion absent so the core
    // ordering policy cannot mistake it for authoritative change ordering evidence.
    sourceVersion: null,
    sourceChecksum,
    providerStartedAt: input.providerStartedAt ?? null,
    providerFinishedAt: input.providerFinishedAt ?? null,
    providerDeclaredComplete: false,
    records: recordsWithIdentity,
    // Query-scoped shadow data is deliberately allowed to carry unmatched/rejected rows
    // for reconciliation. It is never treated as a complete supplier catalogue.
    maxIdentityProblemRatio: 1,
    maxRejectedRatio: 1,
    metadata: {
      shadow: true,
      provider: "UNIQUE_TRADE",
      queryHash,
      offerCount: input.offers.length,
      recordCount: recordsWithIdentity.length,
      rawQueryStored: false,
      providerOrderingEvidence: false,
      changedCommercialPayloadPolicy: "RECONCILE_FAIL_CLOSED",
    },
  };
}

export function assertUniqueTradeShadowWritesEnabled(
  shadowConfirmation: string | undefined,
  persistenceConfirmation: string | undefined,
  env: Env = process.env,
) {
  if (
    env[SHADOW_ENV_NAME] !== SHADOW_ENV_VALUE ||
    shadowConfirmation !== SHADOW_CONFIRMATION ||
    env[SUPPLIER_INGESTION_WRITE_ACTIVATION.envName] !==
      SUPPLIER_INGESTION_WRITE_ACTIVATION.requiredEnvValue ||
    persistenceConfirmation !==
      SUPPLIER_INGESTION_WRITE_ACTIVATION.requiredConfirmation
  ) {
    throw new UniqueTradeShadowWriteDisabledError();
  }
}

async function loadUniqueTradeShadowSearch(query: string, limit = 30) {
  const trimmed = query.trim();
  if (!trimmed) throw new Error("Unique Trade shadow search query is required.");
  const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 30;
  const providerStartedAt = new Date();
  const offers = await uniqueTradeAdapter.search(trimmed, safeLimit);
  const providerFinishedAt = new Date();
  return { query: trimmed, trimmed, offers, providerStartedAt, providerFinishedAt };
}

async function previewFromSnapshot(input: {
  query: string;
  offers: SupplierOffer[];
  providerStartedAt: Date;
  providerFinishedAt: Date;
}): Promise<UniqueTradeShadowPreview> {
  const supplier = await getPrisma().supplier.findUnique({
    where: { code: "UNIQUE_TRADE" },
    select: { id: true },
  });
  // Preview is read-only: if the Supplier row is not initialized yet, use a non-persistable
  // placeholder and create the real row only after every write gate has passed.
  const supplierId = supplier?.id ?? "shadow:unique-trade:not-initialized";
  const batch = await buildUniqueTradeShadowBatch({
    supplierId,
    query: input.query,
    offers: input.offers,
    providerStartedAt: input.providerStartedAt,
    providerFinishedAt: input.providerFinishedAt,
  });
  return {
    provider: "UNIQUE_TRADE",
    integrationScope: INTEGRATION_SCOPE,
    offerCount: input.offers.length,
    recordCount: batch.records.length,
    recordsWithIdentityCandidates: batch.records.filter(
      (record) => (record.identityCandidates?.length ?? 0) > 0,
    ).length,
    batch,
  };
}

export async function previewUniqueTradeShadowSearch(
  query: string,
  limit = 30,
): Promise<UniqueTradeShadowPreview> {
  const snapshot = await loadUniqueTradeShadowSearch(query, limit);
  return previewFromSnapshot(snapshot);
}

export async function runUniqueTradeShadowSearch(
  input: UniqueTradeShadowRunInput,
): Promise<UniqueTradeShadowRunResult> {
  if (input.persist) {
    // Persist-mode authorization is checked before the provider API call, DB reads or writes.
    assertUniqueTradeShadowWritesEnabled(
      input.shadowConfirmation,
      input.persistenceConfirmation,
    );
  }

  const snapshot = await loadUniqueTradeShadowSearch(input.query, input.limit);
  if (!input.persist) {
    const preview = await previewFromSnapshot(snapshot);
    return { ...preview, persisted: false, persistenceResult: null };
  }

  const supplier = await ensureSupplierRecord("unique-trade");
  const batch = await buildUniqueTradeShadowBatch({
    supplierId: supplier.id,
    query: snapshot.trimmed,
    offers: snapshot.offers,
    providerStartedAt: snapshot.providerStartedAt,
    providerFinishedAt: snapshot.providerFinishedAt,
  });
  const persistenceResult = await persistSupplierIngestionBatch(batch, {
    confirmation: input.persistenceConfirmation!,
  });

  return {
    provider: "UNIQUE_TRADE",
    integrationScope: INTEGRATION_SCOPE,
    offerCount: snapshot.offers.length,
    recordCount: batch.records.length,
    recordsWithIdentityCandidates: batch.records.filter(
      (record) => (record.identityCandidates?.length ?? 0) > 0,
    ).length,
    batch,
    persisted: true,
    persistenceResult,
  };
}

export const UNIQUE_TRADE_SHADOW_INGESTION_ACTIVATION = {
  envName: SHADOW_ENV_NAME,
  requiredEnvValue: SHADOW_ENV_VALUE,
  requiredConfirmation: SHADOW_CONFIRMATION,
  persistenceEnvName: SUPPLIER_INGESTION_WRITE_ACTIVATION.envName,
  persistenceRequiredEnvValue:
    SUPPLIER_INGESTION_WRITE_ACTIVATION.requiredEnvValue,
  persistenceRequiredConfirmation:
    SUPPLIER_INGESTION_WRITE_ACTIVATION.requiredConfirmation,
} as const;
