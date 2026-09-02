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
import { createPlannerAppointment, normalizeAppointmentPayload } from "@/src/services/planner.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NextStepAction = "BOOK_WORK" | "PARTS_SELECTION";

function parseAction(value: unknown): NextStepAction | null {
  if (value === "BOOK_WORK" || value === "PARTS_SELECTION") return value;
  return null;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.WORK_ORDERS_WRITE, { request, minimumScope: "LOCATION", strict: true });
    if (!access.allowed) return access.response!;

    const view = await getStructuredDiagnostic(id);
    const diagnosticLocationId = view.diagnostic.assignment?.locationId || null;
    if (!access.shadowBypass && access.grantedScope !== "ALL" && (!diagnosticLocationId || !access.context.locationIds.includes(diagnosticLocationId))) {
      return NextResponse.json({ ok: false, error: "LOCATION_FORBIDDEN" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = parseAction(body.action);
    if (!action) return NextResponse.json({ ok: false, error: "NEXT_STEP_REQUIRED", message: "Оберіть наступний маршрут." }, { status: 400 });

    const workOrder = await createWorkOrderFromConfirmedDiagnostic(id);
    const handoff = await importDiagnosticRecommendationsToEstimate(id, access.context.user?.name || "CRM / Сервіс-менеджер");
    let appointment = null;

    if (action === "BOOK_WORK") {
      const locationId = typeof body.locationId === "string" ? body.locationId : diagnosticLocationId;
      const postId = typeof body.postId === "string" ? body.postId : null;
      const mechanicId = typeof body.mechanicId === "string" ? body.mechanicId : null;
      if (!locationId || !postId || !mechanicId || !body.plannedStartAt || !body.plannedEndAt) {
        return NextResponse.json({ ok: false, error: "BOOKING_FIELDS_REQUIRED", message: "Оберіть дату, час, пост і механіка." }, { status: 400 });
      }

      const input = normalizeAppointmentPayload({
        locationId,
        postId,
        mechanicId,
        leadId: null,
        clientId: view.diagnostic.client.id,
        vehicleId: view.diagnostic.vehicle.id,
        workOrderId: workOrder.id,
        status: "BOOKED",
        customerName: view.diagnostic.client.name,
        phone: view.diagnostic.client.phone,
        vehicleLabel: view.diagnostic.vehicle.label,
        plateNumber: view.diagnostic.vehicle.plateNumber,
        problem: view.diagnostic.problem || "Заплановані роботи після діагностики",
        comment: "Повторний візит після діагностичної карти",
        source: "DIAGNOSTIC_FOLLOWUP",
        plannedStartAt: body.plannedStartAt,
        plannedEndAt: body.plannedEndAt,
      });
      const created = await createPlannerAppointment(input);
      if (!created.ok) {
        return NextResponse.json({
          ok: false,
          error: "PLANNER_CONFLICT",
          message: `Обраний ресурс «${created.conflict.resource}» уже зайнятий у цей час.`,
          conflict: created.conflict,
          workOrder,
        }, { status: 409 });
      }
      appointment = created.appointment;

      await getPrisma().workOrderLine.updateMany({
        where: {
          workOrderId: workOrder.id,
          type: { not: "PART" },
          mechanicId: null,
          status: { in: ["DRAFT", "APPROVED"] },
        },
        data: { mechanicId },
      });
    }

    await getPrisma().auditEvent.create({
      data: {
        actorId: access.context.user?.id || null,
        actorName: access.context.user?.name || "CRM / Сервіс-менеджер",
        entityType: "DiagnosticRequest",
        entityId: id,
        action: action === "PARTS_SELECTION" ? "NEXT_STEP_PARTS_SELECTION" : "NEXT_STEP_BOOK_WORK",
        metadata: toPrismaJson({
          workOrderId: workOrder.id,
          appointmentId: appointment?.id || null,
          route: action,
          recommendationsImported: handoff.createdCount ?? 0,
        }),
      },
    }).catch(() => undefined);

    return NextResponse.json({ ok: true, action, workOrder, handoff, appointment });
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
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const resourceValidationCodes = new Set([
      "MECHANIC_REQUIRED",
      "MECHANIC_UNAVAILABLE",
      "POST_UNAVAILABLE",
    ]);
    const message = code === "INVALID_TIME_RANGE"
      ? "Некоректний час запису."
      : code === "LOCATION_REQUIRED"
        ? "Оберіть локацію СТО."
        : code === "MECHANIC_REQUIRED"
          ? "Оберіть механіка для запису."
          : code === "MECHANIC_UNAVAILABLE"
            ? "Обраний механік недоступний для цієї локації."
            : code === "POST_UNAVAILABLE"
              ? "Обраний пост недоступний для цієї локації."
              : "Не вдалося запустити наступний маршрут.";
    console.error("POST diagnostic next-step failed", error);
    return NextResponse.json({ ok: false, error: code, message }, { status: resourceValidationCodes.has(code) || code === "INVALID_TIME_RANGE" || code === "LOCATION_REQUIRED" ? 422 : 500 });
  }
}
