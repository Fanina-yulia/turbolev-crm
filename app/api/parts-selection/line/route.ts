import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import {
  DiagnosticPartSelectionDraftError,
  listDiagnosticPartCartRows,
  updateDiagnosticPartCartRow,
} from "@/src/services/diagnostic-part-selection-draft.service";
import { getStructuredDiagnostic, StructuredDiagnosticError } from "@/src/services/structured-diagnostics.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clean(value: unknown, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function locationAllowed(access: Awaited<ReturnType<typeof authorize>>, diagnosticId: string) {
  if (access.shadowBypass || access.grantedScope === "ALL") return true;
  const view = await getStructuredDiagnostic(diagnosticId);
  const locationId = view.diagnostic.assignment?.locationId || null;
  return Boolean(locationId && access.context.locationIds.includes(locationId));
}

function failure(error: unknown, operation: string) {
  if (error instanceof DiagnosticPartSelectionDraftError || error instanceof StructuredDiagnosticError) {
    return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
  }
  console.error(operation, error);
  return NextResponse.json({ ok: false, error: "PART_CART_FAILED", message: "Не вдалося виконати операцію з кошиком запчастин." }, { status: 500 });
}

export async function GET(request: Request) {
  const access = await authorize(PERMISSIONS.PARTS_READ, { request, minimumScope: "LOCATION", strict: true });
  if (!access.allowed) return access.response!;
  try {
    const diagnosticId = new URL(request.url).searchParams.get("diagnosticId")?.trim() || "";
    if (!diagnosticId) return NextResponse.json({ ok: false, error: "DIAGNOSTIC_REQUIRED", message: "Не передано Діагностичну карту." }, { status: 400 });
    if (!(await locationAllowed(access, diagnosticId))) return NextResponse.json({ ok: false, error: "LOCATION_FORBIDDEN" }, { status: 403 });
    const rows = await listDiagnosticPartCartRows(diagnosticId);
    return NextResponse.json({ ok: true, rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error, "GET /api/parts-selection/line failed");
  }
}

export async function PATCH(request: Request) {
  const access = await authorize(PERMISSIONS.PARTS_WRITE, { request, minimumScope: "LOCATION", strict: true });
  if (!access.allowed) return access.response!;
  const actorUser = access.context.user;
  if (!actorUser) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });

  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const diagnosticId = clean(body?.diagnosticId, 160);
    const lineId = clean(body?.lineId, 220);
    if (!diagnosticId || !lineId || !body) return NextResponse.json({ ok: false, error: "CONTEXT_REQUIRED", message: "Не передано контекст редагування." }, { status: 400 });
    if (!(await locationAllowed(access, diagnosticId))) return NextResponse.json({ ok: false, error: "LOCATION_FORBIDDEN" }, { status: 403 });

    const actorName = actorUser.employeeName || actorUser.name || "CRM / Підбір запчастин";
    const row = await updateDiagnosticPartCartRow(diagnosticId, lineId, body, { id: actorUser.id, name: actorName });
    if (!row) return NextResponse.json({ ok: false, error: "PART_LINE_NOT_FOUND", message: "Рядок кошика не знайдено після збереження." }, { status: 404 });
    return NextResponse.json({ ok: true, row });
  } catch (error) {
    return failure(error, "PATCH /api/parts-selection/line failed");
  }
}
