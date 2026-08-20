import { after, NextResponse } from "next/server";
import { evaluateWorkflowTransition } from "@/src/domain/workflow";
import { getPrisma } from "@/src/lib/prisma";
import {
  LeadArrivalConflictError,
  LeadArrivalNotFoundError,
} from "@/src/services/lead-arrival.service";
import { arrivePlannerAppointment } from "@/src/services/planner-arrival.service";
import { parsePlannerStatus, updatePlannerAppointment } from "@/src/services/planner.service";
import { generateVehicleImageInBackground } from "@/src/services/vehicle-images/vehicle-image-background.service";

export const runtime = "nodejs";
export const maxDuration = 100;

async function observePlannerTransition(id: string, requestedStatus: unknown) {
  const to = parsePlannerStatus(requestedStatus);
  if (!to) return null;
  const existing = await getPrisma().serviceAppointment.findUnique({ where: { id }, select: { status: true } });
  if (!existing || existing.status === to) return null;
  const decision = evaluateWorkflowTransition({ entity: "APPOINTMENT", from: existing.status, to });
  if (!decision.allowed) {
    console.warn("Planner workflow observe-mode deviation", {
      appointmentId: id,
      from: existing.status,
      to,
      code: decision.code,
      missingGates: decision.missingGates,
      availableTargets: decision.availableTargets,
    });
  }
  return decision;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const requestedStatus = parsePlannerStatus(body.status);
    const workflowObservation = await observePlannerTransition(id, body.status);
    const result = requestedStatus === "ARRIVED"
      ? await arrivePlannerAppointment(id, body)
      : await updatePlannerAppointment(id, body);

    if (!result.ok && "notFound" in result) {
      return NextResponse.json({ status: "NOT_FOUND", message: "Запис не знайдено." }, { status: 404 });
    }
    if (!result.ok && "workflowBlocked" in result) {
      return NextResponse.json({
        status: "WORKFLOW_BLOCKED",
        message: "Перехід у статус «Приїхав» заборонений поточним Workflow Runtime.",
        workflowDecision: result.workflowDecision,
      }, { status: 409 });
    }
    if (!result.ok && "arrivalBlocked" in result) {
      return NextResponse.json({
        status: "ARRIVAL_BLOCKED",
        code: result.code,
        message: result.message,
        workflowDecision: result.workflowDecision,
      }, { status: 409 });
    }
    if (!result.ok && "conflict" in result) {
      return NextResponse.json({
        status: "CONFLICT",
        message: result.conflict.resourceType === "MECHANIC"
          ? `Перенесення неможливе: ${result.conflict.resource} уже веде 2 автомобілі одночасно. Третє паралельне авто заборонено.`
          : `Перенесення неможливе: ${result.conflict.resource} уже зайнятий у цей час.`,
        conflict: result.conflict,
        workflowObservation,
      }, { status: 409 });
    }

    if (result.ok && requestedStatus === "ARRIVED" && "workflowAction" in result && result.workflowAction?.vehicleId) {
      const vehicleId = result.workflowAction.vehicleId;
      after(async () => {
        try {
          await generateVehicleImageInBackground(vehicleId);
        } catch (error) {
          console.error("background vehicle image generation after planner arrival failed", {
            vehicleId,
            message: error instanceof Error ? error.message : "unknown error",
          });
        }
      });
    }

    return NextResponse.json({
      status: "OK",
      appointment: result.appointment,
      warning: result.warning ?? null,
      workflowObservation: "workflowDecision" in result ? result.workflowDecision : workflowObservation,
      workflowAction: "workflowAction" in result ? result.workflowAction : null,
    });
  } catch (error) {
    if (error instanceof LeadArrivalNotFoundError) {
      return NextResponse.json({
        status: "ARRIVAL_BLOCKED",
        code: "LEAD_NOT_FOUND",
        message: "Запис посилається на лід, якого вже немає в CRM. Потрібна ручна перевірка.",
      }, { status: 409 });
    }
    if (error instanceof LeadArrivalConflictError) {
      return NextResponse.json({
        status: "ARRIVAL_BLOCKED",
        code: "CLIENT_VEHICLE_CONFLICT",
        message: error.message,
      }, { status: 409 });
    }

    const code = error instanceof Error ? error.message : "UNKNOWN";
    const message = code === "INVALID_TIME_RANGE"
      ? "Час завершення має бути пізніше часу початку."
      : code === "APPOINTMENT_TOO_LONG"
        ? "Один запис не може тривати більше 24 годин."
        : code === "LOCATION_REQUIRED"
          ? "Оберіть локацію СТО."
          : code === "INVALID_AMOUNT"
            ? "Некоректна попередня сума."
            : "Не вдалося змінити запис.";
    return NextResponse.json({ status: "INVALID_DATA", message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const workflowObservation = await observePlannerTransition(id, "CANCELLED");
  const result = await updatePlannerAppointment(id, { status: "CANCELLED" });
  if (!result.ok && "notFound" in result) {
    return NextResponse.json({ status: "NOT_FOUND", message: "Запис не знайдено." }, { status: 404 });
  }
  return NextResponse.json({ status: "CANCELLED", appointment: result.ok ? result.appointment : null, workflowObservation });
}
