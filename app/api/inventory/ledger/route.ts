import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import {
  listInventoryLedger,
  parseInventoryDirection,
  parseInventoryReason,
  postInventoryMovement,
} from "@/src/services/inventory-ledger.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function canAccessLocation(access: Awaited<ReturnType<typeof authorize>>, locationId: string | null) {
  return access.grantedScope === "ALL" || !locationId || access.context.locationIds.includes(locationId);
}

function actor(access: Awaited<ReturnType<typeof authorize>>) {
  return {
    actorUserId: access.context.user?.id || null,
    actorName: (access.context.user?.employeeName || access.context.user?.name || "CRM").trim().slice(0, 160),
  };
}

export async function GET(request: Request) {
  const access = await authorize(PERMISSIONS.PROCUREMENT_READ, { request, strict: true, minimumScope: "LOCATION" });
  if (!access.allowed) return access.response!;
  const url = new URL(request.url);
  const serviceLocationId = url.searchParams.get("serviceLocationId");
  if (!canAccessLocation(access, serviceLocationId)) {
    return NextResponse.json({ ok: false, error: "Ця локація не входить до Вашого доступу." }, { status: 403 });
  }
  const result = await listInventoryLedger({
    warehouseKey: url.searchParams.get("warehouseKey"),
    serviceLocationId,
    stockKey: url.searchParams.get("stockKey"),
    workOrderId: url.searchParams.get("workOrderId"),
    workOrderLineId: url.searchParams.get("workOrderLineId"),
    limit: Number(url.searchParams.get("limit") || 100),
  });
  return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const access = await authorize(PERMISSIONS.PROCUREMENT_WRITE, { request, strict: true, minimumScope: "LOCATION" });
  if (!access.allowed) return access.response!;
  try {
    const body = await request.json() as Record<string, unknown>;
    const direction = parseInventoryDirection(body.direction);
    const reason = parseInventoryReason(body.reason);
    const serviceLocationId = typeof body.serviceLocationId === "string" ? body.serviceLocationId.trim() : null;
    if (!direction || !reason || !canAccessLocation(access, serviceLocationId)) {
      return NextResponse.json({ ok: false, error: "Некоректний рух або недоступна локація." }, { status: 400 });
    }
    const result = await postInventoryMovement({
      warehouseKey: typeof body.warehouseKey === "string" ? body.warehouseKey : null,
      serviceLocationId,
      stockKey: typeof body.stockKey === "string" ? body.stockKey : "",
      productId: typeof body.productId === "string" ? body.productId : null,
      article: typeof body.article === "string" ? body.article : null,
      brand: typeof body.brand === "string" ? body.brand : null,
      description: typeof body.description === "string" ? body.description : null,
      unit: typeof body.unit === "string" ? body.unit : null,
      currency: typeof body.currency === "string" ? body.currency : null,
      direction,
      reason,
      quantity: body.quantity as string | number,
      unitCost: body.unitCost as string | number | null | undefined,
      referenceType: typeof body.referenceType === "string" ? body.referenceType : null,
      referenceId: typeof body.referenceId === "string" ? body.referenceId : null,
      workOrderId: typeof body.workOrderId === "string" ? body.workOrderId : null,
      workOrderLineId: typeof body.workOrderLineId === "string" ? body.workOrderLineId : null,
      supplierOrderId: typeof body.supplierOrderId === "string" ? body.supplierOrderId : null,
      supplierId: typeof body.supplierId === "string" ? body.supplierId : null,
      reasonNote: typeof body.reasonNote === "string" ? body.reasonNote : null,
      idempotencyKey: request.headers.get("Idempotency-Key") || (typeof body.idempotencyKey === "string" ? body.idempotencyKey : null),
      allowNegative: false,
      ...actor(access),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const status = code === "INVENTORY_INSUFFICIENT" ? 409 : 422;
    const message = code === "INVENTORY_INSUFFICIENT"
      ? "Недостатньо доступного залишку для цього руху."
      : "Не вдалося провести складський рух.";
    return NextResponse.json({ ok: false, code, error: message }, { status });
  }
}
