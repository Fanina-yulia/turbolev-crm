import { NextRequest, NextResponse } from "next/server";
import {
  LeadDtoError,
  parseQuickFilter,
  parseStatusFilter,
} from "@/src/dto/leads";
import { listLeads } from "@/src/services/leads.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const assignedUserId = params.get("assignedUserId")?.trim() || undefined;

    const result = await listLeads({
      statuses: parseStatusFilter(params.get("status")),
      assignedUserId,
      quickFilter: parseQuickFilter(params.get("quickFilter")),
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof LeadDtoError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    console.error("GET /api/leads failed", {
      message: error instanceof Error ? error.message : "unknown error",
    });
    return NextResponse.json({ ok: false, error: "Failed to load leads" }, { status: 500 });
  }
}
