import { NextResponse } from "next/server";
import {
  convertLead,
  LeadConflictError,
  LeadNotFoundError,
} from "@/src/services/leads.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const result = await convertLead(id);
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    if (error instanceof LeadNotFoundError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 404 });
    }
    if (error instanceof LeadConflictError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
    }

    console.error("POST /api/leads/[id]/convert failed", {
      message: error instanceof Error ? error.message : "unknown error",
    });
    return NextResponse.json({ ok: false, error: "Failed to convert lead" }, { status: 500 });
  }
}
