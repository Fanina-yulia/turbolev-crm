import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { startMechanicDiagnosticByType } from "@/src/services/mechanic-diagnostic-matrix.service";
import { StructuredDiagnosticError } from "@/src/services/structured-diagnostics.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.DIAGNOSTICS_WRITE, { request, minimumScope: "ASSIGNED" });
    if (!access.allowed) return access.response!;
    if (!access.context.user || !access.context.roles.some((role) => role.code === "MECHANIC")) {
      return NextResponse.json({ ok: false, error: "MECHANIC_ROLE_REQUIRED" }, { status: 403 });
    }
    const data = await startMechanicDiagnosticByType(access.context.user.id, id);
    return NextResponse.json({ ok: true, ...data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof StructuredDiagnosticError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    }
    console.error("POST mechanic diagnostic matrix start failed", error);
    return NextResponse.json({ ok: false, error: "DIAGNOSTIC_MATRIX_START_FAILED" }, { status: 500 });
  }
}
