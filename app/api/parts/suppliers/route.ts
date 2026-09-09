import { NextResponse } from "next/server";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";
import { enrichOffersWithSellPrice } from "@/src/services/suppliers/order.service";
import { evaluateSupplierSearchPolicy, listSupplierStatuses, searchConfiguredSuppliers } from "@/src/services/suppliers/registry";
import { resolvePartFitment } from "@/src/services/parts-fitment.service";
import { normalizePartNeed } from "@/src/services/part-normalization.service";

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
  const oeNumbers = [...new Set((searchParams.get("oeNumbers") || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length >= 2)
    .slice(0, 20))];

  const access = await authorizeScopedLocation(PERMISSIONS.PROCUREMENT_READ, request, locationId);
  if (!access.ok) return access.response;

  if (q.length < 2) {
    return NextResponse.json({ status: "INVALID_QUERY", message: "Введіть артикул або назву деталі." }, { status: 400 });
  }

  const fitment = await resolvePartFitment({
    query: q,
    partName,
    canonicalCode,
    axis,
    position,
    side,
    subPosition,
    genericArticleId,
    vehicleId,
    vin,
    plate,
  });
  const normalization = await normalizePartNeed({ query: q, partName, canonicalCode, genericArticleId, position, axis, side, subPosition });
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
  const supplierPolicy = evaluateSupplierSearchPolicy({
    vehicleId: vehicleId || fitment.vehicle?.id || null,
    vin: vin || fitment.vehicle?.vin || null,
    plate,
    fitmentStatus: fitment.status,
    fitmentReason: fitment.reason,
  });
  if (!supplierPolicy.allowed) {
    const message = supplierPolicy.reason || "Запит до постачальників не відправлено: для цього автомобіля немає підтвердженого зв’язку з OE-каталогом.";
    return NextResponse.json({
      status: "CATALOG_REQUIRED",
      query: q,
      context: { vehicleId, vin, plate, partName, canonicalCode, axis, side, subPosition, position },
      fitment: fitmentPayload,
      catalogMatches: fitment.matches,
      oeNumbers: fitment.oeNumbers,
      catalogArticles: fitment.catalogArticles,
      analogArticles: fitment.analogArticles,
      normalization,
      offers: [],
      providers: [],
      configuredSuppliers: [],
      supplierStatuses: [],
      suppliers: [],
      supplierSummary: {
        added: 0,
        configured: 0,
        responded: 0,
        blocked: true,
        message,
      },
      supplierSearchBlocked: true,
      supplierSearchBlockReason: message,
      pricing: {
        basis: "SUPPLIER_DEFAULT_MARKUP",
        defaultMarkupPercent: 40,
        message: "Пошук постачальників заблокований до підтвердження сумісності через OE-каталог.",
      },
      policy: {
        priceType: "PURCHASE_PRICE",
        fitmentConfirmed: false,
        supplierSearchAllowed: false,
        message,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  }
  const [result, suppliers] = await Promise.all([
    searchConfiguredSuppliers(q, 20, {
      vehicleId,
      vin,
      plate,
      fitmentStatus: fitment.status,
      fitmentConfidence: fitment.confidence,
      fitmentExact: fitment.exact,
      fitmentSource: fitment.catalog?.source || null,
      fitmentReason: fitment.reason,
      providerVehicle: fitment.providerVehicle,
      catalogMatches: fitment.matches.map((match) => ({
        article: match.article,
        offerClass: match.offerClass,
        oeNumbers: match.oeNumbers,
        analogOfArticle: match.analogOfArticle || null,
      })),
      partName,
      canonicalCode,
      axis,
      side,
      subPosition,
      position,
      genericArticleId,
      catalogArticles: fitment.catalogArticles,
      analogArticles: fitment.analogArticles,
      oeNumbers: [...new Set([...fitment.oeNumbers, ...oeNumbers])],
      normalizedQuery: normalization.normalizedQuery,
      analogReferences: fitment.matches
        .filter((match) => match.offerClass === "OEM")
        .map((match) => ({ brand: match.brand, article: match.article }))
        .slice(0, 8),
    }),
    listSupplierStatuses(),
  ]);
  const offers = await enrichOffersWithSellPrice(result.offers);
  const supplierStatuses = result.supplierStatuses;
  const configuredCount = supplierStatuses.filter((supplier) => supplier.configured).length;
  const respondedCount = result.providers.filter((provider) => provider.ok).length;

  return NextResponse.json({
    status: "OK",
    query: q,
    context: { vehicleId, vin, plate, partName, canonicalCode, axis, side, subPosition, position },
    fitment: fitmentPayload,
    catalogMatches: fitment.matches,
    oeNumbers: fitment.oeNumbers,
    catalogArticles: fitment.catalogArticles,
    analogArticles: fitment.analogArticles,
    ...result,
    offers,
    suppliers,
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
      message: "Ціна продажу розраховується від закупівельної ціни за правилом постачальника; базове правило Turbo LEV — 40%. Ручний override фіксується в аудиті під час створення supplier order draft.",
    },
    supplierSearchBlocked: result.blocked,
    supplierSearchBlockReason: result.blockReason,
    policy: {
      priceType: "PURCHASE_PRICE",
      fitmentConfirmed: fitment.confirmed,
      supplierSearchAllowed: !result.blocked,
      message: fitment.reason,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
