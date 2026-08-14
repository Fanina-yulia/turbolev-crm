import { NextResponse } from "next/server";
import { incrementLeadAttempt, LeadNotFoundError } from "@/src/services/leads.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const lead = await incrementLeadAttempt(id);
    return NextResponse.json({ ok: true, lead });
  } catch (error) {
    if (error instanceof LeadNotFoundError) return NextResponse.json({ ok: false, error: error.message }, { status: 404 });
    return NextResponse.json({ ok: false, error: "Failed to add contact attempt" }, { status: 500 });
  }
}
