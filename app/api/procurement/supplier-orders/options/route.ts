import { NextResponse } from "next/server";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";
import {
  getSupplierDeliveryOptions,
  getSupplierDeliveryPoints,
  getSupplierTransporters,
} from "@/src/services/suppliers/order.service";
import type { SupplierId } from "@/src/services/suppliers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const locationId = url.searchParams.get("locationId")?.trim() || null;
    const access = await authorizeScopedLocation(PERMISSIONS.PROCUREMENT_READ, request, locationId);
    if (!access.ok) return access.response;

    const supplier = (url.searchParams.get("supplier") || "") as SupplierId;
    const kind = (url.searchParams.get("kind") || "points").trim().toLowerCase();
    if (!supplier) return NextResponse.json({ ok: false, error: "Не вказано постачальника." }, { status: 400 });

    if (kind === "points") {
      const points = await getSupplierDeliveryPoints(supplier);
      return NextResponse.json({ ok: true, supplier, points }, { headers: { "Cache-Control": "no-store" } });
    }

    const date = url.searchParams.get("date")?.trim() || "";
    const deliveryPointId = url.searchParams.get("deliveryPointId")?.trim() || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !deliveryPointId) {
      return NextResponse.json({ ok: false, error: "Для доставки потрібні дата і точка доставки." }, { status: 400 });
    }

    if (kind === "transporters") {
      const transporters = await getSupplierTransporters(supplier, { date, deliveryPointId });
      return NextResponse.json({ ok: true, supplier, transporters }, { headers: { "Cache-Control": "no-store" } });
    }

    if (kind === "deliveries") {
      const transporterId = url.searchParams.get("transporterId")?.trim() || "";
      const warehouseIds = (url.searchParams.get("warehouseIds") || "").split(",").map((item) => item.trim()).filter(Boolean);
      if (!transporterId || !warehouseIds.length) return NextResponse.json({ ok: false, error: "Потрібні перевізник і склади постачальника." }, { status: 400 });
      const deliveries = await getSupplierDeliveryOptions(supplier, { date, deliveryPointId, transporterId, warehouseIds });
      return NextResponse.json({ ok: true, supplier, deliveries }, { headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json({ ok: false, error: "Невідомий тип параметрів доставки." }, { status: 400 });
  } catch (error) {
    console.error("GET /api/procurement/supplier-orders/options failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Не вдалося завантажити параметри доставки." }, { status: 502 });
  }
}
