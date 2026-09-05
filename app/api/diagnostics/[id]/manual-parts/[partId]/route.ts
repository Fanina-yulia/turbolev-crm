import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getStructuredDiagnostic, StructuredDiagnosticError } from "@/src/services/structured-diagnostics.service";
import {
  cancelDiagnosticManualPart,
  DiagnosticManualPartError,
  updateDiagnosticManualPart,
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
  console.error("diagnostic manual part route failed", error);
  return NextResponse.json({ ok: false, error: "MANUAL_PART_FAILED", message: "Не вдалося опрацювати деталь до заміни." }, { status: 500 });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string; partId: string }> }) {
  const { id, partId } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.WORK_ORDERS_WRITE, { request, minimumScope: "LOCATION", strict: true });
    if (!access.allowed) return access.response!;
    if (!access.context.user) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    if (!(await locationAllowed(access, id))) return NextResponse.json({ ok: false, error: "LOCATION_FORBIDDEN" }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const part = await updateDiagnosticManualPart(id, partId, body, actor(access));
    return NextResponse.json({ ok: true, part });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string; partId: string }> }) {
  const { id, partId } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.WORK_ORDERS_WRITE, { request, minimumScope: "LOCATION", strict: true });
    if (!access.allowed) return access.response!;
    if (!access.context.user) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    if (!(await locationAllowed(access, id))) return NextResponse.json({ ok: false, error: "LOCATION_FORBIDDEN" }, { status: 403 });
    const result = await cancelDiagnosticManualPart(id, partId, actor(access));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
