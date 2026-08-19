import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import {
  DiagnosticCommercialHandoffError,
  getDiagnosticCommercialHandoff,
  importDiagnosticRecommendationsToEstimate,
} from "@/src/services/diagnostic-commercial-handoff.service";
import { getStructuredDiagnostic, StructuredDiagnosticError } from "@/src/services/structured-diagnostics.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function locationAllowed(access: Awaited<ReturnType<typeof authorize>>, diagnosticRequestId: string) {
  if (access.shadowBypass || access.grantedScope === "ALL") return true;
  const view = await getStructuredDiagnostic(diagnosticRequestId);
  const locationId = view.diagnostic.assignment?.locationId || null;
  return Boolean(locationId && access.context.locationIds.includes(locationId));
}

function failure(error: unknown, operation: string) {
  if (error instanceof DiagnosticCommercialHandoffError || error instanceof StructuredDiagnosticError) {
    return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
  }
  console.error(operation, error);
  return NextResponse.json({ ok: false, error: "DIAGNOSTIC_COMMERCIAL_HANDOFF_FAILED", message: "Не вдалося передати рекомендації у кошторис." }, { status: 500 });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.WORK_ORDERS_READ, { request, minimumScope: "LOCATION" });
    if (!access.allowed) return access.response!;
    if (!(await locationAllowed(access, id))) return NextResponse.json({ ok: false, error: "LOCATION_FORBIDDEN" }, { status: 403 });
    const data = await getDiagnosticCommercialHandoff(id);
    return NextResponse.json({ ok: true, ...data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error, "GET diagnostic commercial handoff failed");
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.WORK_ORDERS_ESTIMATE, { request, minimumScope: "LOCATION" });
    if (!access.allowed) return access.response!;
    if (!(await locationAllowed(access, id))) return NextResponse.json({ ok: false, error: "LOCATION_FORBIDDEN" }, { status: 403 });
    const data = await importDiagnosticRecommendationsToEstimate(id, "CRM / Сервіс-менеджер");
    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    return failure(error, "POST diagnostic commercial handoff failed");
  }
}
