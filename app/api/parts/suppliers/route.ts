import { NextResponse } from "next/server";
import { listSupplierStatuses, searchConfiguredSuppliers } from "@/src/services/suppliers/registry";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();

  if (q.length < 2) {
    return NextResponse.json({ status: "INVALID_QUERY", message: "Введіть артикул або назву деталі." }, { status: 400 });
  }

  const result = await searchConfiguredSuppliers(q, 20);
  return NextResponse.json({
    status: "OK",
    query: q,
    ...result,
    suppliers: listSupplierStatuses(),
    policy: {
      priceType: "PURCHASE_PRICE",
      fitmentConfirmed: false,
      message: "Ціна та залишок постачальника не підтверджують сумісність деталі з VIN. Для замовлення потрібне OEM/API підтвердження застосовності.",
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
