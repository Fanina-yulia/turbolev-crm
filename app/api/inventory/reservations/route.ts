import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import {
  listInventoryReservations,
  parseInventoryReservationStatus,
  reserveInventory,
} from "@/src/services/inventory-ledger.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function canAccessLocation(access: Awaited<ReturnType<typeof authorize>>, locationId: string | null) {
  return access.grantedScope === "ALL" || !locationId || access.context.locationIds.includes(locationId);
}

export async function GET(request: Request) {
  const access = await authorize(PERMISSIONS.PROCUREMENT_READ, { request, strict: true, minimumScope: "LOCATION" });
  if (!access.allowed) return access.response!;
  const url = new URL(request.url);
  const serviceLocationId = url.searchParams.get("serviceLocationId");
  if (!canAccessLocation(access, serviceLocationId)) {
    return NextResponse.json({ ok: false, error: "Ця локація не входить до Вашого доступу." }, { status: 403 });
  }
  const status = parseInventoryReservationStatus(url.searchParams.get("status"));
  return NextResponse.json({
    ok: true,
    reservations: await listInventoryReservations({
      warehouseKey: url.searchParams.get("warehouseKey"),
      serviceLocationId,
      workOrderId: url.searchParams.get("workOrderId"),
      workOrderLineId: url.searchParams.get("workOrderLineId"),
      status,
      limit: Number(url.searchParams.get("limit") || 100),
    }),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const access = await authorize(PERMISSIONS.PROCUREMENT_WRITE, { request, strict: true, minimumScope: "LOCATION" });
  if (!access.allowed) return access.response!;
  try {
    const body = await request.json() as Record<string, unknown>;
    const serviceLocationId = typeof body.serviceLocationId === "string" ? body.serviceLocationId.trim() : null;
    if (!canAccessLocation(access, serviceLocationId)) {
      return NextResponse.json({ ok: false, error: "Ця локація не входить до Вашого доступу." }, { status: 403 });
    }
    const result = await reserveInventory({
      warehouseKey: typeof body.warehouseKey === "string" ? body.warehouseKey : null,
      serviceLocationId,
      stockKey: typeof body.stockKey === "string" ? body.stockKey : "",
      productId: typeof body.productId === "string" ? body.productId : null,
      article: typeof body.article === "string" ? body.article : null,
      brand: typeof body.brand === "string" ? body.brand : null,
      description: typeof body.description === "string" ? body.description : null,
      unit: typeof body.unit === "string" ? body.unit : null,
      currency: typeof body.currency === "string" ? body.currency : null,
      quantity: body.quantity as string | number,
      workOrderId: typeof body.workOrderId === "string" ? body.workOrderId : null,
      workOrderLineId: typeof body.workOrderLineId === "string" ? body.workOrderLineId : null,
      sourceType: typeof body.sourceType === "string" ? body.sourceType : "WORK_ORDER_LINE",
      sourceId: typeof body.sourceId === "string" ? body.sourceId : "",
      actorUserId: access.context.user?.id || null,
      actorName: access.context.user?.employeeName || access.context.user?.name || "CRM",
      idempotencyKey: request.headers.get("Idempotency-Key") || (typeof body.idempotencyKey === "string" ? body.idempotencyKey : null),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const status = code === "INVENTORY_INSUFFICIENT" ? 409 : 422;
    return NextResponse.json({
      ok: false,
      code,
      error: code === "INVENTORY_INSUFFICIENT" ? "Недостатньо доступного залишку для резерву." : "Не вдалося створити резерв.",
    }, { status });
  }
}
