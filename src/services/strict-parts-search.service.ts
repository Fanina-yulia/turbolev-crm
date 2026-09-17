import { searchConfiguredSuppliers, type SupplierSearchContext } from "@/src/services/suppliers/registry";
import type { SupplierId, SupplierOffer } from "@/src/services/suppliers/types";
import {
  applyStrictOfferPolicy,
  compareStrictOffers,
  type StrictOfferContext,
  type StrictOfferDecision,
} from "@/src/services/part-offer-compatibility.service";
import { mergeOeNumbers } from "@/src/services/parts-oe-evidence.service";
import { PARTS_SEARCH_V3_ALGORITHM } from "@/src/services/part-search-intent-v3.service";

export type OeFirstSupplierSearchContext = SupplierSearchContext & {
  vehicleBrand?: string | null;
  vehicleModel?: string | null;
  vehicleYear?: number | null;
  requestedAxis?: string | null;
  requestedSide?: string | null;
  curatedOeNumbers?: string[];
  knownRejectedArticles?: string[];
};

type ProcessedOffer = {
  offer: SupplierOffer;
  decision: StrictOfferDecision;
};

type AuditDecisionRow = {
  offer: SupplierOffer;
  decision: StrictOfferDecision;
};

function normalizeArticle(value: unknown) {
  return typeof value === "string"
    ? value.trim().toUpperCase().replace(/[^A-ZА-ЯІЇЄҐ0-9]/giu, "")
    : "";
}

function offerKey(offer: SupplierOffer) {
  const brand = normalizeArticle(offer.brand);
  const article = normalizeArticle(offer.article);
  if (article) return `${offer.supplierId}:${brand}:${article}`;
  return `${offer.supplierId}:${offer.externalProductId || offer.name}`;
}

function providerKey(provider: { id: SupplierId; ok: boolean; message?: string }) {
  return provider.id;
}

function buildStrictContext(context: OeFirstSupplierSearchContext, query: string): StrictOfferContext {
  return {
    query,
    partName: context.partName,
    canonicalCode: context.canonicalCode,
    axis: context.requestedAxis || context.axis,
    side: context.requestedSide || context.side,
    position: context.position,
    vehicleBrand: context.vehicleBrand || context.providerVehicle?.brand || null,
    vehicleModel: context.vehicleModel || context.providerVehicle?.model || null,
    vehicleYear: context.vehicleYear || null,
    fitmentConfirmed: context.fitmentStatus === "VERIFIED",
    fitmentExact: context.fitmentExact,
    oeNumbers: context.oeNumbers,
    curatedOeNumbers: context.curatedOeNumbers,
    catalogArticles: context.catalogArticles,
    analogArticles: context.analogArticles,
    knownRejectedArticles: context.knownRejectedArticles,
  };
}

function processOffers(
  offers: SupplierOffer[],
  context: OeFirstSupplierSearchContext,
  query: string,
) {
  const strictContext = buildStrictContext(context, query);
  const accepted = new Map<string, ProcessedOffer>();
  const auditDecisions: AuditDecisionRow[] = [];

  for (const candidate of offers) {
    const result = applyStrictOfferPolicy(candidate, strictContext);
    auditDecisions.push({ offer: candidate, decision: result.decision });
    if (!result.offer) continue;
    const key = offerKey(result.offer);
    const current = accepted.get(key);
    const next: ProcessedOffer = { offer: result.offer, decision: result.decision };
    if (!current || compareStrictOffers(next, current) < 0) accepted.set(key, next);
  }

  return {
    rows: [...accepted.values()].sort(compareStrictOffers),
    auditDecisions,
  };
}

function mergeProviders(
  left: Array<{ id: SupplierId; ok: boolean; message?: string }>,
  right: Array<{ id: SupplierId; ok: boolean; message?: string }>,
) {
  const map = new Map<string, { id: SupplierId; ok: boolean; message?: string }>();
  for (const item of [...left, ...right]) {
    const key = providerKey(item);
    const existing = map.get(key);
    if (!existing || (!existing.ok && item.ok)) map.set(key, item);
  }
  return [...map.values()];
}

function buildResultSummary(offers: SupplierOffer[]) {
  const supported = offers.filter((offer) => offer.compatibilityTier === "PARTIAL").length;
  return {
    total: offers.length,
    originals: offers.filter((offer) => offer.resultType === "ORIGINAL").length,
    oemReplacements: offers.filter((offer) => offer.resultType === "OEM_REPLACEMENT").length,
    analogs: offers.filter((offer) => offer.resultType === "ANALOG").length,
    assemblies: offers.filter((offer) => offer.resultType === "ASSEMBLY").length,
    unknown: offers.filter((offer) => !offer.resultType || offer.resultType === "UNKNOWN").length,
    confirmed: offers.filter((offer) => offer.compatibilityTier === "CONFIRMED").length,
    supported,
    partial: supported,
    reviewRequired: offers.filter((offer) => offer.compatibilityTier === "REVIEW_REQUIRED").length,
  };
}

function onlyStrongWhenAvailable(rows: ProcessedOffer[]) {
  const strong = rows.filter((row) => row.decision.evidence !== "REVIEW");
  return strong.length ? strong : rows;
}

/**
 * TURBO LEV Parts Search V3 orchestration.
 *
 * 1) Evidence (VIN/OE/catalog/cross) is always searched before free text.
 * 2) Universal family/vehicle/axis/side guards run on every supplier row.
 * 3) Explicit contradictions are hard-rejected and cannot be restored by a
 *    manager checkbox or by a cheaper price.
 * 4) When strong evidence exists, fuzzy REVIEW rows are suppressed from the
 *    operational result set. They remain in the audit decisions only.
 */
export async function searchConfiguredSuppliersOeFirst(
  query: string,
  limitPerSupplier = 20,
  context: OeFirstSupplierSearchContext = {},
) {
  const effectiveOeNumbers = mergeOeNumbers(context.oeNumbers, context.curatedOeNumbers);
  const evidenceSeeds = mergeOeNumbers(
    effectiveOeNumbers,
    context.catalogArticles,
    context.analogArticles,
  );
  const evidenceDriven = evidenceSeeds.length > 0;
  const primarySeed = evidenceSeeds[0] || query.trim();
  const strictContext: OeFirstSupplierSearchContext = {
    ...context,
    oeNumbers: effectiveOeNumbers,
    normalizedQuery: evidenceDriven ? primarySeed : context.normalizedQuery,
  };

  const primary = await searchConfiguredSuppliers(primarySeed, limitPerSupplier, strictContext);
  const processedPrimary = processOffers(primary.offers, strictContext, query);
  let rows = evidenceDriven ? onlyStrongWhenAvailable(processedPrimary.rows) : processedPrimary.rows;
  let providers = primary.providers;
  let fallbackUsed = false;
  let fallbackSearchMode: string | null = null;
  let auditDecisions = [...processedPrimary.auditDecisions];

  const primaryStrong = processedPrimary.rows.some((row) => row.decision.evidence !== "REVIEW");
  if (evidenceDriven && !primaryStrong && query.trim() && normalizeArticle(query) !== normalizeArticle(primarySeed)) {
    fallbackUsed = true;
    const fallback = await searchConfiguredSuppliers(query, limitPerSupplier, {
      ...context,
      oeNumbers: effectiveOeNumbers,
    });
    fallbackSearchMode = fallback.searchMode;
    providers = mergeProviders(primary.providers, fallback.providers);
    const processedFallback = processOffers(fallback.offers, strictContext, query);
    auditDecisions = [...auditDecisions, ...processedFallback.auditDecisions];

    const merged = new Map<string, ProcessedOffer>();
    for (const row of [...processedPrimary.rows, ...processedFallback.rows]) {
      const key = offerKey(row.offer);
      const current = merged.get(key);
      if (!current || compareStrictOffers(row, current) < 0) merged.set(key, row);
    }
    rows = onlyStrongWhenAvailable([...merged.values()].sort(compareStrictOffers));
  }

  const offers = rows.map((row) => row.offer)
    .slice(0, Math.max(limitPerSupplier * Math.max(primary.configuredSuppliers.length, 1), 40));
  const rejected = auditDecisions.filter((item) => item.decision.rejected);
  const rejectedByCode = rejected.reduce<Record<string, number>>((acc, item) => {
    const code = item.decision.rejectCode || "OTHER";
    acc[code] = (acc[code] || 0) + 1;
    return acc;
  }, {});
  const strongResultCount = rows.filter((row) => row.decision.evidence !== "REVIEW").length;
  const reviewResultCount = rows.filter((row) => row.decision.evidence === "REVIEW").length;

  return {
    ...primary,
    offers,
    providers,
    resultSummary: buildResultSummary(offers),
    searchMode: evidenceDriven ? "EVIDENCE_FIRST_CASCADE" : primary.searchMode,
    strictSearch: {
      algorithm: PARTS_SEARCH_V3_ALGORITHM,
      evidenceDriven,
      primarySeed: primarySeed || null,
      effectiveOeNumbers,
      fallbackUsed,
      fallbackSearchMode,
      rejectedCount: rejected.length,
      rejectedByCode,
      strongResultCount,
      reviewResultCount,
      fuzzySuppressed: strongResultCount > 0 && auditDecisions.some((item) => item.decision.evidence === "REVIEW" && !item.decision.rejected),
    },
    auditDecisions,
  };
}
