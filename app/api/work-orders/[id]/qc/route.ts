import { NextResponse } from "next/server";
import {
  ensureQualityControlTask,
  getQualityControlState,
  updateQualityControl,
  WorkOrderQualityError,
} from "@/src/services/work-order-qc.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };

function errorResponse(error: unknown) {
  if (error instanceof WorkOrderQualityError) {
    return NextResponse.json(
      { ok: false, code: error.code, error: error.message },
      { status: error.code === "WORK_ORDER_NOT_FOUND" ? 404 : 409 },
    );
  }
  return NextResponse.json({ ok: false, error: "Не вдалося виконати контроль якості." }, { status: 500 });
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const qualityControl = await getQualityControlState(id);
    return NextResponse.json({ ok: true, qualityControl }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/work-orders/[id]/qc failed", { id, message: error instanceof Error ? error.message : "unknown" });
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const actorName = typeof body.actorName === "string" && body.actorName.trim()
      ? body.actorName.trim().slice(0, 160)
      : "CRM / Контроль якості";
    if (typeof body.action === "string" && body.action.trim()) {
      const qualityControl = await updateQualityControl(id, body, actorName);
      return NextResponse.json({ ok: true, qualityControl });
    }
    const task = await ensureQualityControlTask(id, actorName);
    const qualityControl = await getQualityControlState(id);
    return NextResponse.json({ ok: true, task, qualityControl }, { status: 201 });
  } catch (error) {
    console.error("POST /api/work-orders/[id]/qc failed", { id, message: error instanceof Error ? error.message : "unknown" });
    return errorResponse(error);
  }
}
