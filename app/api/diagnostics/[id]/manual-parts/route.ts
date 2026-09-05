import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getStructuredDiagnostic, StructuredDiagnosticError } from "@/src/services/structured-diagnostics.service";
import {
  createDiagnosticManualPart,
  DiagnosticManualPartError,
  listDiagnosticManualParts,
} from "@/src/services/diagnostic-manual-parts.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function locationAllowed(access: Awaited<ReturnType<typeof authorize>>, diagnosticRequestId: string) {
  if (access.shadowBypass || access.grantedScope === "ALL") return true;
  const view = await getStructuredDiagnostic(diagnosticRequestId);
  const locationId = view.diagnostic.assignment?.locationId || null;
  return Boolean(locationId && access.context.locationIds.includes(locationId));
}

function actor(access: Awaited<ReturnType<typeof authorize>>) {
  return {
    id: access.context.user?.id || "crm",
    name: access.context.user?.employeeName || access.context.user?.name || "CRM / Сервіс-менеджер",
  };
}

function errorResponse(error: unknown) {
  if (error instanceof DiagnosticManualPartError || error instanceof StructuredDiagnosticError) {
    return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
  }
  console.error("diagnostic manual parts route failed", error);
  return NextResponse.json({ ok: false, error: "MANUAL_PARTS_FAILED", message: "Не вдалося опрацювати деталі до заміни." }, { status: 500 });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.PARTS_READ, { request, minimumScope: "SELF" });
    if (!access.allowed) return access.response!;
    if (!(await locationAllowed(access, id))) return NextResponse.json({ ok: false, error: "LOCATION_FORBIDDEN" }, { status: 403 });
    const parts = await listDiagnosticManualParts(id);
    return NextResponse.json({ ok: true, parts }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.WORK_ORDERS_WRITE, { request, minimumScope: "LOCATION", strict: true });
    if (!access.allowed) return access.response!;
    if (!access.context.user) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    if (!(await locationAllowed(access, id))) return NextResponse.json({ ok: false, error: "LOCATION_FORBIDDEN" }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const part = await createDiagnosticManualPart(id, body, actor(access));
    return NextResponse.json({ ok: true, part }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
