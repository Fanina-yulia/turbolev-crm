import { NextResponse } from "next/server";
import { getAccessContext, hasPermission } from "@/src/security/access-context";
import { PERMISSIONS } from "@/src/security/permissions";
import { listMechanicDiagnosticsReadOnly } from "@/src/services/mechanic-diagnostics-read.service";
import { StructuredDiagnosticError } from "@/src/services/structured-diagnostics.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await getAccessContext(request);
    if (!context.authenticated || !context.user) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    if (!context.roles.some((role) => role.code === "MECHANIC")) return NextResponse.json({ ok: false, error: "MECHANIC_ROLE_REQUIRED" }, { status: 403 });
    if (!hasPermission(context, PERMISSIONS.DIAGNOSTICS_READ)) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    const data = await listMechanicDiagnosticsReadOnly(context.user.id);
    return NextResponse.json({ ok: true, ...data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof StructuredDiagnosticError) return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    console.error("GET /api/diagnostics/me failed", error);
    return NextResponse.json({ ok: false, error: "MECHANIC_DIAGNOSTICS_LOAD_FAILED" }, { status: 500 });
  }
}
