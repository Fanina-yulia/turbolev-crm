import { NextResponse } from "next/server";
import {
  getWorkOrder,
  transitionWorkOrder,
  WorkOrderNotFoundError,
  WorkOrderTransitionError,
} from "@/src/services/work-orders.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const workOrder = await getWorkOrder(id);
    if (!workOrder) return NextResponse.json({ ok: false, error: "Замовлення-наряд не знайдено." }, { status: 404 });
    return NextResponse.json({ ok: true, workOrder }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/work-orders/[id] failed", { id, message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити замовлення-наряд." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const body = await request.json() as Record<string, unknown>;
    const status = typeof body.status === "string" ? body.status : "";
    if (!status.trim()) return NextResponse.json({ ok: false, error: "Передайте новий статус." }, { status: 400 });
    const actorName = typeof body.actorName === "string" && body.actorName.trim() ? body.actorName.trim().slice(0, 160) : "CRM";
    const workOrder = await transitionWorkOrder(id, status, actorName);
    return NextResponse.json({ ok: true, workOrder });
  } catch (error) {
    if (error instanceof WorkOrderNotFoundError) {
      return NextResponse.json({ ok: false, error: "Замовлення-наряд не знайдено." }, { status: 404 });
    }
    if (error instanceof WorkOrderTransitionError) {
      return NextResponse.json({
        ok: false,
        error: error.unsupportedActions.length
          ? "Перехід потребує автоматичної дії, для якої ще немає фактичної сутності в CRM."
          : error.decision.code === "GATES_NOT_SATISFIED"
            ? "Перехід заблоковано Hard Gate."
            : "Такий перехід статусу не дозволений.",
        code: error.unsupportedActions.length ? "ACTIONS_NOT_IMPLEMENTED" : error.decision.code,
        workflowDecision: error.decision,
        unsupportedActions: error.unsupportedActions,
      }, { status: 409 });
    }
    console.error("PATCH /api/work-orders/[id] failed", { id, message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "Не вдалося змінити статус замовлення-наряду." }, { status: 500 });
  }
}
