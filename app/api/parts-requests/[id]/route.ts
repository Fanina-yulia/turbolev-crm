import { NextResponse } from "next/server";
import {
  transitionPartsRequest,
  updatePartsRequest,
  WorkOrderCommercialError,
} from "@/src/services/work-order-commercial.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const body = await request.json() as Record<string, unknown>;
    const actorName = typeof body.actorName === "string" && body.actorName.trim() ? body.actorName.trim().slice(0, 160) : "CRM / Підбір запчастин";
    if (typeof body.status === "string" && body.status.trim()) {
      const partsRequest = await transitionPartsRequest(id, body.status, actorName);
      return NextResponse.json({ ok: true, partsRequest });
    }
    const partsRequest = await updatePartsRequest(id, {
      paymentRequired: typeof body.paymentRequired === "boolean" ? body.paymentRequired : undefined,
      paymentConfirmed: typeof body.paymentConfirmed === "boolean" ? body.paymentConfirmed : undefined,
    }, actorName);
    return NextResponse.json({ ok: true, partsRequest });
  } catch (error) {
    if (error instanceof WorkOrderCommercialError) return NextResponse.json({ ok: false, code: error.code, error: error.message, details: error.details ?? null }, { status: error.code === "PARTS_REQUEST_NOT_FOUND" ? 404 : 409 });
    console.error("PATCH /api/parts-requests/[id] failed", { id, message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "Не вдалося оновити запит на деталі." }, { status: 500 });
  }
}
