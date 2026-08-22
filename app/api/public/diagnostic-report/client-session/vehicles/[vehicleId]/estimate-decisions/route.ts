import { NextRequest, NextResponse } from "next/server";
import {
  CLIENT_PORTAL_SESSION_COOKIE,
  ClientPortalSessionError,
  resolveClientPortalSession,
} from "@/src/services/client-portal-session.service";
import { submitClientEstimateLineDecisions } from "@/src/services/client-portal-vehicle.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ vehicleId: string }> }) {
  try {
    const session = await resolveClientPortalSession(request.cookies.get(CLIENT_PORTAL_SESSION_COOKIE)?.value || null);
    if (!session) return NextResponse.json({ ok: false, message: "Сесія особистого кабінету завершилась." }, { status: 401 });
    const { vehicleId } = await context.params;
    const body = await request.json().catch(() => null) as {
      estimateId?: string;
      decisions?: Array<{ lineId?: string; decision?: string }>;
      note?: string;
    } | null;
    const estimateId = body?.estimateId?.trim() || "";
    const decisions = Array.isArray(body?.decisions)
      ? body!.decisions!
        .filter((item) => typeof item?.lineId === "string" && (item?.decision === "APPROVE" || item?.decision === "REJECT"))
        .map((item) => ({ lineId: item.lineId!.trim(), decision: item.decision as "APPROVE" | "REJECT" }))
      : [];
    if (!estimateId) return NextResponse.json({ ok: false, message: "Кошторис не визначено." }, { status: 400 });

    const detail = await submitClientEstimateLineDecisions({
      sessionId: session.id,
      clientId: session.clientId,
      vehicleId,
      estimateId,
      decisions,
      note: body?.note,
    });
    return NextResponse.json({ ok: true, detail });
  } catch (error) {
    const known = error instanceof ClientPortalSessionError;
    return NextResponse.json(
      { ok: false, message: known ? error.message : "Не вдалося зберегти рішення по кошторису." },
      { status: known ? error.status : 500 },
    );
  }
}
