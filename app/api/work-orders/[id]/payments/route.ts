import { NextResponse } from "next/server";
import { WorkOrderFinanceValidationError } from "@/src/domain/work-order-finance";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorize } from "@/src/security/authorize";
import {
  recordWorkOrderPayment,
  WorkOrderFinanceError,
} from "@/src/services/work-order-finance.service";
import {
  transitionWorkOrder,
  WorkOrderNotFoundError,
  WorkOrderTransitionError,
} from "@/src/services/work-orders.service";

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
  const access = await authorize(PERMISSIONS.PAYMENTS_WRITE, {
    request,
    strict: true,
    // Current payment writers are global finance roles. If location-scoped
    // payment posting is introduced later it must get an explicit row check.
    minimumScope: "ALL",
  });
  if (!access.allowed) return access.response ?? NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

  const { id } = await context.params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const actorName = access.context.user?.name || access.context.user?.email || "CRM / Каса";
    const result = await recordWorkOrderPayment(id, body, actorName);

    let workOrder = null;
    let transitionWarning = null;
    if (result.obligation?.status === "PAID") {
      try {
        workOrder = await transitionWorkOrder(id, "READY_FOR_PICKUP", actorName);
      } catch (error) {
        if (error instanceof WorkOrderTransitionError || error instanceof WorkOrderNotFoundError) {
          transitionWarning = {
            code: error instanceof WorkOrderTransitionError ? error.decision.code : "WORK_ORDER_NOT_FOUND",
            message: "Оплату збережено, але ЗН не вдалося автоматично перевести у «Готовий до видачі».",
          };
        } else {
          console.error("[work-order-payment-ready-transition]", error);
          transitionWarning = {
            code: "READY_TRANSITION_FAILED",
            message: "Оплату збережено, але статус готовності до видачі потрібно перевірити вручну.",
          };
        }
      }
    }

    return NextResponse.json({ ok: true, ...result, workOrder, transitionWarning });
  } catch (error) {
    return errorResponse(error);
  }
}
