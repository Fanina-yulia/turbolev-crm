import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import {
  createCommercialProposalFromDiagnostic,
  DiagnosticCommercialProposalError,
} from "@/src/services/diagnostic-commercial-proposal.service";
import { DiagnosticCommercialHandoffError } from "@/src/services/diagnostic-commercial-handoff.service";
import { DiagnosticRequestNotFoundError, WorkOrderHardGateError } from "@/src/services/work-orders.service";
import { WorkOrderCommercialError } from "@/src/services/work-order-commercial.service";
import { getStructuredDiagnostic, StructuredDiagnosticError } from "@/src/services/structured-diagnostics.service";

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

    const result = await createCommercialProposalFromDiagnostic(id, access.context.user.name || "CRM / Сервіс-менеджер", access.context.user.id);
    return NextResponse.json({ ok: true, ...result });
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
