import { getSupplierAdapter, searchConfiguredSuppliers, type SupplierSearchContext } from "@/src/services/suppliers/registry";
import type { SupplierId, SupplierOffer, SupplierVehicleContext } from "@/src/services/suppliers/types";
import {
  applyStrictOfferPolicy,
  compareStrictOffers,
  type StrictOfferContext,
  type StrictOfferDecision,
} from "@/src/services/part-offer-compatibility.service";
import { mergeOeNumbers } from "@/src/services/parts-oe-evidence.service";
import { resolvePartTerminology } from "@/src/services/parts-terminology.service";

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

type ProviderState = { id: SupplierId; ok: boolean; message?: string };

type BmVehicleSearchAudit = {
  attempted: boolean;
  vehicleResolved: boolean;
  resultCount: number;
  message: string | null;
};

function normalizeArticle(value: unknown) {
  return typeof value === "string"
    ? value.trim().toUpperCase().replace(/[^A-ZА-ЯІЇЄҐ0-9]/giu, "")
    : "";
}

function normalizeText(value: unknown) {
  return typeof value === "string"
    ? value.toLocaleUpperCase("uk-UA").replace(/[^A-ZА-ЯІЇЄҐ0-9]+/giu, " ").replace(/\s+/g, " ").trim()
    : "";
}

function offerKey(offer: SupplierOffer) {
  const article = normalizeArticle(offer.article);
  const name = normalizeText(offer.name);
  if (article) return `${offer.supplierId}:${article}:${name}`;
  return `${offer.supplierId}:${offer.externalProductId || name}`;
}

function providerKey(provider: ProviderState) {
  return provider.id;
}

function trustedNumbers(context: OeFirstSupplierSearchContext) {
  return new Set([
    ...(context.oeNumbers || []),
    ...(context.curatedOeNumbers || []),
    ...(context.catalogArticles || []),
    ...(context.analogArticles || []),
  ].map(normalizeArticle).filter(Boolean));
}

function candidateHasTrustedNumber(offer: SupplierOffer, context: OeFirstSupplierSearchContext) {
  const trusted = trustedNumbers(context);
  if (!trusted.size) return false;
  if (trusted.has(normalizeArticle(offer.article))) return true;
  return (offer.oeNumbers || []).some((number) => trusted.has(normalizeArticle(number)));
}

function familyConflictDecision(offer: SupplierOffer, context: OeFirstSupplierSearchContext): StrictOfferDecision | null {
  const requested = context.canonicalCode?.trim().toUpperCase() || "";
  if (!requested || candidateHasTrustedNumber(offer, context)) return null;
  const detected = resolvePartTerminology({ query: offer.name, partName: offer.name });
  const detectedCode = detected.definition?.code?.trim().toUpperCase() || "";
  if (!detectedCode || detected.confidence === "LOW" || detectedCode === requested) return null;
  return {
    accepted: false,
    rejected: true,
    rejectCode: "PART_FAMILY_CONFLICT",
    evidence: "REVIEW",
    compatibilityTier: "UNCONFIRMED",
    score: -850,
    reason: `Позиція відхилена: запит ${requested}, а назва товару однозначно розпізнана як ${detectedCode}.`,
  };
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
    const familyConflict = familyConflictDecision(candidate, context);
    if (familyConflict) {
      rejected.push(familyConflict);
      continue;
    }
    const result = applyStrictOfferPolicy(candidate, strictContext);
    if (!result.offer) {
      rejected.push(result.decision);
      continue;
    }

    // REVIEW means no model/VIN proof exists. Do not expose fitmentExact=false
    // as “model confirmed” in UI; reserve false for PARTIAL model-level evidence.
    const patchedOffer = result.decision.evidence === "REVIEW"
      ? { ...result.offer, fitmentStatus: "MANUAL_REQUIRED" as const, fitmentExact: null }
      : result.offer;
    const key = offerKey(patchedOffer);
    const current = accepted.get(key);
    const next: ProcessedOffer = { offer: patchedOffer, decision: result.decision };
    if (!current || compareStrictOffers(next, current) < 0) accepted.set(key, next);
  }

  const rows = [...accepted.values()].sort(compareStrictOffers);
  return { rows, rejected };
}

function mergeProviders(left: ProviderState[], right: ProviderState[]) {
  const map = new Map<string, ProviderState>();
  for (const item of [...left, ...right]) {
    const key = providerKey(item);
    const existing = map.get(key);
    if (!existing || (!existing.ok && item.ok)) map.set(key, item);
  }
  return [...map.values()];
}

function mergeProcessedRows(...groups: ProcessedOffer[][]) {
  const merged = new Map<string, ProcessedOffer>();
  for (const row of groups.flat()) {
    const key = offerKey(row.offer);
    const current = merged.get(key);
    if (!current || compareStrictOffers(row, current) < 0) merged.set(key, row);
  }
  return [...merged.values()].sort(compareStrictOffers);
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

async function resolveBmVehicle(context: OeFirstSupplierSearchContext): Promise<SupplierVehicleContext | null> {
  if (context.providerVehicle?.provider === "bm-parts") return context.providerVehicle;
  const adapter = getSupplierAdapter("bm-parts");
  if (!adapter?.resolveVehicle || !(await adapter.isConfigured())) return null;
  const identifiers = [context.vin, context.plate].map((value) => value?.trim() || "").filter((value) => value.length >= 3);
  for (const identifier of identifiers) {
    try {
      const vehicle = await adapter.resolveVehicle(identifier);
      if (vehicle) return vehicle;
    } catch {
      // Generic supplier search remains available.
    }
  }
  return null;
}

async function searchBmVehicleEvidence(
  query: string,
  limit: number,
  context: OeFirstSupplierSearchContext,
): Promise<{ offers: SupplierOffer[]; provider: ProviderState | null; audit: BmVehicleSearchAudit }> {
  const adapter = getSupplierAdapter("bm-parts");
  const emptyAudit: BmVehicleSearchAudit = { attempted: false, vehicleResolved: false, resultCount: 0, message: null };
  if (!adapter?.searchVehicleParts || !(await adapter.isConfigured())) return { offers: [], provider: null, audit: emptyAudit };
  const vehicle = await resolveBmVehicle(context);
  if (!vehicle) {
    return {
      offers: [],
      provider: { id: "bm-parts", ok: true, message: "BM Parts відповів, але vehicle context для model-scoped пошуку не визначено." },
      audit: { attempted: true, vehicleResolved: false, resultCount: 0, message: "vehicle context не визначено" },
    };
  }

  const position = [context.requestedAxis || context.axis, context.side, context.subPosition, context.position]
    .map((value) => value?.trim() || "")
    .filter(Boolean)
    .filter((value, index, rows) => rows.indexOf(value) === index)
    .join(" ") || null;

  try {
    const scoped = await adapter.searchVehicleParts({
      query: context.partName?.trim() || query.trim(),
      vehicle,
      limit: Math.min(Math.max(limit, 1), 50),
      position,
      canonicalPart: context.canonicalCode || context.partName
        ? {
            code: context.canonicalCode || null,
            name: context.partName || query,
            genericArticleId: context.genericArticleId || null,
          }
        : null,
    });
    const offers = scoped.map((row) => row.offer);
    return {
      offers,
      provider: { id: "bm-parts", ok: true },
      audit: { attempted: true, vehicleResolved: true, resultCount: offers.length, message: offers.length ? null : "vehicle-scoped пошук не повернув позицій" },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Помилка BM Parts vehicle search";
    return {
      offers: [],
      provider: { id: "bm-parts", ok: false, message },
      audit: { attempted: true, vehicleResolved: true, resultCount: 0, message },
    };
  }
}

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

  const [primary, bmVehicle] = await Promise.all([
    searchConfiguredSuppliers(primarySeed, limitPerSupplier, strictContext),
    searchBmVehicleEvidence(query, limitPerSupplier, strictContext),
  ]);
  const processedPrimary = processOffers(primary.offers, strictContext, query);
  const processedBm = processOffers(bmVehicle.offers, { ...strictContext, providerVehicle: context.providerVehicle || null }, query);
  const primaryStrong = processedPrimary.rows.filter((row) => row.decision.evidence !== "REVIEW");

  let fallbackUsed = false;
  let providers = bmVehicle.provider ? mergeProviders(primary.providers, [bmVehicle.provider]) : primary.providers;
  let rejected = [...processedPrimary.rejected, ...processedBm.rejected];
  let rows = evidenceDriven && primaryStrong.length > 0 ? primaryStrong : processedPrimary.rows;
  rows = mergeProcessedRows(rows, processedBm.rows);
  let fallbackSearchMode: string | null = null;

  if (evidenceDriven && primaryStrong.length === 0 && query.trim() && normalizeArticle(query) !== normalizeArticle(primarySeed)) {
    fallbackUsed = true;
    const fallback = await searchConfiguredSuppliers(query, limitPerSupplier, {
      ...context,
      oeNumbers: effectiveOeNumbers,
    });
    fallbackSearchMode = fallback.searchMode;
    providers = mergeProviders(providers, fallback.providers);
    const processedFallback = processOffers(fallback.offers, strictContext, query);
    rejected.push(...processedFallback.rejected);
    rows = mergeProcessedRows(rows, processedFallback.rows);
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
    searchMode: evidenceDriven ? "OE_FIRST_CASCADE" : bmVehicle.audit.resultCount > 0 ? "VEHICLE_MODEL_CASCADE" : primary.searchMode,
    strictSearch: {
      algorithm: "OE_FIRST_V3",
      evidenceDriven,
      primarySeed: primarySeed || null,
      effectiveOeNumbers,
      fallbackUsed,
      fallbackSearchMode,
      bmVehicleSearch: bmVehicle.audit,
      rejectedCount: rejected.length,
      rejectedByCode,
      strongResultCount: rows.filter((row) => row.decision.evidence !== "REVIEW").length,
      reviewResultCount: rows.filter((row) => row.decision.evidence === "REVIEW").length,
    },
  };
}
