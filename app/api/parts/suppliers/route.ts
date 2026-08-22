import { NextResponse } from "next/server";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";
import { enrichOffersWithSellPrice } from "@/src/services/suppliers/order.service";
import { listSupplierStatuses, searchConfiguredSuppliers } from "@/src/services/suppliers/registry";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const locationId = searchParams.get("locationId")?.trim() || null;
  const access = await authorizeScopedLocation(PERMISSIONS.PROCUREMENT_READ, request, locationId);
  if (!access.ok) return access.response;

  if (q.length < 2) {
    return NextResponse.json({ status: "INVALID_QUERY", message: "Введіть артикул або назву деталі." }, { status: 400 });
  }

  const [result, suppliers] = await Promise.all([
    searchConfiguredSuppliers(q, 20),
    listSupplierStatuses(),
  ]);
  const offers = await enrichOffersWithSellPrice(result.offers);

  return NextResponse.json({
    status: "OK",
    query: q,
    ...result,
    offers,
    suppliers,
    pricing: {
      basis: "SUPPLIER_DEFAULT_MARKUP",
      defaultMarkupPercent: 23,
      message: "Ціна продажу розраховується від закупівельної ціни за правилом постачальника; базове правило Turbo LEV — 23%. Ручний override фіксується в аудиті під час створення supplier order draft.",
    },
    policy: {
      priceType: "PURCHASE_PRICE",
      fitmentConfirmed: false,
      message: "Ціна та залишок постачальника не підтверджують сумісність деталі з VIN. Для замовлення потрібне OEM/API підтвердження застосовності.",
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
