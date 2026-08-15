import { NextResponse } from "next/server";
import {
  sendEstimate,
  WorkOrderCommercialError,
} from "@/src/services/work-order-commercial.service";
import { getWorkOrderCycleState } from "@/src/services/work-order-cycle.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };

function commercialError(error: WorkOrderCommercialError) {
  const notFound = error.code === "WORK_ORDER_NOT_FOUND";
  return NextResponse.json(
    { ok: false, code: error.code, error: error.message, details: error.details ?? null },
    { status: notFound ? 404 : 409 },
  );
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const cycle = await getWorkOrderCycleState(id);
    return NextResponse.json({ ok: true, commercial: cycle.commercial }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkOrderCommercialError) return commercialError(error);
    console.error("GET /api/work-orders/[id]/estimate failed", { id, message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити кошторис." }, { status: 500 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const actorName = typeof body.actorName === "string" && body.actorName.trim() ? body.actorName.trim().slice(0, 160) : "CRM / Сервіс-менеджер";
    const result = await sendEstimate(id, actorName);
    return NextResponse.json({ ok: true, estimate: result.estimate, created: result.created });
  } catch (error) {
    if (error instanceof WorkOrderCommercialError) return commercialError(error);
    console.error("POST /api/work-orders/[id]/estimate failed", { id, message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "Не вдалося сформувати кошторис." }, { status: 500 });
  }
}
