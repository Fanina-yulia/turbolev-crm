import { NextResponse } from "next/server";
import { DiagnosticRequestStatus } from "@/src/generated/prisma/client";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import {
  DiagnosticNotFoundError,
  DiagnosticTransitionError,
  DiagnosticValidationError,
  getDiagnostic,
  parseDiagnosticStatus,
  transitionDiagnostic,
} from "@/src/services/diagnostics.service";
import {
  getStructuredDiagnostic,
  getStructuredDiagnosticForMechanic,
  StructuredDiagnosticError,
} from "@/src/services/structured-diagnostics.service";
import { syncVehicleIssuesFromDiagnostic } from "@/src/services/vehicle-issues.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function assertScope(access: Awaited<ReturnType<typeof authorize>>, diagnosticRequestId: string) {
  if (!access.context.user) return false;
  if (access.context.roles.some((role) => role.code === "MECHANIC")) {
    await getStructuredDiagnosticForMechanic(access.context.user.id, diagnosticRequestId);
    return true;
  }
  if (access.shadowBypass || access.grantedScope === "ALL") return true;
  const view = await getStructuredDiagnostic(diagnosticRequestId);
  const locationId = view.diagnostic.assignment?.locationId || null;
  return Boolean(locationId && access.context.locationIds.includes(locationId));
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.DIAGNOSTICS_READ, { request, minimumScope: "SELF" });
    if (!access.allowed) return access.response!;
    if (!(await assertScope(access, id))) return NextResponse.json({ ok: false, error: "LOCATION_FORBIDDEN" }, { status: 403 });
    const diagnostic = await getDiagnostic(id);
    if (!diagnostic) return NextResponse.json({ ok: false, error: "Діагностику не знайдено." }, { status: 404 });
    return NextResponse.json({ ok: true, diagnostic }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof StructuredDiagnosticError) return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    console.error("GET /api/diagnostics/[id] failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити діагностику." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const body = await request.json() as Record<string, unknown>;
    const status = parseDiagnosticStatus(body.status);
    if (!status) return NextResponse.json({ ok: false, error: "Оберіть коректний статус діагностики." }, { status: 400 });
    const permission = status === DiagnosticRequestStatus.CONFIRMED ? PERMISSIONS.DIAGNOSTICS_CONFIRM : PERMISSIONS.DIAGNOSTICS_WRITE;
    const access = await authorize(permission, { request, minimumScope: status === DiagnosticRequestStatus.CONFIRMED ? "LOCATION" : "ASSIGNED" });
    if (!access.allowed) return access.response!;
    if (!access.context.user) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    if (!(await assertScope(access, id))) return NextResponse.json({ ok: false, error: "LOCATION_FORBIDDEN" }, { status: 403 });
    if (status === DiagnosticRequestStatus.CONFIRMED && access.context.roles.some((role) => role.code === "MECHANIC")) {
      return NextResponse.json({ ok: false, error: "MECHANIC_CANNOT_CONFIRM", message: "Автомеханік передає діагностику сервіс-менеджеру, але не підтверджує її фінально." }, { status: 403 });
    }
    const result = await transitionDiagnostic(id, {
      status,
      technicalConclusion: typeof body.technicalConclusion === "string" ? body.technicalConclusion : undefined,
      actorName: access.context.user.name || "CRM",
      reviewerUserId: status === DiagnosticRequestStatus.CONFIRMED ? access.context.user.id : null,
    });

    let issueSync: { vehicleId: string; created: number; updated: number } | null = null;
    let issueSyncWarning: string | null = null;
    if (status === DiagnosticRequestStatus.CONFIRMED) {
      try {
        issueSync = await syncVehicleIssuesFromDiagnostic(id);
      } catch (syncError) {
        issueSyncWarning = syncError instanceof Error ? syncError.message : "Не вдалося синхронізувати стан автомобіля.";
        console.error("Vehicle issue sync after diagnostic confirmation failed", { diagnosticRequestId: id, syncError });
      }
    }

    return NextResponse.json({ ok: true, ...result, issueSync, issueSyncWarning });
  } catch (error) {
    if (error instanceof DiagnosticNotFoundError) {
      return NextResponse.json({ ok: false, error: "Діагностику не знайдено." }, { status: 404 });
    }
    if (error instanceof DiagnosticValidationError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    if (error instanceof DiagnosticTransitionError) {
      return NextResponse.json({
        ok: false,
        error: "Цей перехід статусу заборонений процесом.",
        workflowDecision: error.decision,
      }, { status: 409 });
    }
    if (error instanceof StructuredDiagnosticError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    }
    console.error("PATCH /api/diagnostics/[id] failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося змінити діагностику." }, { status: 500 });
  }
}
