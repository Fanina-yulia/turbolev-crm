import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { StructuredDiagnosticError, updateDiagnosticCheck } from "@/src/services/structured-diagnostics.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string; checkId: string }> }) {
  const { id, checkId } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.DIAGNOSTICS_WRITE, { request, minimumScope: "ASSIGNED" });
    if (!access.allowed) return access.response!;
    if (!access.context.user || !access.context.roles.some((role) => role.code === "MECHANIC")) {
      return NextResponse.json({ ok: false, error: "MECHANIC_ROLE_REQUIRED" }, { status: 403 });
    }
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const data = await updateDiagnosticCheck(access.context.user.id, id, checkId, {
      state: String(body.state || ""),
      measurementValue: typeof body.measurementValue === "number" || typeof body.measurementValue === "string" ? body.measurementValue : null,
      measurementText: typeof body.measurementText === "string" ? body.measurementText : null,
      note: typeof body.note === "string" ? body.note : null,
      action: typeof body.action === "string" ? body.action : null,
      urgency: typeof body.urgency === "string" ? body.urgency : null,
      findingText: typeof body.findingText === "string" ? body.findingText : null,
    });
    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    if (error instanceof StructuredDiagnosticError) return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    console.error("PATCH diagnostic check failed", error);
    return NextResponse.json({ ok: false, error: "DIAGNOSTIC_CHECK_UPDATE_FAILED" }, { status: 500 });
  }
}
