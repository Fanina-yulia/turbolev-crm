import { searchConfiguredSuppliers, type SupplierSearchContext } from "@/src/services/suppliers/registry";
import type { SupplierId, SupplierOffer } from "@/src/services/suppliers/types";
import {
  applyStrictOfferPolicy,
  compareStrictOffers,
  type StrictOfferContext,
  type StrictOfferDecision,
} from "@/src/services/part-offer-compatibility.service";
import { mergeOeNumbers } from "@/src/services/parts-oe-evidence.service";

export type OeFirstSupplierSearchContext = SupplierSearchContext & {
  vehicleBrand?: string | null;
  vehicleModel?: string | null;
  vehicleYear?: number | null;
  requestedAxis?: string | null;
  curatedOeNumbers?: string[];
};

type ProcessedOffer = {
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

function processOffers(
  offers: SupplierOffer[],
  context: OeFirstSupplierSearchContext,
  query: string,
) {
  const strictContext: StrictOfferContext = {
    query,
    partName: context.partName,
    canonicalCode: context.canonicalCode,
    axis: context.requestedAxis || context.axis,
    position: context.position,
    vehicleBrand: context.vehicleBrand || context.providerVehicle?.brand || null,
    vehicleModel: context.vehicleModel || context.providerVehicle?.model || null,
    fitmentConfirmed: context.fitmentStatus === "VERIFIED",
    fitmentExact: context.fitmentExact,
    oeNumbers: context.oeNumbers,
    curatedOeNumbers: context.curatedOeNumbers,
    catalogArticles: context.catalogArticles,
    analogArticles: context.analogArticles,
  };

  const accepted = new Map<string, ProcessedOffer>();
  const rejected: StrictOfferDecision[] = [];

  for (const candidate of offers) {
    const result = applyStrictOfferPolicy(candidate, strictContext);
    if (!result.offer) {
      rejected.push(result.decision);
      continue;
    }
    const key = offerKey(result.offer);
    const current = accepted.get(key);
    const next: ProcessedOffer = { offer: result.offer, decision: result.decision };
    if (!current || compareStrictOffers(next, current) < 0) accepted.set(key, next);
  }

  const rows = [...accepted.values()].sort(compareStrictOffers);
  return { rows, rejected };
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
  return {
    total: offers.length,
    originals: offers.filter((offer) => offer.resultType === "ORIGINAL").length,
    oemReplacements: offers.filter((offer) => offer.resultType === "OEM_REPLACEMENT").length,
    analogs: offers.filter((offer) => offer.resultType === "ANALOG").length,
    assemblies: offers.filter((offer) => offer.resultType === "ASSEMBLY").length,
    unknown: offers.filter((offer) => !offer.resultType || offer.resultType === "UNKNOWN").length,
    confirmed: offers.filter((offer) => offer.compatibilityTier === "CONFIRMED").length,
    partial: offers.filter((offer) => offer.compatibilityTier === "PARTIAL").length,
    reviewRequired: offers.filter((offer) => offer.compatibilityTier === "REVIEW_REQUIRED").length,
  };
}

/**
 * OE-first orchestration rules:
 * 1) Search by OE/catalog evidence first.
 * 2) Hard-reject contradictory axle/vehicle/part-family rows.
 * 3) If strong OE/cross/model evidence exists, suppress fuzzy REVIEW rows.
 * 4) Only when evidence search yields no strong rows, run the free-text fallback.
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
  const primaryStrong = processedPrimary.rows.filter((row) => row.decision.evidence !== "REVIEW");

  let fallbackUsed = false;
  let providers = primary.providers;
  let rejected = [...processedPrimary.rejected];
  let rows = processedPrimary.rows;
  let fallbackSearchMode: string | null = null;

  if (evidenceDriven && primaryStrong.length > 0) {
    rows = primaryStrong;
  } else if (evidenceDriven && query.trim() && normalizeArticle(query) !== normalizeArticle(primarySeed)) {
    fallbackUsed = true;
    const fallback = await searchConfiguredSuppliers(query, limitPerSupplier, {
      ...context,
      oeNumbers: effectiveOeNumbers,
    });
    fallbackSearchMode = fallback.searchMode;
    providers = mergeProviders(primary.providers, fallback.providers);
    const processedFallback = processOffers(fallback.offers, strictContext, query);
    rejected.push(...processedFallback.rejected);

    const merged = new Map<string, ProcessedOffer>();
    for (const row of [...rows, ...processedFallback.rows]) {
      const key = offerKey(row.offer);
      const current = merged.get(key);
      if (!current || compareStrictOffers(row, current) < 0) merged.set(key, row);
    }
    rows = [...merged.values()].sort(compareStrictOffers);
  }

  const offers = rows.map((row) => row.offer)
    .slice(0, Math.max(limitPerSupplier * Math.max(primary.configuredSuppliers.length, 1), 40));
  const rejectedByCode = rejected.reduce<Record<string, number>>((acc, item) => {
    const code = item.rejectCode || "OTHER";
    acc[code] = (acc[code] || 0) + 1;
    return acc;
  }, {});

  return {
    ...primary,
    offers,
    providers,
    resultSummary: buildResultSummary(offers),
    searchMode: evidenceDriven ? "OE_FIRST_CASCADE" : primary.searchMode,
    strictSearch: {
      algorithm: "OE_FIRST_V2",
      evidenceDriven,
      primarySeed: primarySeed || null,
      effectiveOeNumbers,
      fallbackUsed,
      fallbackSearchMode,
      rejectedCount: rejected.length,
      rejectedByCode,
      strongResultCount: rows.filter((row) => row.decision.evidence !== "REVIEW").length,
      reviewResultCount: rows.filter((row) => row.decision.evidence === "REVIEW").length,
    },
  };
}
