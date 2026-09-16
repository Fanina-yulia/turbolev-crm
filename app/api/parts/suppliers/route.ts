import { NextResponse } from "next/server";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";
import { enrichOffersWithSellPrice } from "@/src/services/suppliers/order.service";
import { resolvePartFitment } from "@/src/services/parts-fitment.service";
import { normalizePartNeed } from "@/src/services/part-normalization.service";
import { mergeOeNumbers, resolveCuratedOeEvidence } from "@/src/services/parts-oe-evidence.service";
import { searchConfiguredSuppliersOeFirst } from "@/src/services/strict-parts-search.service";

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

  // Normalize first so axis/position are part of fitment, not merely UI text.
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
  const resolvedCanonicalCode = canonicalCode || normalization.genericArticle?.code || normalization.canonicalCode || null;
  const resolvedPartName = normalization.genericArticle?.name || normalization.canonicalName || partName;
  const resolvedAxis = axis || normalization.axis || null;
  const resolvedSide = side || normalization.side || null;
  const resolvedSubPosition = subPosition || normalization.subPosition || null;
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

  const result = await searchConfiguredSuppliersOeFirst(q, 20, {
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
  });
  const offers = await enrichOffersWithSellPrice(result.offers);
  const supplierStatuses = result.supplierStatuses;
  const configuredCount = result.configuredSuppliers.length;
  const respondedCount = result.providers.filter((provider) => provider.ok).length;

  return NextResponse.json({
    status: "OK",
    query: q,
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
    },
    fitment: fitmentPayload,
    catalogMatches: fitment.matches,
    oeNumbers: effectiveOeNumbers,
    catalogArticles: fitment.catalogArticles,
    analogArticles: fitment.analogArticles,
    oeResolution: curatedOe,
    ...result,
    offers,
    suppliers: supplierStatuses,
    supplierStatuses,
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
      message: "Ціна продажу розраховується від закупівельної ціни за правилом постачальника; нульова закупівельна ціна вважається відсутньою. Ручний override фіксується в аудиті.",
    },
    supplierSearchBlocked: result.blocked,
    supplierSearchBlockReason: result.blockReason,
    supplierSearchMode: result.searchMode,
    policy: {
      algorithm: "OE_FIRST_V2",
      priceType: "PURCHASE_PRICE",
      fitmentConfirmed: fitment.confirmed,
      supplierSearchAllowed: !result.blocked,
      message: curatedOe?.reason || fitment.reason,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
