import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import {
  createWorkOrderFromConfirmedDiagnostic,
  DiagnosticRequestNotFoundError,
  WorkOrderHardGateError,
} from "@/src/services/work-orders.service";
import {
  importDiagnosticRecommendationsToEstimate,
  DiagnosticCommercialHandoffError,
} from "@/src/services/diagnostic-commercial-handoff.service";
import { getStructuredDiagnostic, StructuredDiagnosticError } from "@/src/services/structured-diagnostics.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NextStepAction = "BOOK_WORK" | "PARTS_SELECTION";

async function locationAllowed(access: Awaited<ReturnType<typeof authorize>>, diagnosticRequestId: string) {
  if (access.shadowBypass || access.grantedScope === "ALL") return true;
  const view = await getStructuredDiagnostic(diagnosticRequestId);
  const locationId = view.diagnostic.assignment?.locationId || null;
  return Boolean(locationId && access.context.locationIds.includes(locationId));
}

function parseAction(value: unknown): NextStepAction | null {
  if (value === "BOOK_WORK" || value === "PARTS_SELECTION") return value;
  return null;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.WORK_ORDERS_WRITE, { request, minimumScope: "LOCATION", strict: true });
    if (!access.allowed) return access.response!;
    if (!(await locationAllowed(access, id))) {
      return NextResponse.json({ ok: false, error: "LOCATION_FORBIDDEN" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = parseAction(body.action);
    if (!action) return NextResponse.json({ ok: false, error: "NEXT_STEP_REQUIRED", message: "Оберіть наступний маршрут." }, { status: 400 });

    const workOrder = await createWorkOrderFromConfirmedDiagnostic(id);
    const handoff = action === "PARTS_SELECTION"
      ? await importDiagnosticRecommendationsToEstimate(id, access.context.user?.name || "CRM / Сервіс-менеджер")
      : null;

    await getPrisma().auditEvent.create({
      data: {
        actorId: access.context.user?.id || null,
        actorName: access.context.user?.name || "CRM / Сервіс-менеджер",
        entityType: "DiagnosticRequest",
        entityId: id,
        action: action === "PARTS_SELECTION" ? "NEXT_STEP_PARTS_SELECTION" : "NEXT_STEP_BOOK_WORK",
        metadata: toPrismaJson({
          workOrderId: workOrder.id,
          route: action,
          recommendationsImported: handoff?.createdCount ?? 0,
        }),
      },
    }).catch(() => undefined);

    return NextResponse.json({
      ok: true,
      action,
      workOrder,
      handoff,
    });
  } catch (error) {
    if (error instanceof DiagnosticRequestNotFoundError) {
      return NextResponse.json({ ok: false, error: "DIAGNOSTIC_NOT_FOUND", message: "Діагностику не знайдено." }, { status: 404 });
    }
    if (error instanceof WorkOrderHardGateError) {
      return NextResponse.json({ ok: false, error: "DIAGNOSTIC_CARD_REQUIRED", message: "Спочатку створіть діагностичну карту." }, { status: 409 });
    }
    if (error instanceof DiagnosticCommercialHandoffError || error instanceof StructuredDiagnosticError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    }
    console.error("POST diagnostic next-step failed", error);
    return NextResponse.json({ ok: false, error: "NEXT_STEP_FAILED", message: "Не вдалося запустити наступний маршрут." }, { status: 500 });
  }
}
