import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { canAccessWorkOrder } from "@/src/security/work-order-scope";
import { getPrisma } from "@/src/lib/prisma";
import { ensureCompletionActTx } from "@/src/services/service-completion-act.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await authorize(PERMISSIONS.WORK_ORDERS_READ, { request, strict: true, minimumScope: "ASSIGNED" });
  if (!access.allowed) return access.response!;
  if (!(await canAccessWorkOrder(access.context, access.grantedScope, id))) {
    return NextResponse.json({ ok: false, error: "WORK_ORDER_FORBIDDEN" }, { status: 403 });
  }

  try {
    const prisma = getPrisma();
    const workOrder = await prisma.workOrder.findUnique({ where: { id }, select: { id: true, status: true, closedAt: true } });
    if (!workOrder) return NextResponse.json({ ok: false, error: "WORK_ORDER_NOT_FOUND" }, { status: 404 });
    let act = await prisma.serviceCompletionAct.findUnique({ where: { workOrderId: id } });
    if (!act && ["READY_FOR_PICKUP", "CLOSED", "COMPLETED"].includes(workOrder.status)) {
      act = await prisma.$transaction((tx) => ensureCompletionActTx(tx, id, "CRM / Акт виконаних робіт"));
    }
    return NextResponse.json({
      ok: true,
      available: Boolean(act),
      act: act ? {
        id: act.id,
        workOrderId: act.workOrderId,
        actNumber: act.actNumber,
        status: act.status,
        currency: act.currency,
        lineSnapshot: act.lineSnapshot,
        totalAmount: act.totalAmount.toString(),
        issuedAt: act.issuedAt.toISOString(),
        issuedByName: act.issuedByName,
      } : null,
    });
  } catch (error) {
    console.error("GET /api/work-orders/[id]/completion-act failed", { id, error });
    return NextResponse.json({ ok: false, error: "COMPLETION_ACT_FAILED" }, { status: 500 });
  }
}
