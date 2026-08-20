import { NextResponse } from "next/server";
import {
  clientPortalErrorResponse,
  decideClientPortalEstimate,
} from "@/src/services/client-portal.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type RouteContext = { params: Promise<{ token: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { token } = await context.params;
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const rawDecision = typeof body?.decision === "string" ? body.decision.trim().toUpperCase() : "";
    if (rawDecision !== "APPROVE" && rawDecision !== "REJECT") {
      return NextResponse.json({ ok: false, error: "INVALID_DECISION", message: "Оберіть погодити або відхилити кошторис." }, { status: 400 });
    }
    const note = typeof body?.note === "string" ? body.note : undefined;
    const portal = await decideClientPortalEstimate(token, rawDecision, note);
    return NextResponse.json({ ok: true, portal });
  } catch (error) {
    const known = clientPortalErrorResponse(error);
    if (known) return NextResponse.json(known.body, { status: known.status });
    console.error("POST client portal estimate decision failed", error);
    return NextResponse.json({ ok: false, error: "ESTIMATE_DECISION_FAILED", message: "Не вдалося зафіксувати рішення по кошторису." }, { status: 500 });
  }
}
