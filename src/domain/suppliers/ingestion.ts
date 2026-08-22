import { createHash } from "node:crypto";
import type {
  AvailabilityDecision,
  AvailabilityInput,
  FreshnessDecision,
  IdentityEvidenceCandidate,
  IdentityMatchDecision,
  IncomingOrderDecision,
  IncomingOrderDecisionInput,
  NormalizedSupplierRecord,
  SnapshotPublishDecision,
  SnapshotPublishInput,
  SupplierFreshnessPolicyContract,
  SupplierMappingMethod,
} from "./contracts";

const SECOND_MS = 1_000;

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(",", "."));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function normalizeBrand(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

export function normalizePartNumber(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value)
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
  return normalized || null;
}

export function normalizeGtin(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const digits = String(value).replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 14 ? digits : null;
}

export function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const currency = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function semanticFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

export function normalizeSupplierRecord(record: NormalizedSupplierRecord): NormalizedSupplierRecord {
  const purchasePrice = asFiniteNumber(record.purchasePrice);
  const exactQty = asFiniteNumber(record.exactQty);
  const minOrderQty = asFiniteNumber(record.minOrderQty);
  const multiplicity = asFiniteNumber(record.multiplicity);

  return {
    ...record,
    supplierRecordKey: record.supplierRecordKey.trim(),
    externalProductId: record.externalProductId?.trim() || null,
    supplierArticleRaw: record.supplierArticleRaw?.trim() || null,
    supplierArticleNorm: normalizePartNumber(record.supplierArticleNorm ?? record.supplierArticleRaw),
    brandRaw: record.brandRaw?.trim() || null,
    brandNormalized: normalizeBrand(record.brandNormalized ?? record.brandRaw),
    mpnCandidateRaw: record.mpnCandidateRaw?.trim() || null,
    mpnCandidateNorm: normalizePartNumber(record.mpnCandidateNorm ?? record.mpnCandidateRaw),
    gtinCandidate: normalizeGtin(record.gtinCandidate),
    currency: normalizeCurrency(record.currency),
    purchasePrice,
    exactQty,
    minOrderQty,
    multiplicity,
    warehouseKey: record.warehouseKey?.trim() || null,
    availabilityBand: record.availabilityBand?.trim() || null,
    supplierAvailabilityRaw: record.supplierAvailabilityRaw?.trim() || null,
  };
}

export function validateNormalizedRecord(record: NormalizedSupplierRecord): string[] {
  const errors: string[] = [];
  if (!record.supplierRecordKey.trim()) errors.push("MISSING_SUPPLIER_RECORD_KEY");
  if (record.purchasePrice != null && (!Number.isFinite(record.purchasePrice) || record.purchasePrice < 0)) {
    errors.push("INVALID_PURCHASE_PRICE");
  }
  if (record.exactQty != null && (!Number.isFinite(record.exactQty) || record.exactQty < 0)) {
    errors.push("INVALID_EXACT_QTY");
  }
  if (record.minOrderQty != null && (!Number.isFinite(record.minOrderQty) || record.minOrderQty <= 0)) {
    errors.push("INVALID_MIN_ORDER_QTY");
  }
  if (record.multiplicity != null && (!Number.isFinite(record.multiplicity) || record.multiplicity <= 0)) {
    errors.push("INVALID_MULTIPLICITY");
  }
  if (record.currency != null && normalizeCurrency(record.currency) == null) errors.push("INVALID_CURRENCY");
  if (record.gtinCandidate != null && normalizeGtin(record.gtinCandidate) == null) errors.push("INVALID_GTIN");
  if (
    !record.externalProductId &&
    !record.supplierArticleNorm &&
    !record.mpnCandidateNorm &&
    !record.gtinCandidate
  ) {
    errors.push("MISSING_IDENTITY_EVIDENCE");
  }
  return errors;
}

const methodScore: Record<SupplierMappingMethod, number> = {
  APPROVED_MAPPING: 100,
  TRUSTED_EXTERNAL_ID: 95,
  BRAND_MPN: 90,
  VERIFIED_GTIN: 90,
  ALIAS_SUPERSESSION: 70,
  MANUAL: 100,
};

function evidenceFor(candidate: IdentityEvidenceCandidate): Array<{ method: SupplierMappingMethod; score: number }> {
  const evidence: Array<{ method: SupplierMappingMethod; score: number }> = [];
  if (candidate.approvedMapping) evidence.push({ method: "APPROVED_MAPPING", score: methodScore.APPROVED_MAPPING });
  if (candidate.trustedExternalId) evidence.push({ method: "TRUSTED_EXTERNAL_ID", score: methodScore.TRUSTED_EXTERNAL_ID });
  if (candidate.brandMpnExact) evidence.push({ method: "BRAND_MPN", score: methodScore.BRAND_MPN });
  if (candidate.verifiedGtin) evidence.push({ method: "VERIFIED_GTIN", score: methodScore.VERIFIED_GTIN });
  if (candidate.aliasSupersession) evidence.push({ method: "ALIAS_SUPERSESSION", score: methodScore.ALIAS_SUPERSESSION });
  return evidence.sort((a, b) => b.score - a.score || a.method.localeCompare(b.method));
}

export function decideIdentityMatch(candidates: IdentityEvidenceCandidate[]): IdentityMatchDecision {
  const allProductIds = [...new Set(candidates.map((candidate) => candidate.productId))].sort();
  const evidence = candidates.flatMap((candidate) =>
    evidenceFor(candidate).map((entry) => ({ ...entry, productId: candidate.productId })),
  );

  if (evidence.length === 0) {
    return {
      state: "UNMATCHED",
      candidates: allProductIds,
      reason: "NO_TRUSTED_IDENTITY_EVIDENCE",
    };
  }

  const strongEvidence = evidence.filter((entry) => entry.score >= 90);
  const strongProducts = [...new Set(strongEvidence.map((entry) => entry.productId))];
  if (strongProducts.length > 1) {
    return {
      state: "CONFLICT",
      candidates: strongProducts.sort(),
      reason: "STRONG_IDENTITY_EVIDENCE_POINTS_TO_MULTIPLE_PRODUCTS",
    };
  }

  if (strongProducts.length === 1) {
    const productId = strongProducts[0];
    const winner = strongEvidence
      .filter((entry) => entry.productId === productId)
      .sort((a, b) => b.score - a.score || a.method.localeCompare(b.method))[0];
    return {
      state: "MATCHED",
      productId,
      method: winner.method,
      confidence: winner.score,
      candidates: allProductIds,
      reason: "UNIQUE_STRONG_IDENTITY_MATCH",
    };
  }

  const aliasProducts = [...new Set(evidence.filter((entry) => entry.method === "ALIAS_SUPERSESSION").map((entry) => entry.productId))];
  if (aliasProducts.length === 1) {
    return {
      state: "MATCHED",
      productId: aliasProducts[0],
      method: "ALIAS_SUPERSESSION",
      confidence: methodScore.ALIAS_SUPERSESSION,
      candidates: allProductIds,
      reason: "UNIQUE_APPROVED_ALIAS_OR_SUPERSESSION_MATCH",
    };
  }
  if (aliasProducts.length > 1) {
    return {
      state: "AMBIGUOUS",
      candidates: aliasProducts.sort(),
      reason: "MULTIPLE_ALIAS_OR_SUPERSESSION_CANDIDATES",
    };
  }

  return {
    state: "UNMATCHED",
    candidates: allProductIds,
    reason: "NO_MATCHABLE_IDENTITY_EVIDENCE",
  };
}

function validateFreshnessPolicy(policy: SupplierFreshnessPolicyContract): void {
  if (!Number.isInteger(policy.freshTtlSeconds) || policy.freshTtlSeconds < 0) {
    throw new Error("freshTtlSeconds must be a non-negative integer");
  }
  if (!Number.isInteger(policy.staleAllowedSeconds) || policy.staleAllowedSeconds < 0) {
    throw new Error("staleAllowedSeconds must be a non-negative integer");
  }
  if (!Number.isInteger(policy.hardExpirySeconds) || policy.hardExpirySeconds < policy.freshTtlSeconds) {
    throw new Error("hardExpirySeconds must be >= freshTtlSeconds");
  }
}

export function classifyFreshness(input: {
  now: Date;
  ingestedAt: Date;
  sourceUpdatedAt?: Date | null;
  sourceTimeTrusted: boolean;
  providerError?: boolean;
  policy: SupplierFreshnessPolicyContract;
}): FreshnessDecision {
  validateFreshnessPolicy(input.policy);
  const baseTime = input.sourceTimeTrusted && input.sourceUpdatedAt ? input.sourceUpdatedAt : input.ingestedAt;
  const freshUntil = new Date(baseTime.getTime() + input.policy.freshTtlSeconds * SECOND_MS);
  const expiresAt = new Date(baseTime.getTime() + input.policy.hardExpirySeconds * SECOND_MS);
  const staleCandidate = input.policy.staleAllowedSeconds > 0
    ? new Date(freshUntil.getTime() + input.policy.staleAllowedSeconds * SECOND_MS)
    : null;
  const staleAllowedUntil = staleCandidate && staleCandidate < expiresAt ? staleCandidate : staleCandidate ? expiresAt : null;
  const nowMs = input.now.getTime();
  const fresh = nowMs <= freshUntil.getTime();
  const staleWindow = staleAllowedUntil != null && nowMs > freshUntil.getTime() && nowMs <= staleAllowedUntil.getTime();
  const hardExpired = nowMs > expiresAt.getTime();

  if (hardExpired) {
    return {
      freshnessClass: "EXPIRED",
      baseTime,
      freshUntil,
      staleAllowedUntil,
      expiresAt,
      checkoutRevalidate: true,
      displayAllowed: false,
      reason: "HARD_EXPIRY_REACHED",
    };
  }

  if (input.providerError && input.policy.providerErrorFallback) {
    const displayAllowed = fresh || (staleWindow && input.policy.staleDisplayAllowed);
    return {
      freshnessClass: "PROVIDER_ERROR_LAST_KNOWN",
      baseTime,
      freshUntil,
      staleAllowedUntil,
      expiresAt,
      checkoutRevalidate: true,
      displayAllowed,
      reason: "PROVIDER_ERROR_USING_BOUNDED_LAST_KNOWN_OFFER",
    };
  }

  if (!input.sourceTimeTrusted || !input.sourceUpdatedAt) {
    const displayAllowed = fresh || (staleWindow && input.policy.staleDisplayAllowed);
    return {
      freshnessClass: "UNKNOWN_SOURCE_TIME",
      baseTime,
      freshUntil,
      staleAllowedUntil,
      expiresAt,
      checkoutRevalidate: true,
      displayAllowed,
      reason: "PROVIDER_SOURCE_TIME_NOT_TRUSTED",
    };
  }

  if (fresh) {
    return {
      freshnessClass: "FRESH",
      baseTime,
      freshUntil,
      staleAllowedUntil,
      expiresAt,
      checkoutRevalidate: input.policy.checkoutRevalidate,
      displayAllowed: true,
      reason: "WITHIN_FRESH_TTL",
    };
  }

  if (staleWindow) {
    return {
      freshnessClass: "STALE_ALLOWED",
      baseTime,
      freshUntil,
      staleAllowedUntil,
      expiresAt,
      checkoutRevalidate: true,
      displayAllowed: input.policy.staleDisplayAllowed,
      reason: "WITHIN_EXPLICIT_STALE_WINDOW",
    };
  }

  return {
    freshnessClass: "EXPIRED",
    baseTime,
    freshUntil,
    staleAllowedUntil,
    expiresAt,
    checkoutRevalidate: true,
    displayAllowed: false,
    reason: "OUTSIDE_DISPLAYABLE_FRESHNESS_WINDOW",
  };
}

function safeRatio(numerator: number, denominator: number): number {
  return denominator <= 0 ? (numerator > 0 ? 1 : 0) : numerator / denominator;
}

export function evaluateSnapshotPublishGate(input: SnapshotPublishInput): SnapshotPublishDecision {
  const minimumFullSnapshotRows = input.minimumFullSnapshotRows ?? 1;
  const maxRejectedRatio = input.maxRejectedRatio ?? 0.05;
  const maxIdentityProblemRatio = input.maxIdentityProblemRatio ?? 0.2;
  const maxFullSnapshotDropRatio = input.maxFullSnapshotDropRatio ?? 0.4;
  const reasons: string[] = [];

  const rejectedRatio = safeRatio(input.recordsRejected, input.recordsReceived);
  const identityProblemRatio = safeRatio(
    input.recordsAmbiguous + input.recordsUnmatched + input.recordsConflict,
    Math.max(input.recordsValid, input.recordsReceived),
  );
  const fullSnapshotDropRatio =
    input.mode === "FULL_SNAPSHOT" && input.previousPublishedCount != null && input.previousPublishedCount > 0
      ? Math.max(0, 1 - input.recordsReceived / input.previousPublishedCount)
      : null;

  const counters = [
    input.recordsReceived,
    input.recordsValid,
    input.recordsMatched,
    input.recordsAmbiguous,
    input.recordsUnmatched,
    input.recordsConflict,
    input.recordsRejected,
  ];
  if (counters.some((value) => !Number.isInteger(value) || value < 0)) reasons.push("INVALID_BATCH_COUNTERS");
  if (input.recordsValid > input.recordsReceived) reasons.push("VALID_COUNT_EXCEEDS_RECEIVED");
  if (input.recordsMatched > input.recordsValid) reasons.push("MATCHED_COUNT_EXCEEDS_VALID");
  if (rejectedRatio > maxRejectedRatio) reasons.push("REJECTED_RATIO_EXCEEDED");
  if (identityProblemRatio > maxIdentityProblemRatio) reasons.push("IDENTITY_PROBLEM_RATIO_EXCEEDED");

  if (input.mode === "FULL_SNAPSHOT") {
    if (input.providerDeclaredComplete !== true) reasons.push("FULL_SNAPSHOT_NOT_DECLARED_COMPLETE");
    if (input.recordsReceived < minimumFullSnapshotRows) reasons.push("FULL_SNAPSHOT_TOO_SMALL");
    if (fullSnapshotDropRatio != null && fullSnapshotDropRatio > maxFullSnapshotDropRatio) {
      reasons.push("FULL_SNAPSHOT_MASS_DROP_GUARD");
    }
  }

  const allowPublish = reasons.length === 0;
  return {
    allowPublish,
    allowMissingOfferDeactivation: allowPublish && input.mode === "FULL_SNAPSHOT" && input.providerDeclaredComplete === true,
    reasons,
    metrics: { rejectedRatio, identityProblemRatio, fullSnapshotDropRatio },
  };
}

export function decideIncomingOrder(input: IncomingOrderDecisionInput): IncomingOrderDecision {
  if (input.currentSemanticHash && input.incomingSemanticHash && input.currentSemanticHash === input.incomingSemanticHash) {
    return { apply: false, idempotent: true, reason: "SEMANTICALLY_IDENTICAL_UPDATE" };
  }

  const currentTrusted = Boolean(input.currentSourceTimeTrusted && input.currentSourceUpdatedAt);
  const incomingTrusted = Boolean(input.incomingSourceTimeTrusted && input.incomingSourceUpdatedAt);

  if (!input.currentSourceUpdatedAt && !input.currentSourceVersion && !input.currentSemanticHash) {
    return { apply: true, idempotent: false, reason: "NO_CURRENT_OFFER_VERSION" };
  }

  if (currentTrusted && !incomingTrusted) {
    return { apply: false, idempotent: false, reason: "UNTRUSTED_UPDATE_CANNOT_OVERWRITE_TRUSTED_PROVIDER_TIME" };
  }

  if (!currentTrusted && incomingTrusted) {
    return { apply: true, idempotent: false, reason: "TRUSTED_PROVIDER_TIME_UPGRADES_UNTRUSTED_CURRENT_STATE" };
  }

  if (currentTrusted && incomingTrusted) {
    const currentMs = input.currentSourceUpdatedAt!.getTime();
    const incomingMs = input.incomingSourceUpdatedAt!.getTime();
    if (incomingMs < currentMs) return { apply: false, idempotent: false, reason: "OUT_OF_ORDER_PROVIDER_TIMESTAMP" };
    if (incomingMs > currentMs) return { apply: true, idempotent: false, reason: "NEWER_PROVIDER_TIMESTAMP" };

    if (input.currentSourceVersion && input.incomingSourceVersion && input.currentSourceVersion === input.incomingSourceVersion) {
      return { apply: false, idempotent: false, reason: "SAME_PROVIDER_TIME_AND_VERSION_DIFFERENT_PAYLOAD" };
    }
    return { apply: false, idempotent: false, reason: "EQUAL_PROVIDER_TIME_REQUIRES_RECONCILIATION" };
  }

  if (input.currentSourceVersion && input.incomingSourceVersion) {
    if (input.currentSourceVersion === input.incomingSourceVersion) {
      return { apply: false, idempotent: false, reason: "SAME_UNORDERED_SOURCE_VERSION_DIFFERENT_PAYLOAD" };
    }
    return { apply: false, idempotent: false, reason: "UNORDERED_SOURCE_VERSION_REQUIRES_RECONCILIATION" };
  }

  return { apply: false, idempotent: false, reason: "INSUFFICIENT_ORDERING_EVIDENCE" };
}

export function deriveAvailability(input: AvailabilityInput): AvailabilityDecision {
  const lowStockThreshold = input.lowStockThreshold ?? 3;
  const qty = asFiniteNumber(input.exactQty);
  if (qty != null) {
    if (qty <= 0) return { state: "OUT_OF_STOCK", quantityMode: "EXACT", exactQty: Math.max(0, qty), band: null };
    if (qty <= lowStockThreshold) return { state: "LOW_STOCK", quantityMode: "EXACT", exactQty: qty, band: null };
    return { state: "AVAILABLE", quantityMode: "EXACT", exactQty: qty, band: null };
  }

  const raw = (input.rawLabel ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  const outOfStockTokens = ["out of stock", "not available", "немає", "нема", "нет в наличии", "відсутній", "відсутня"];
  const availableTokens = ["in stock", "available", "в наявності", "є в наявності", "наявний", "наявна", "в наличии"];
  const orderableTokens = ["orderable", "під замовлення", "під заказ", "на замовлення", "под заказ"];
  const checkTokens = ["check", "уточнюйте", "уточнити", "за запитом", "по запросу"];

  if (outOfStockTokens.some((token) => raw.includes(token))) {
    return { state: "OUT_OF_STOCK", quantityMode: "BOOLEAN_ONLY", exactQty: null, band: raw || null };
  }
  if (availableTokens.some((token) => raw.includes(token))) {
    return { state: "AVAILABLE", quantityMode: "BOOLEAN_ONLY", exactQty: null, band: raw || null };
  }
  if (orderableTokens.some((token) => raw.includes(token)) || input.orderable === true) {
    return { state: "ORDERABLE", quantityMode: "BOOLEAN_ONLY", exactQty: null, band: raw || null };
  }
  if (checkTokens.some((token) => raw.includes(token))) {
    return { state: "CHECK_REQUIRED", quantityMode: "BAND", exactQty: null, band: raw || null };
  }
  if (input.available === true) {
    return { state: "AVAILABLE", quantityMode: "BOOLEAN_ONLY", exactQty: null, band: raw || null };
  }
  if (input.available === false) {
    return { state: "OUT_OF_STOCK", quantityMode: "BOOLEAN_ONLY", exactQty: null, band: raw || null };
  }
  return { state: "UNKNOWN", quantityMode: raw ? "BAND" : "UNKNOWN", exactQty: null, band: raw || null };
}

export function buildOfferKey(input: {
  supplierRecordKey: string;
  externalProductId?: string | null;
  supplierArticle?: string | null;
  warehouseKey?: string | null;
}): string {
  const identity = normalizePartNumber(input.externalProductId) || normalizePartNumber(input.supplierArticle) || normalizePartNumber(input.supplierRecordKey);
  if (!identity) throw new Error("Cannot build offer key without supplier identity");
  const warehouse = normalizePartNumber(input.warehouseKey) || "DEFAULT";
  return `${identity}:${warehouse}`;
}

export function detectPriceAnomaly(input: {
  currentPrice?: number | null;
  incomingPrice?: number | null;
  maxChangeRatio?: number;
}): { anomaly: boolean; changeRatio: number | null; reason: string } {
  const current = asFiniteNumber(input.currentPrice);
  const incoming = asFiniteNumber(input.incomingPrice);
  const maxChangeRatio = input.maxChangeRatio ?? 0.5;

  if (incoming == null || incoming < 0) return { anomaly: true, changeRatio: null, reason: "INVALID_INCOMING_PRICE" };
  if (current == null || current <= 0) return { anomaly: false, changeRatio: null, reason: "NO_COMPARABLE_CURRENT_PRICE" };
  const changeRatio = Math.abs(incoming - current) / current;
  return {
    anomaly: changeRatio > maxChangeRatio,
    changeRatio,
    reason: changeRatio > maxChangeRatio ? "PRICE_CHANGE_THRESHOLD_EXCEEDED" : "PRICE_CHANGE_WITHIN_THRESHOLD",
  };
}
