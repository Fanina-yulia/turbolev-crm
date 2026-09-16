import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import {
  createCommercialProposalFromDiagnostic,
  DiagnosticCommercialProposalError,
} from "@/src/services/diagnostic-commercial-proposal.service";
import { DiagnosticCommercialHandoffError } from "@/src/services/diagnostic-commercial-handoff.service";
import { syncDiagnosticPartSelectionDraftsToWorkOrder } from "@/src/services/diagnostic-part-selection-draft.service";
import { DiagnosticRequestNotFoundError, WorkOrderHardGateError } from "@/src/services/work-orders.service";
import { WorkOrderCommercialError } from "@/src/services/work-order-commercial.service";
import { getStructuredDiagnostic, StructuredDiagnosticError } from "@/src/services/structured-diagnostics.service";
import { markDiagnosticIssuesQuoted } from "@/src/services/vehicle-issues.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function locationAllowed(access: Awaited<ReturnType<typeof authorize>>, diagnosticRequestId: string) {
  if (access.shadowBypass || access.grantedScope === "ALL") return true;
  const view = await getStructuredDiagnostic(diagnosticRequestId);
  const locationId = view.diagnostic.assignment?.locationId || null;
  return Boolean(locationId && access.context.locationIds.includes(locationId));
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.WORK_ORDERS_WRITE, { request, minimumScope: "LOCATION", strict: true });
    if (!access.allowed) return access.response!;
    if (!access.context.user) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    if (!(await locationAllowed(access, id))) return NextResponse.json({ ok: false, error: "LOCATION_FORBIDDEN" }, { status: 403 });

    const actorName = access.context.user.employeeName || access.context.user.name || "CRM / Сервіс-менеджер";
    const result = await createCommercialProposalFromDiagnostic(id, actorName, access.context.user.id);

    let partsSelectionSync: { synced: number; skipped: number } | null = null;
    let partsSelectionSyncWarning: string | null = null;
    try {
      partsSelectionSync = await syncDiagnosticPartSelectionDraftsToWorkOrder(id, { id: access.context.user.id, name: actorName });
    } catch (syncError) {
      partsSelectionSyncWarning = syncError instanceof Error ? syncError.message : "Не вдалося перенести попередньо підібрані деталі в замовлення-наряд.";
      console.error("Staged parts selection promotion failed", { diagnosticRequestId: id, workOrderId: result.workOrder.id, syncError });
    }

    let issueSyncWarning: string | null = null;
    try {
      await markDiagnosticIssuesQuoted(id, result.workOrder.id);
    } catch (issueError) {
      issueSyncWarning = issueError instanceof Error ? issueError.message : "Не вдалося оновити стан проблем автомобіля.";
      console.error("Vehicle issue commercial handoff sync failed", { diagnosticRequestId: id, workOrderId: result.workOrder.id, issueError });
    }
    return NextResponse.json({ ok: true, ...result, partsSelectionSync, partsSelectionSyncWarning, issueSyncWarning });
  } catch (error) {
    if (error instanceof DiagnosticCommercialProposalError || error instanceof DiagnosticCommercialHandoffError || error instanceof StructuredDiagnosticError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    }
    if (error instanceof WorkOrderCommercialError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: 409 });
    }
    if (error instanceof DiagnosticRequestNotFoundError) {
      return NextResponse.json({ ok: false, error: "DIAGNOSTIC_NOT_FOUND", message: "Діагностику не знайдено." }, { status: 404 });
    }
    if (error instanceof WorkOrderHardGateError) {
      return NextResponse.json({ ok: false, error: "DIAGNOSTIC_CARD_REQUIRED", message: "Спочатку підтвердьте Діагностичну карту." }, { status: 409 });
    }
    console.error("POST diagnostic commercial proposal failed", error);
    return NextResponse.json({ ok: false, error: "COMMERCIAL_PROPOSAL_CREATE_FAILED", message: "Не вдалося створити Комерційну пропозицію." }, { status: 500 });
  }
}
