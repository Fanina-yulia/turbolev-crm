export type SupplierImportMode =
  | "FULL_SNAPSHOT"
  | "INCREMENTAL"
  | "API_POLL"
  | "WEBHOOK_DELTA"
  | "MANUAL_FILE";

export type SupplierImportRecordState =
  | "RECEIVED"
  | "NORMALIZED"
  | "MATCHED"
  | "AMBIGUOUS"
  | "UNMATCHED"
  | "CONFLICT"
  | "REJECTED"
  | "PUBLISHED";

export type SupplierMappingMethod =
  | "APPROVED_MAPPING"
  | "TRUSTED_EXTERNAL_ID"
  | "BRAND_MPN"
  | "VERIFIED_GTIN"
  | "ALIAS_SUPERSESSION"
  | "MANUAL";

export type SupplierFreshnessClass =
  | "FRESH"
  | "STALE_ALLOWED"
  | "EXPIRED"
  | "UNKNOWN_SOURCE_TIME"
  | "PROVIDER_ERROR_LAST_KNOWN";

export type SupplierAvailabilityState =
  | "AVAILABLE"
  | "LOW_STOCK"
  | "OUT_OF_STOCK"
  | "ORDERABLE"
  | "CHECK_REQUIRED"
  | "UNKNOWN";

export type SupplierQuantityMode = "EXACT" | "BAND" | "BOOLEAN_ONLY" | "UNKNOWN";

export interface SupplierAdapterContext {
  supplierId: string;
  integrationScope: string;
  cursor?: string | null;
  sourceVersion?: string | null;
  requestedAt: Date;
  signal?: AbortSignal;
}

export interface SupplierAdapterPage<TRaw = unknown> {
  records: TRaw[];
  nextCursor?: string | null;
  sourceVersion?: string | null;
  providerStartedAt?: Date | null;
  providerFinishedAt?: Date | null;
  isComplete: boolean;
  metadata?: Record<string, unknown>;
}

export interface SupplierAdapter<TRaw = unknown> {
  readonly adapterVersion: string;
  readonly schemaVersion: string;
  readonly integrationScope: string;
  fetchPage(context: SupplierAdapterContext): Promise<SupplierAdapterPage<TRaw>>;
  normalize(record: TRaw): NormalizedSupplierRecord;
}

export interface NormalizedSupplierRecord {
  supplierRecordKey: string;
  externalProductId?: string | null;
  supplierArticleRaw?: string | null;
  supplierArticleNorm?: string | null;
  brandRaw?: string | null;
  brandNormalized?: string | null;
  mpnCandidateRaw?: string | null;
  mpnCandidateNorm?: string | null;
  gtinCandidate?: string | null;
  currency?: string | null;
  purchasePrice?: number | null;
  quantityMode: SupplierQuantityMode;
  exactQty?: number | null;
  availabilityBand?: string | null;
  supplierAvailabilityRaw?: string | null;
  warehouseKey?: string | null;
  minOrderQty?: number | null;
  multiplicity?: number | null;
  leadTimeMinHours?: number | null;
  leadTimeMaxHours?: number | null;
  etaFrom?: Date | null;
  etaTo?: Date | null;
  sourceUpdatedAt?: Date | null;
  sourceTimeTrusted: boolean;
  rawPayload: unknown;
}

export interface IdentityEvidenceCandidate {
  productId: string;
  approvedMapping?: boolean;
  trustedExternalId?: boolean;
  brandMpnExact?: boolean;
  verifiedGtin?: boolean;
  aliasSupersession?: boolean;
}

export interface IdentityMatchDecision {
  state: Extract<SupplierImportRecordState, "MATCHED" | "AMBIGUOUS" | "UNMATCHED" | "CONFLICT">;
  productId?: string;
  method?: SupplierMappingMethod;
  confidence?: number;
  candidates: string[];
  reason: string;
}

export interface SupplierFreshnessPolicyContract {
  freshTtlSeconds: number;
  staleAllowedSeconds: number;
  hardExpirySeconds: number;
  checkoutRevalidate: boolean;
  staleDisplayAllowed: boolean;
  providerErrorFallback: boolean;
}

export interface FreshnessDecision {
  freshnessClass: SupplierFreshnessClass;
  baseTime: Date;
  freshUntil: Date;
  staleAllowedUntil: Date | null;
  expiresAt: Date;
  checkoutRevalidate: boolean;
  displayAllowed: boolean;
  reason: string;
}

export interface SnapshotPublishInput {
  mode: SupplierImportMode;
  recordsReceived: number;
  recordsValid: number;
  recordsMatched: number;
  recordsAmbiguous: number;
  recordsUnmatched: number;
  recordsConflict: number;
  recordsRejected: number;
  previousPublishedCount?: number | null;
  minimumFullSnapshotRows?: number;
  maxRejectedRatio?: number;
  maxIdentityProblemRatio?: number;
  maxFullSnapshotDropRatio?: number;
  providerDeclaredComplete?: boolean;
}

export interface SnapshotPublishDecision {
  allowPublish: boolean;
  allowMissingOfferDeactivation: boolean;
  reasons: string[];
  metrics: {
    rejectedRatio: number;
    identityProblemRatio: number;
    fullSnapshotDropRatio: number | null;
  };
}

export interface IncomingOrderDecisionInput {
  currentSourceUpdatedAt?: Date | null;
  incomingSourceUpdatedAt?: Date | null;
  currentSourceTimeTrusted?: boolean;
  incomingSourceTimeTrusted?: boolean;
  currentSourceVersion?: string | null;
  incomingSourceVersion?: string | null;
  currentSemanticHash?: string | null;
  incomingSemanticHash?: string | null;
}

export interface IncomingOrderDecision {
  apply: boolean;
  idempotent: boolean;
  reason: string;
}

export interface AvailabilityInput {
  exactQty?: number | null;
  available?: boolean | null;
  orderable?: boolean | null;
  lowStockThreshold?: number;
  rawLabel?: string | null;
}

export interface AvailabilityDecision {
  state: SupplierAvailabilityState;
  quantityMode: SupplierQuantityMode;
  exactQty: number | null;
  band: string | null;
}
