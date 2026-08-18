import { NextRequest, NextResponse } from "next/server";
import { LeadDtoError, parseLeadPatchDto } from "@/src/dto/leads";
import {
  LeadBusinessRuleError,
  LeadNotFoundError,
  updateLead,
} from "@/src/services/leads.service";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const access = await authorize(PERMISSIONS.LEADS_WRITE, { request, minimumScope: "TEAM" });
  if (!access.allowed) return access.response!;

  try {
    const { id } = await context.params;
    const dto = parseLeadPatchDto(await request.json());
    const lead = await updateLead(id, dto, access.context.user?.name || "CRM");
    return NextResponse.json({ ok: true, lead });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "Некоректний JSON у запиті." }, { status: 400 });
    }
    if (error instanceof LeadDtoError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 422 });
    }
    if (error instanceof LeadNotFoundError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 404 });
    }
    if (error instanceof LeadBusinessRuleError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 422 });
    }

    console.error("PATCH /api/leads/[id] failed", {
      message: error instanceof Error ? error.message : "unknown error",
    });
    return NextResponse.json({ ok: false, error: "Failed to update lead" }, { status: 500 });
  }
}
