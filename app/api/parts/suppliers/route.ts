import { NextResponse } from "next/server";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";
import { enrichOffersWithSellPrice } from "@/src/services/suppliers/order.service";
import { listSupplierStatuses, searchConfiguredSuppliers } from "@/src/services/suppliers/registry";
import { DEFAULT_MARKUP_PERCENT } from "@/src/services/suppliers/pricing";
import { getConfiguredPartsMarkupPercent } from "@/src/services/suppliers/pricing";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const vin = (searchParams.get("vin") ?? "").trim().toUpperCase();
  const searchMode = searchParams.get("searchMode") === "VIN" && vin.length === 17
    ? "VIN"
    : searchParams.get("searchMode") === "PART_NUMBER" ? "PART_NUMBER" : "TEXT";
  const locationId = searchParams.get("locationId")?.trim() || null;
  const access = await authorizeScopedLocation(PERMISSIONS.PROCUREMENT_READ, request, locationId);
  if (!access.ok) return access.response;

  if (q.length < 2) {
    return NextResponse.json({ status: "INVALID_QUERY", message: "Введіть артикул або назву деталі." }, { status: 400 });
  }

  const [result, suppliers, markupPercent] = await Promise.all([
    searchConfiguredSuppliers(q, 20),
    listSupplierStatuses(),
    getConfiguredPartsMarkupPercent(),
  ]);
  const offers = await enrichOffersWithSellPrice(result.offers);

  return NextResponse.json({
    status: "OK",
    query: q,
    ...result,
    offers,
    suppliers,
    pricing: {
      basis: "CRM_MARKUP_SETTINGS",
      defaultMarkupPercent: markupPercent || DEFAULT_MARKUP_PERCENT,
      message: `Ціна продажу = закупівельна ціна × ${(1 + (markupPercent || DEFAULT_MARKUP_PERCENT) / 100).toFixed(2)}. Націнка береться з Налаштування → Націнка.`,
    },
    policy: {
      priceType: "PURCHASE_PRICE",
      fitmentConfirmed: false,
      message: "Ціна та залишок постачальника не підтверджують сумісність деталі з VIN. Для замовлення потрібне OEM/API підтвердження застосовності.",
      searchMode,
      vinUsed: searchMode === "VIN",
      manualConfirmationRequired: searchMode !== "VIN",
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
