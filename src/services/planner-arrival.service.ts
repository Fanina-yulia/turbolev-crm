import { DiagnosticRequestStatus, LeadStatus } from "@/src/generated/prisma/client";
import { evaluateWorkflowTransition } from "@/src/domain/workflow";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { ensureLeadArrivalInTransaction } from "@/src/services/lead-arrival.service";
import {
  normalizeAppointmentPayload,
  parsePlannerStatus,
  type AppointmentWrite,
  validatePlannerResources,
} from "@/src/services/planner.service";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toAppointmentWrite(existing: {
  locationId: string;
  postId: string | null;
  mechanicId: string | null;
  leadId: string | null;
  clientId: string | null;
  vehicleId: string | null;
  workOrderId: string | null;
  status: string;
  customerName: string | null;
  phone: string | null;
  vehicleLabel: string | null;
  plateNumber: string | null;
  problem: string | null;
  comment: string | null;
  source: string | null;
  estimatedAmount: { toString(): string } | null;
  priority: number;
  plannedStartAt: Date;
  plannedEndAt: Date;
  actualArrivalAt: Date | null;
  actualStartAt: Date | null;
  actualEndAt: Date | null;
  partsEtaAt: Date | null;
  noShowAt: Date | null;
  createdById: string | null;
}): AppointmentWrite {
  const status = parsePlannerStatus(existing.status);
  if (!status) throw new Error(`INVALID_APPOINTMENT_STATUS:${existing.status}`);
  return {
    locationId: existing.locationId,
    postId: existing.postId,
    mechanicId: existing.mechanicId,
    leadId: existing.leadId,
    clientId: existing.clientId,
    vehicleId: existing.vehicleId,
    workOrderId: existing.workOrderId,
    status,
    customerName: existing.customerName,
    phone: existing.phone,
    vehicleLabel: existing.vehicleLabel,
    plateNumber: existing.plateNumber,
    problem: existing.problem,
    comment: existing.comment,
    source: existing.source,
    estimatedAmount: existing.estimatedAmount == null ? null : Number(existing.estimatedAmount.toString()),
    priority: existing.priority,
    plannedStartAt: existing.plannedStartAt,
    plannedEndAt: existing.plannedEndAt,
    actualArrivalAt: existing.actualArrivalAt,
    actualStartAt: existing.actualStartAt,
    actualEndAt: existing.actualEndAt,
    partsEtaAt: existing.partsEtaAt,
    noShowAt: existing.noShowAt,
    createdById: existing.createdById,
  };
}

function diagnosticIdFromMetadata(metadata: unknown) {
  if (!isRecord(metadata)) return null;
  const value = metadata.diagnosticRequestId;
  return typeof value === "string" && value ? value : null;
}

export async function arrivePlannerAppointment(id: string, body: Record<string, unknown>) {
  const prisma = getPrisma();
  const existing = await prisma.serviceAppointment.findUnique({ where: { id } });
  if (!existing) return { ok: false as const, notFound: true as const };

  const current = toAppointmentWrite(existing);
  const input = normalizeAppointmentPayload({ ...body, status: "ARRIVED" }, current);
  if (!input.actualArrivalAt) input.actualArrivalAt = new Date();

  const validation = await validatePlannerResources(input, id);
  if (validation.conflict) return { ok: false as const, conflict: validation.conflict };

  const initialDecision = evaluateWorkflowTransition({ entity: "APPOINTMENT", from: existing.status, to: "ARRIVED" });
  if (existing.status !== "ARRIVED" && !initialDecision.allowed) {
    return { ok: false as const, workflowBlocked: true as const, workflowDecision: initialDecision };
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<{ locked: string | null }[]>`SELECT pg_advisory_xact_lock(hashtext(${`appointment-arrival:${id}`}))::text AS locked`;

    const fresh = await tx.serviceAppointment.findUnique({ where: { id } });
    if (!fresh) return { ok: false as const, notFound: true as const };

    const workflowDecision = evaluateWorkflowTransition({ entity: "APPOINTMENT", from: fresh.status, to: "ARRIVED" });
    if (fresh.status !== "ARRIVED" && !workflowDecision.allowed) {
      return { ok: false as const, workflowBlocked: true as const, workflowDecision };
    }

    const priorAudit = await tx.auditEvent.findFirst({
      where: { entityType: "ServiceAppointment", entityId: id, action: "ARRIVAL_WORKFLOW" },
      orderBy: { createdAt: "desc" },
      select: { metadata: true },
    });
    const priorDiagnosticId = diagnosticIdFromMetadata(priorAudit?.metadata);

    let clientId = fresh.clientId;
    let vehicleId = fresh.vehicleId;
    let diagnosticRequestId: string | null = null;
    let diagnosticStatus: DiagnosticRequestStatus | null = null;
    let leadUpdated = false;
    let reusedDiagnostic = false;
    let followupWorkVisit = false;

    if (fresh.workOrderId && clientId && vehicleId) {
      const workOrder = await tx.workOrder.findUnique({
        where: { id: fresh.workOrderId },
        select: { id: true, clientId: true, vehicleId: true, diagnosticRequestId: true, diagnosticRequest: { select: { status: true } } },
      });
      if (!workOrder || workOrder.clientId !== clientId || workOrder.vehicleId !== vehicleId) {
        return {
          ok: false as const,
          arrivalBlocked: true as const,
          code: "WORK_ORDER_MISMATCH",
          message: "Запис на роботи не відповідає клієнту або автомобілю. Потрібна перевірка сервіс-менеджера.",
          workflowDecision,
        };
      }
      diagnosticRequestId = workOrder.diagnosticRequestId;
      diagnosticStatus = workOrder.diagnosticRequest.status;
      reusedDiagnostic = true;
      followupWorkVisit = true;
      if (fresh.leadId) {
        await tx.lead.update({
          where: { id: fresh.leadId },
          data: {
            status: LeadStatus.ARRIVED,
            nextContactAt: null,
            nextAction: "Провести заплановані роботи",
            lastActivityAt: new Date(),
          },
        });
        leadUpdated = true;
      }
    } else if (fresh.leadId) {
      const conversion = await ensureLeadArrivalInTransaction(tx, fresh.leadId, "CRM / Планувальник");
      clientId = conversion.client.id;
      vehicleId = conversion.vehicle.id;
      diagnosticRequestId = conversion.diagnosticRequest.id;
      diagnosticStatus = conversion.diagnosticRequest.status;
      leadUpdated = conversion.lead.status === "ARRIVED";
      reusedDiagnostic = conversion.reusedDiagnostic;
    } else if (clientId && vehicleId) {
      const priorDiagnostic = priorDiagnosticId
        ? await tx.diagnosticRequest.findUnique({ where: { id: priorDiagnosticId } })
        : null;

      if (priorDiagnostic) {
        diagnosticRequestId = priorDiagnostic.id;
        diagnosticStatus = priorDiagnostic.status;
        reusedDiagnostic = true;
      } else {
        const diagnostic = await tx.diagnosticRequest.create({
          data: { clientId, vehicleId, status: DiagnosticRequestStatus.PENDING },
        });
        diagnosticRequestId = diagnostic.id;
        diagnosticStatus = diagnostic.status;
      }
    } else {
      return {
        ok: false as const,
        arrivalBlocked: true as const,
        code: "CLIENT_VEHICLE_REQUIRED",
        message: "Перед підтвердженням заїзду потрібно ідентифікувати клієнта та автомобіль або прив’язати запис до Активних.",
        workflowDecision,
      };
    }

    if (diagnosticRequestId && !followupWorkVisit) {
      await tx.diagnosticAssignment.upsert({
        where: { diagnosticRequestId },
        create: { diagnosticRequestId, locationId: input.locationId, mechanicId: input.mechanicId },
        update: { locationId: input.locationId, mechanicId: input.mechanicId },
      });
      await tx.diagnosticReview.upsert({
        where: { diagnosticRequestId },
        create: { diagnosticRequestId },
        update: {},
      });
    }

    const before = fresh;
    const appointment = await tx.serviceAppointment.update({
      where: { id },
      data: {
        ...input,
        clientId,
        vehicleId,
        status: "ARRIVED",
        actualArrivalAt: input.actualArrivalAt ?? fresh.actualArrivalAt ?? new Date(),
      },
      include: { post: true, mechanic: true },
    });

    if (fresh.status !== "ARRIVED" || !priorAudit) {
      await tx.auditEvent.create({
        data: {
          actorName: "CRM / Планувальник",
          entityType: "ServiceAppointment",
          entityId: id,
          action: "ARRIVAL_WORKFLOW",
          before: toPrismaJson(before),
          after: toPrismaJson(appointment),
          metadata: toPrismaJson({
            workflowCode: workflowDecision.code,
            actions: workflowDecision.actions,
            leadId: fresh.leadId,
            clientId,
            vehicleId,
            workOrderId: fresh.workOrderId,
            diagnosticRequestId,
            leadUpdated,
            reusedDiagnostic,
            followupWorkVisit,
            diagnosticLocationId: followupWorkVisit ? null : input.locationId,
            diagnosticMechanicId: followupWorkVisit ? null : input.mechanicId,
            vehicleLocation: "RECEPTION",
            hardGate: "WORK_ORDER_AFTER_CONFIRMED_DIAGNOSTICS",
          }),
        },
      });
    }

    return {
      ok: true as const,
      appointment,
      warning: validation.warning,
      workflowDecision,
      workflowAction: {
        status: fresh.status === "ARRIVED" ? "REUSED" as const : "EXECUTED" as const,
        actions: workflowDecision.actions,
        leadId: fresh.leadId,
        clientId,
        vehicleId,
        workOrderId: fresh.workOrderId,
        diagnosticRequestId,
        diagnosticStatus,
        vehicleLocation: "RECEPTION" as const,
        reusedDiagnostic,
        followupWorkVisit,
      },
    };
  });
}
