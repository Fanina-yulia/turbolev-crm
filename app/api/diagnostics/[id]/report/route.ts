import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getStructuredDiagnostic } from "@/src/services/structured-diagnostics.service";
import { createDiagnosticReportShare, DiagnosticReportError, latestDiagnosticReportShare, revokeDiagnosticReportShare } from "@/src/services/diagnostic-report.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function allowed(request: Request, diagnosticRequestId: string, write: boolean) {
  const access = await authorize(write ? PERMISSIONS.DIAGNOSTICS_CONFIRM : PERMISSIONS.DIAGNOSTICS_READ, { request, minimumScope: write ? "LOCATION" : "SELF" });
  if (!access.allowed) return { access, response: access.response! };
  if (access.shadowBypass || access.grantedScope === "ALL") return { access, response: null };
  const view = await getStructuredDiagnostic(diagnosticRequestId);
  const locationId = view.diagnostic.assignment?.locationId || null;
  if (!locationId || !access.context.locationIds.includes(locationId)) return { access, response: NextResponse.json({ ok: false, error: "LOCATION_FORBIDDEN" }, { status: 403 }) };
  return { access, response: null };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const gate = await allowed(request, id, false); if (gate.response) return gate.response;
    return NextResponse.json({ ok: true, share: await latestDiagnosticReportShare(id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof DiagnosticReportError) return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    console.error("GET diagnostic report share failed", error); return NextResponse.json({ ok: false, error: "REPORT_SHARE_LOAD_FAILED" }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const gate = await allowed(request, id, true); if (gate.response) return gate.response;
    const result = await createDiagnosticReportShare(id, gate.access.context.user?.id || null);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof DiagnosticReportError) return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    console.error("POST diagnostic report share failed", error); return NextResponse.json({ ok: false, error: "REPORT_SHARE_CREATE_FAILED", message: "Не вдалося створити посилання на звіт." }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const gate = await allowed(request, id, true); if (gate.response) return gate.response;
    const url = new URL(request.url); const shareId = url.searchParams.get("shareId");
    return NextResponse.json({ ok: true, share: await revokeDiagnosticReportShare(id, shareId) });
  } catch (error) {
    if (error instanceof DiagnosticReportError) return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    console.error("DELETE diagnostic report share failed", error); return NextResponse.json({ ok: false, error: "REPORT_SHARE_REVOKE_FAILED" }, { status: 500 });
  }
}
