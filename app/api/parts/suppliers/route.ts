import { NextResponse } from "next/server";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";
import { enrichOffersWithSellPrice } from "@/src/services/suppliers/order.service";
import { listSupplierStatuses, searchConfiguredSuppliers } from "@/src/services/suppliers/registry";
import { resolvePartFitment } from "@/src/services/parts-fitment.service";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const locationId = searchParams.get("locationId")?.trim() || null;
  const vehicleId = searchParams.get("vehicleId")?.trim() || null;
  const vin = searchParams.get("vin")?.trim() || null;
  const partName = searchParams.get("partName")?.trim() || q;
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
    position,
    genericArticleId,
    vehicleId,
    vin,
  });
  const [result, suppliers] = await Promise.all([
    searchConfiguredSuppliers(q, 20, {
      fitmentStatus: fitment.status,
      fitmentConfidence: fitment.confidence,
      fitmentSource: fitment.catalog?.source || null,
      fitmentReason: fitment.reason,
      catalogArticles: fitment.catalogArticles,
      analogArticles: fitment.analogArticles,
      oeNumbers: [...new Set([...fitment.oeNumbers, ...oeNumbers])],
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
    context: { vehicleId, vin, partName, position },
    fitment: {
      status: fitment.status,
      confirmed: fitment.confirmed,
      confidence: fitment.confidence,
      reason: fitment.reason,
      vehicle: fitment.vehicle,
      catalog: fitment.catalog,
      genericArticle: fitment.genericArticle,
    },
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
        ? \`\${configuredCount} постачальник(и) мають збережені доступи; результат відповіді видно після пошуку.\`
        : "Постачальники додані, але доступи до API ще не налаштовані.",
    },
    pricing: {
      basis: "SUPPLIER_DEFAULT_MARKUP",
      defaultMarkupPercent: 40,
      message: "Ціна продажу розраховується від закупівельної ціни за правилом постачальника; базове правило Turbo LEV — 40%. Ручний override фіксується в аудиті під час створення supplier order draft.",
    },
    policy: {
      priceType: "PURCHASE_PRICE",
      fitmentConfirmed: fitment.confirmed,
      message: fitment.reason,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
