import { NextResponse } from "next/server";
import { incrementLeadAttempt, LeadNotFoundError } from "@/src/services/leads.service";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const access = await authorize(PERMISSIONS.LEADS_WRITE, { request, minimumScope: "TEAM" });
  if (!access.allowed) return access.response!;

  try {
    const { id } = await context.params;
    const lead = await incrementLeadAttempt(id, access.context.user?.name || "CRM");
    return NextResponse.json({ ok: true, lead });
  } catch (error) {
    if (error instanceof LeadNotFoundError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 404 });
    }
    console.error("POST /api/leads/[id]/attempt failed", {
      message: error instanceof Error ? error.message : "unknown error",
    });
    return NextResponse.json({ ok: false, error: "Failed to add contact attempt" }, { status: 500 });
  }
}
