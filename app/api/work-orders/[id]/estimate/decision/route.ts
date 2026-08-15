import { NextResponse } from "next/server";
import { normalizeApprovedEstimateFingerprint } from "@/src/services/work-order-estimate-fingerprint.service";
import { decideEstimate, WorkOrderCommercialError } from "@/src/services/work-order-commercial.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const body = await request.json() as Record<string, unknown>;
    const rawDecision = typeof body.decision === "string" ? body.decision.trim().toUpperCase() : "";
    if (rawDecision !== "APPROVE" && rawDecision !== "REJECT") {
      return NextResponse.json({ ok: false, error: "Передайте decision APPROVE або REJECT." }, { status: 400 });
    }
    const actorName = typeof body.actorName === "string" ? body.actorName : "CRM / Сервіс-менеджер";
    const estimate = await decideEstimate(id, {
      decision: rawDecision,
      approvedByName: typeof body.approvedByName === "string" ? body.approvedByName : undefined,
      source: typeof body.source === "string" ? body.source : undefined,
      note: typeof body.note === "string" ? body.note : undefined,
    }, actorName);
    const normalized = rawDecision === "APPROVE"
      ? await normalizeApprovedEstimateFingerprint(id, estimate.id, actorName)
      : null;
    return NextResponse.json({ ok: true, estimate: normalized ?? estimate });
  } catch (error) {
    if (error instanceof WorkOrderCommercialError) {
      return NextResponse.json({ ok: false, code: error.code, error: error.message, details: error.details ?? null }, { status: error.code === "WORK_ORDER_NOT_FOUND" ? 404 : 409 });
    }
    console.error("POST /api/work-orders/[id]/estimate/decision failed", { id, message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "Не вдалося зафіксувати рішення по кошторису." }, { status: 500 });
  }
}
