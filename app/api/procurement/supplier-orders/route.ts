import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation, type ScopedLocationAccess } from "@/src/security/scoped-location-access";
import {
  createSupplierOrderDraft,
  ORDER_CONFIRMATION,
  submitSupplierOrder,
  syncSupplierOrder,
} from "@/src/services/suppliers/order.service";
import type { SupplierId } from "@/src/services/suppliers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function requestedLocation(request: Request) {
  return new URL(request.url).searchParams.get("locationId")?.trim() || null;
}

async function workOrderInScope(workOrderId: string, access: ScopedLocationAccess) {
  const prisma = getPrisma();
  const locationFilter = access.requestedLocationId
    ? { locationId: access.requestedLocationId }
    : access.allowedLocationIds
      ? { locationId: { in: access.allowedLocationIds } }
      : {};
  const appointment = await prisma.serviceAppointment.findFirst({ where: { workOrderId, ...locationFilter }, select: { id: true, locationId: true } });
  return appointment;
}

function actor(access: ScopedLocationAccess) {
  return {
    actorId: access.context.user?.id || null,
    actorName: access.context.user?.employeeName || access.context.user?.name || "CRM / Закупівлі",
  };
}

export async function GET(request: Request) {
  try {
    const access = await authorizeScopedLocation(PERMISSIONS.PROCUREMENT_READ, request, requestedLocation(request));
    if (!access.ok) return access.response;
    const prisma = getPrisma();
    const locationFilter = access.requestedLocationId
      ? { locationId: access.requestedLocationId }
      : access.allowedLocationIds
        ? { locationId: { in: access.allowedLocationIds } }
        : {};
    const appointments = await prisma.serviceAppointment.findMany({ where: { workOrderId: { not: null }, ...locationFilter }, select: { workOrderId: true } });
    const workOrderIds = [...new Set(appointments.flatMap((item) => item.workOrderId ? [item.workOrderId] : []))];
    if (!workOrderIds.length) return NextResponse.json({ ok: true, orders: [], confirmation: ORDER_CONFIRMATION });
    const orders = await prisma.supplierOrder.findMany({
      where: { workOrderId: { in: workOrderIds } },
      include: { supplier: { select: { id: true, code: true, name: true, defaultMarkupPercent: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return NextResponse.json({ ok: true, orders, confirmation: ORDER_CONFIRMATION }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/procurement/supplier-orders failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити замовлення постачальникам." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const access = await authorizeScopedLocation(PERMISSIONS.PROCUREMENT_WRITE, request, requestedLocation(request));
    if (!access.ok) return access.response;
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action.trim().toUpperCase() : "";
    const identity = actor(access);

    if (action === "CREATE_DRAFT") {
      const supplierId = String(body.supplierId || "") as SupplierId;
      const workOrderId = String(body.workOrderId || "").trim();
      const partsRequestId = String(body.partsRequestId || "").trim();
      const items = Array.isArray(body.items) ? body.items : [];
      if (!supplierId || !workOrderId || !partsRequestId || !items.length) return NextResponse.json({ ok: false, error: "Не заповнені дані supplier-order draft." }, { status: 400 });
      if (!(await workOrderInScope(workOrderId, access))) return NextResponse.json({ ok: false, error: "Замовлення-наряд не входить до Вашої станції." }, { status: 403 });
      const order = await createSupplierOrderDraft({
        supplierId,
        workOrderId,
        partsRequestId,
        items: items.map((raw) => {
          const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
          return {
            partsRequestItemId: String(item.partsRequestItemId || "").trim(),
            externalProductId: String(item.externalProductId || "").trim(),
            warehouseId: String(item.warehouseId || "").trim(),
            quantity: item.quantity == null ? undefined : Number(item.quantity),
            markupPercent: item.markupPercent == null ? undefined : Number(item.markupPercent),
          };
        }),
        checkout: body.checkout && typeof body.checkout === "object" && !Array.isArray(body.checkout)
          ? body.checkout as never
          : null,
        ...identity,
      });
      return NextResponse.json({ ok: true, order, confirmationRequiredForSubmit: ORDER_CONFIRMATION }, { status: 201 });
    }

    const orderId = String(body.orderId || "").trim();
    if (!orderId) return NextResponse.json({ ok: false, error: "Не вказано supplier order." }, { status: 400 });
    const existing = await getPrisma().supplierOrder.findUnique({ where: { id: orderId }, select: { workOrderId: true } });
    if (!existing) return NextResponse.json({ ok: false, error: "Supplier order не знайдено." }, { status: 404 });
    if (!existing.workOrderId || !(await workOrderInScope(existing.workOrderId, access))) return NextResponse.json({ ok: false, error: "Supplier order не входить до Вашої станції." }, { status: 403 });

    if (action === "SUBMIT") {
      const order = await submitSupplierOrder({ orderId, confirmation: String(body.confirmation || ""), ...identity });
      return NextResponse.json({ ok: true, order });
    }
    if (action === "SYNC_STATUS") {
      const result = await syncSupplierOrder({ orderId, ...identity });
      return NextResponse.json({ ok: true, ...result });
    }
    return NextResponse.json({ ok: false, error: "Непідтримувана дія supplier order." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не вдалося виконати дію із замовленням постачальнику.";
    console.error("POST /api/procurement/supplier-orders failed", message);
    const providerFailure = /Юнік Трейд|постачальник|provider/i.test(message);
    return NextResponse.json({ ok: false, error: message }, { status: providerFailure ? 502 : 409 });
  }
}
