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
  const currentWarehouseKey = warehouseKey(stock);
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
    warehouseKey: currentWarehouseKey,
    minOrderQty: null,
    multiplicity: offer.multiplicity,
    leadTimeMinHours: null,
    leadTimeMaxHours: null,
    etaFrom: null,
    etaTo: null,
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

  const seen = new Set<string>();
  return records.filter((record) => {
    if (seen.has(record.normalized.supplierRecordKey)) return false;
    seen.add(record.normalized.supplierRecordKey);
    return true;
  });
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
    sourceVersion: `search:${queryHash}`,
    sourceChecksum,
    providerDeclaredComplete: false,
    records: recordsWithIdentity,
    // Shadow search intentionally keeps unmatched/rejected rows visible for reconciliation
    // without pretending this query-scoped response is a complete supplier catalogue.
    maxIdentityProblemRatio: 1,
    maxRejectedRatio: 1,
    metadata: {
      shadow: true,
      provider: "UNIQUE_TRADE",
      queryHash,
      offerCount: input.offers.length,
      recordCount: recordsWithIdentity.length,
      rawQueryStored: false,
    },
  };
}

export function assertUniqueTradeShadowWritesEnabled(
  shadowConfirmation: string | undefined,
  env: Env = process.env,
) {
  if (
    env[SHADOW_ENV_NAME] !== SHADOW_ENV_VALUE ||
    shadowConfirmation !== SHADOW_CONFIRMATION
  ) {
    throw new UniqueTradeShadowWriteDisabledError();
  }
}

export async function previewUniqueTradeShadowSearch(
  query: string,
  limit = 30,
): Promise<UniqueTradeShadowPreview> {
  const trimmed = query.trim();
  if (!trimmed) throw new Error("Unique Trade shadow search query is required.");
  const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 30;
  const offers = await uniqueTradeAdapter.search(trimmed, safeLimit);
  const supplier = await getPrisma().supplier.findUnique({
    where: { code: "UNIQUE_TRADE" },
    select: { id: true },
  });
  // Preview is read-only: if the Supplier row is not initialized yet, use a non-persistable
  // placeholder and create the real row only after explicit shadow-write activation.
  const supplierId = supplier?.id ?? "shadow:unique-trade:not-initialized";
  const batch = await buildUniqueTradeShadowBatch({ supplierId, query: trimmed, offers });
  return {
    provider: "UNIQUE_TRADE",
    integrationScope: INTEGRATION_SCOPE,
    offerCount: offers.length,
    recordCount: batch.records.length,
    recordsWithIdentityCandidates: batch.records.filter(
      (record) => (record.identityCandidates?.length ?? 0) > 0,
    ).length,
    batch,
  };
}

export async function runUniqueTradeShadowSearch(
  input: UniqueTradeShadowRunInput,
): Promise<UniqueTradeShadowRunResult> {
  const preview = await previewUniqueTradeShadowSearch(input.query, input.limit);
  if (!input.persist) {
    return { ...preview, persisted: false, persistenceResult: null };
  }

  assertUniqueTradeShadowWritesEnabled(input.shadowConfirmation);
  if (
    input.persistenceConfirmation !==
    SUPPLIER_INGESTION_WRITE_ACTIVATION.requiredConfirmation
  ) {
    throw new UniqueTradeShadowWriteDisabledError();
  }

  const supplier = await ensureSupplierRecord("unique-trade");
  const batch = await buildUniqueTradeShadowBatch({
    supplierId: supplier.id,
    query: input.query,
    offers: await uniqueTradeAdapter.search(input.query.trim(), input.limit ?? 30),
  });
  const persistenceResult = await persistSupplierIngestionBatch(batch, {
    confirmation: input.persistenceConfirmation,
  });

  return {
    provider: "UNIQUE_TRADE",
    integrationScope: INTEGRATION_SCOPE,
    offerCount: batch.metadata?.offerCount as number,
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
