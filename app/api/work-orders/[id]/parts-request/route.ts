import { NextResponse } from "next/server";
import {
  getWorkOrderCommercialState,
  openPartsRequest,
  WorkOrderCommercialError,
} from "@/src/services/work-order-commercial.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const commercial = await getWorkOrderCommercialState(id);
    return NextResponse.json({ ok: true, partsRequest: commercial.partsRequest, commercial }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkOrderCommercialError) return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: error.code === "WORK_ORDER_NOT_FOUND" ? 404 : 409 });
    console.error("GET /api/work-orders/[id]/parts-request failed", { id, message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити запит на деталі." }, { status: 500 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const actorName = typeof body.actorName === "string" && body.actorName.trim() ? body.actorName.trim().slice(0, 160) : "CRM / Підбір запчастин";
    const partsRequest = await openPartsRequest(id, actorName);
    return NextResponse.json({ ok: true, partsRequest }, { status: 201 });
  } catch (error) {
    if (error instanceof WorkOrderCommercialError) return NextResponse.json({ ok: false, code: error.code, error: error.message, details: error.details ?? null }, { status: error.code === "WORK_ORDER_NOT_FOUND" ? 404 : 409 });
    console.error("POST /api/work-orders/[id]/parts-request failed", { id, message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "Не вдалося відкрити запит на деталі." }, { status: 500 });
  }
}
