import { NextResponse } from "next/server";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";
import { enrichOffersWithSellPrice } from "@/src/services/suppliers/order.service";
import { resolvePartFitment } from "@/src/services/parts-fitment.service";
import { normalizePartNeed } from "@/src/services/part-normalization.service";
import { mergeOeNumbers, resolveCuratedOeEvidence } from "@/src/services/parts-oe-evidence.service";
import { resolvePositionPolicyV3 } from "@/src/services/part-search-intent-v3.service";
import { searchPartsV3 } from "@/src/services/parts-search-v3.service";
import { aggregatePartCandidates } from "@/src/services/parts-candidate-aggregator.service";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const locationId = searchParams.get("locationId")?.trim() || null;
  const vehicleId = searchParams.get("vehicleId")?.trim() || null;
  const plate = searchParams.get("plate")?.trim() || null;
  const vin = searchParams.get("vin")?.trim() || null;
  const partName = searchParams.get("partName")?.trim() || q;
  const canonicalCode = searchParams.get("canonicalCode")?.trim() || null;
  const axis = searchParams.get("axis")?.trim() || null;
  const side = searchParams.get("side")?.trim() || null;
  const subPosition = searchParams.get("subPosition")?.trim() || null;
  const position = searchParams.get("position")?.trim() || null;
  const genericArticleId = searchParams.get("genericArticleId")?.trim() || null;
  const quantity = Number(searchParams.get("quantity") || 1);
  const sourceId = searchParams.get("findingId")?.trim() || searchParams.get("manualPartId")?.trim() || null;
  const requestedOeNumbers = [...new Set((searchParams.get("oeNumbers") || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length >= 2)
    .slice(0, 20))];

  const access = await authorizeScopedLocation(PERMISSIONS.PROCUREMENT_READ, request, locationId);
  if (!access.ok) return access.response;

  if (q.length < 2) {
    return NextResponse.json({ status: "INVALID_QUERY", message: "Введіть артикул або назву деталі." }, { status: 400 });
  }

  const normalization = await normalizePartNeed({
    query: q,
    partName,
    canonicalCode,
    genericArticleId,
    position,
    axis,
    side,
    subPosition,
  });
  const resolvedGenericArticleId = genericArticleId || normalization.genericArticle?.id || null;
  const preliminaryCanonicalCode = canonicalCode || normalization.genericArticle?.code || normalization.canonicalCode || null;
  const preliminaryPartName = normalization.genericArticle?.name || normalization.canonicalName || partName;
  const positionPolicy = resolvePositionPolicyV3({
    canonicalCode: preliminaryCanonicalCode,
    partName: preliminaryPartName,
    axis: axis || normalization.axis,
    side: side || normalization.side,
    subPosition: subPosition || normalization.subPosition,
    position: position || normalization.position,
    quantity,
  });
  const resolvedCanonicalCode = positionPolicy.canonicalCode;
  const resolvedPartName = positionPolicy.canonicalName || preliminaryPartName;
  const resolvedAxis = positionPolicy.axis;
  const resolvedSide = positionPolicy.side;
  const resolvedSubPosition = positionPolicy.subPosition;
  const resolvedPosition = position || normalization.position || null;

  const fitment = await resolvePartFitment({
    query: q,
    partName: resolvedPartName,
    canonicalCode: resolvedCanonicalCode,
    axis: resolvedAxis,
    position: resolvedPosition || resolvedAxis,
    side: resolvedSide,
    subPosition: resolvedSubPosition,
    genericArticleId: resolvedGenericArticleId,
    vehicleId,
    vin,
    plate,
  });

  const curatedOe = resolveCuratedOeEvidence({
    vehicle: fitment.vehicle,
    canonicalCode: resolvedCanonicalCode,
    partName: resolvedPartName,
    axis: resolvedAxis,
    position: resolvedPosition,
  });
  const effectiveOeNumbers = mergeOeNumbers(
    fitment.oeNumbers,
    requestedOeNumbers,
    curatedOe?.oeNumbers,
  );

  const fitmentPayload = {
    status: fitment.status,
    confirmed: fitment.confirmed,
    confidence: fitment.confidence,
    exact: fitment.exact,
    reason: fitment.reason,
    vehicle: fitment.vehicle,
    providerVehicle: fitment.providerVehicle,
    catalog: fitment.catalog,
    genericArticle: fitment.genericArticle,
    normalization,
  };

  const result = await searchPartsV3(q, 20, {
    vehicleId,
    vin,
    plate,
    fitmentStatus: fitment.status,
    fitmentConfidence: fitment.confidence,
    fitmentExact: fitment.exact,
    fitmentSource: fitment.catalog?.source || curatedOe?.source || null,
    fitmentReason: fitment.reason,
    providerVehicle: fitment.providerVehicle,
    fitmentOffers: fitment.matches.flatMap((match) => match.offer ? [match.offer] : []),
    partName: resolvedPartName,
    canonicalCode: resolvedCanonicalCode,
    axis: resolvedAxis,
    requestedAxis: resolvedAxis,
    side: resolvedSide,
    requestedSide: resolvedSide,
    subPosition: resolvedSubPosition,
    position: resolvedPosition,
    genericArticleId: resolvedGenericArticleId,
    catalogArticles: fitment.catalogArticles,
    analogArticles: fitment.analogArticles,
    oeNumbers: effectiveOeNumbers,
    curatedOeNumbers: curatedOe?.oeNumbers || [],
    normalizedQuery: normalization.normalizedQuery,
    analogReferences: fitment.matches.map((match) => ({ brand: match.brand, article: match.article })).slice(0, 8),
    vehicleBrand: fitment.vehicle?.brand || null,
    vehicleModel: fitment.vehicle?.model || null,
    vehicleYear: fitment.vehicle?.year || null,
    quantity,
    sourceType: sourceId ? "DIAGNOSTIC" : "MANUAL_SEARCH",
    sourceId,
  });
  const offers = await enrichOffersWithSellPrice(result.offers);
  const candidates = aggregatePartCandidates(offers);
  const supplierStatuses = result.supplierStatuses;
  const configuredCount = result.configuredSuppliers.length;
  const respondedCount = result.providers.filter((provider) => provider.ok).length;

  return NextResponse.json({
    status: "OK",
    query: q,
    searchId: result.searchId,
    algorithm: result.algorithm,
    intent: result.intent,
    context: {
      vehicleId,
      vin,
      plate,
      partName: resolvedPartName,
      canonicalCode: resolvedCanonicalCode,
      genericArticleId: resolvedGenericArticleId,
      axis: resolvedAxis,
      side: resolvedSide,
      subPosition: resolvedSubPosition,
      position: resolvedPosition,
      quantity,
      packageScope: positionPolicy.packageRule.coverage,
      sideIgnoredByCommercialScope: positionPolicy.sideIgnoredByCommercialScope,
    },
    fitment: fitmentPayload,
    catalogMatches: fitment.matches,
    oeNumbers: effectiveOeNumbers,
    catalogArticles: fitment.catalogArticles,
    analogArticles: fitment.analogArticles,
    oeResolution: curatedOe,
    candidates,
    offers,
    suppliers: supplierStatuses,
    supplierStatuses,
    configuredSuppliers: result.configuredSuppliers,
    providers: result.providers,
    supplierResultSummary: result.resultSummary,
    supplierCascade: result.cascade,
    strictSearch: result.strictSearch,
    supplierSummary: {
      added: supplierStatuses.length,
      configured: configuredCount,
      responded: respondedCount,
      message: configuredCount
        ? configuredCount + " постачальник(и) мають збережені доступи; результат відповіді видно після пошуку."
        : "Постачальники додані, але доступи до API ще не налаштовані.",
    },
    pricing: {
      basis: "SUPPLIER_DEFAULT_MARKUP",
      defaultMarkupPercent: 40,
      message: "Ціна застосовується тільки після compatibility policy; нульова закупівельна ціна вважається відсутньою.",
    },
    supplierSearchBlocked: result.blocked,
    supplierSearchBlockReason: result.blockReason,
    supplierSearchMode: result.searchMode,
    policy: {
      ...result.policy,
      algorithm: result.algorithm,
      priceType: "PURCHASE_PRICE",
      fitmentConfirmed: fitment.confirmed,
      supplierSearchAllowed: !result.blocked,
      message: curatedOe?.reason || fitment.reason,
    },
    timings: result.timings,
  }, { headers: { "Cache-Control": "no-store" } });
}
