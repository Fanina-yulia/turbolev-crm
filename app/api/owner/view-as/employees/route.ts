import { NextResponse } from "next/server";
import { getActualAccessContext } from "@/src/security/access-context";
import { OwnerViewAsError, listOwnerViewAsEmployees } from "@/src/security/owner-view-as";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await getActualAccessContext(request);
    const employees = await listOwnerViewAsEmployees(context);
    return NextResponse.json({ ok: true, employees }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof OwnerViewAsError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    }
    console.error("GET /api/owner/view-as/employees failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: false, error: "OWNER_PREVIEW_EMPLOYEES_FAILED" }, { status: 500 });
  }
}
