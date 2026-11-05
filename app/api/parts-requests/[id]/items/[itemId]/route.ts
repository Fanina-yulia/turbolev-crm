import { NextResponse } from "next/server";
import { updatePartsRequestItem, WorkOrderCommercialError } from "@/src/services/work-order-commercial.service";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { canAccessWorkOrder } from "@/src/security/work-order-scope";
import { getPrisma } from "@/src/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string; itemId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const access = await authorize(PERMISSIONS.PROCUREMENT_WRITE, { request, strict: true, minimumScope: "LOCATION" });
  if (!access.allowed) return access.response!;
  const { id, itemId } = await context.params;
  try {
    // Station isolation: the parts request must belong to a work order the caller may access.
    const owner = await getPrisma().partsRequest.findUnique({ where: { id }, select: { workOrderId: true } });
    if (!owner || !(await canAccessWorkOrder(access.context, access.grantedScope, owner.workOrderId))) {
      return NextResponse.json({ ok: false, error: "Запит на деталі не знайдено." }, { status: 404 });
    }
    const body = await request.json() as Record<string, unknown>;
    // Executor identity comes only from the verified session, never from the request body.
    const actorName = (access.context.user?.employeeName || access.context.user?.name || "CRM").trim().slice(0, 160);
    const result = await updatePartsRequestItem(id, itemId, body, actorName);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof WorkOrderCommercialError) return NextResponse.json({ ok: false, code: error.code, error: error.message, details: error.details ?? null }, { status: ["PARTS_REQUEST_NOT_FOUND", "PARTS_ITEM_NOT_FOUND"].includes(error.code) ? 404 : 409 });
    console.error("PATCH /api/parts-requests/[id]/items/[itemId] failed", { id, itemId, message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "Не вдалося оновити фактичну кількість деталей." }, { status: 500 });
  }
}
