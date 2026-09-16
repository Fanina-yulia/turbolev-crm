import { NextResponse } from "next/server";
import { DirectRepairPartsMode, PartSupplySource } from "@/src/generated/prisma/client";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { canAccessWorkOrder } from "@/src/security/work-order-scope";
import {
  confirmCustomerPart,
  createCustomerSuppliedPart,
  DirectRepairCommercialError,
  getDirectRepairCommercialConfig,
  setDirectRepairPartSource,
  setDirectRepairPartsMode,
} from "@/src/services/direct-repair-commercial.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };

function errorResponse(error: DirectRepairCommercialError) {
  const status = error.code === "WORK_ORDER_NOT_FOUND" || error.code === "PART_LINE_NOT_FOUND" ? 404 : 409;
  return NextResponse.json({ ok: false, code: error.code, error: error.message, details: error.details ?? null }, { status });
}

export async function GET(request: Request, context: RouteContext) {
  const access = await authorize(PERMISSIONS.WORK_ORDERS_READ, { strict: true, request, minimumScope: "ASSIGNED" });
  if (!access.allowed) return access.response!;
  const { id } = await context.params;
  try {
    if (!(await canAccessWorkOrder(access.context, access.grantedScope, id))) {
      return NextResponse.json({ ok: false, error: "Замовлення-наряд не знайдено." }, { status: 404 });
    }
    const directRepair = await getDirectRepairCommercialConfig(id);
    return NextResponse.json({ ok: true, directRepair }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof DirectRepairCommercialError) return errorResponse(error);
    console.error("GET /api/work-orders/[id]/direct-repair failed", { id, message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити конфігурацію прямого ремонту." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const access = await authorize(PERMISSIONS.WORK_ORDERS_WRITE, { strict: true, request, minimumScope: "LOCATION" });
  if (!access.allowed) return access.response!;
  const { id } = await context.params;
  try {
    if (!(await canAccessWorkOrder(access.context, access.grantedScope, id))) {
      return NextResponse.json({ ok: false, error: "Замовлення-наряд не знайдено." }, { status: 404 });
    }
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action.trim().toUpperCase() : "";
    const actorName = (access.context.user?.employeeName || access.context.user?.name || "CRM / Сервіс-менеджер").trim().slice(0, 160);

    if (action === "SET_PARTS_MODE") {
      const mode = String(body.mode || "").trim().toUpperCase() as DirectRepairPartsMode;
      await setDirectRepairPartsMode(id, mode, actorName);
    } else if (action === "SET_PART_SOURCE") {
      const lineId = String(body.lineId || "").trim();
      const source = String(body.source || "").trim().toUpperCase() as PartSupplySource;
      if (!lineId) return NextResponse.json({ ok: false, error: "Не вказана запчастина." }, { status: 400 });
      await setDirectRepairPartSource(id, lineId, source, actorName);
    } else if (action === "CONFIRM_CUSTOMER_PART") {
      const lineId = String(body.lineId || "").trim();
      if (!lineId) return NextResponse.json({ ok: false, error: "Не вказана запчастина." }, { status: 400 });
      await confirmCustomerPart(id, lineId, body.confirmed !== false, actorName);
    } else if (action === "ADD_CUSTOMER_PART") {
      await createCustomerSuppliedPart(id, {
        description: String(body.description || ""),
        article: typeof body.article === "string" ? body.article : undefined,
        brand: typeof body.brand === "string" ? body.brand : undefined,
        quantity: typeof body.quantity === "string" || typeof body.quantity === "number" ? body.quantity : undefined,
      }, actorName);
    } else {
      return NextResponse.json({ ok: false, error: "Невідома дія прямого ремонту." }, { status: 400 });
    }

    const directRepair = await getDirectRepairCommercialConfig(id);
    return NextResponse.json({ ok: true, directRepair });
  } catch (error) {
    if (error instanceof DirectRepairCommercialError) return errorResponse(error);
    console.error("PATCH /api/work-orders/[id]/direct-repair failed", { id, message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "Не вдалося оновити прямий ремонт." }, { status: 500 });
  }
}
