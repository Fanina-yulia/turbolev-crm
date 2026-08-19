import { NextResponse } from "next/server";
import { WorkOrderFinanceValidationError } from "@/src/domain/work-order-finance";
import { getPrisma } from "@/src/lib/prisma";
import { transitionWorkOrder } from "@/src/services/work-orders.service";
import {
  recordWorkOrderPayment,
  WorkOrderFinanceError,
} from "@/src/services/work-order-finance.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof WorkOrderFinanceValidationError) {
    return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: 400 });
  }
  if (error instanceof WorkOrderFinanceError) {
    const status = error.code === "WORK_ORDER_NOT_FOUND" ? 404 : 409;
    return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status });
  }
  console.error("[work-order-payment]", error);
  return NextResponse.json({ ok: false, code: "INTERNAL_ERROR", error: "Payment posting failed" }, { status: 500 });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const actorName = typeof body.actorName === "string" && body.actorName.trim()
      ? body.actorName.trim().slice(0, 120)
      : "CRM / Каса";
    const result = await recordWorkOrderPayment(id, body, actorName);
    let workOrder = null;
    let workflowWarning = null;
    if (result.obligation?.status === "PAID") {
      const current = await getPrisma().workOrder.findUnique({ where: { id }, select: { status: true } });
      if (current?.status === "WAITING_PAYMENT") {
        try {
          workOrder = await transitionWorkOrder(id, "READY_FOR_PICKUP", actorName);
        } catch (error) {
          workflowWarning = error instanceof Error ? error.message : "READY_FOR_PICKUP_TRANSITION_FAILED";
        }
      }
    }
    return NextResponse.json({ ok: true, ...result, workOrder, workflowWarning });
  } catch (error) {
    return errorResponse(error);
  }
}
