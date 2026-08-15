import { DiagnosticRequestStatus, Prisma } from "@/src/generated/prisma/client";
import { evaluateWorkflowTransition, type WorkflowTransitionDecision } from "@/src/domain/workflow";
import { getPrisma } from "@/src/lib/prisma";
import { createWorkOrderFromConfirmedDiagnostic } from "@/src/services/work-orders.service";

export class DiagnosticNotFoundError extends Error {
  constructor(id: string) { super(`DiagnosticRequest not found: ${id}`); this.name = "DiagnosticNotFoundError"; }
}

export class DiagnosticValidationError extends Error {}

export class DiagnosticTransitionError extends Error {
  readonly decision: WorkflowTransitionDecision;
  constructor(decision: WorkflowTransitionDecision) {
    super(decision.code);
    this.name = "DiagnosticTransitionError";
    this.decision = decision;
  }
}

export type DiagnosticTransitionInput = {
  status: DiagnosticRequestStatus;
  technicalConclusion?: string | null;
  actorName?: string | null;
};

function clean(value: unknown, max = 10000) {
  if (typeof value !== "string") return null;
  const next = value.trim();
  return next ? next.slice(0, max) : null;
}

function jsonSafe(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function parseDiagnosticStatus(value: unknown): DiagnosticRequestStatus | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return Object.values(DiagnosticRequestStatus).includes(normalized as DiagnosticRequestStatus)
    ? normalized as DiagnosticRequestStatus
    : null;
}

export async function listDiagnostics(input?: { status?: DiagnosticRequestStatus | null; limit?: number }) {
  const prisma = getPrisma();
  const limit = Math.max(1, Math.min(500, input?.limit ?? 200));
  return prisma.diagnosticRequest.findMany({
    where: input?.status ? { status: input.status } : undefined,
    include: {
      client: { select: { id: true, name: true, phone: true } },
      vehicle: { select: { id: true, brand: true, model: true, year: true, plateNumber: true, vin: true, mileageKm: true } },
      lead: { select: { id: true, need: true, comment: true, assignedUserId: true } },
      workOrder: true,
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
  });
}

export async function getDiagnostic(id: string) {
  const prisma = getPrisma();
  return prisma.diagnosticRequest.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true, phone: true } },
      vehicle: { select: { id: true, brand: true, model: true, year: true, plateNumber: true, vin: true, mileageKm: true } },
      lead: { select: { id: true, need: true, comment: true, assignedUserId: true } },
      workOrder: true,
    },
  });
}

export async function transitionDiagnostic(id: string, input: DiagnosticTransitionInput) {
  const prisma = getPrisma();
  const actorName = clean(input.actorName, 160) || "CRM";
  const conclusion = clean(input.technicalConclusion, 10000);

  const current = await prisma.diagnosticRequest.findUnique({ where: { id }, include: { workOrder: true } });
  if (!current) throw new DiagnosticNotFoundError(id);

  const decision = evaluateWorkflowTransition({ entity: "DIAGNOSTIC", from: current.status, to: input.status });
  if (!decision.allowed) throw new DiagnosticTransitionError(decision);

  if (input.status === DiagnosticRequestStatus.CONFIRMED && !(conclusion || current.technicalConclusion?.trim())) {
    throw new DiagnosticValidationError("Для підтвердження діагностики заповніть технічний висновок.");
  }

  if (decision.code !== "NOOP") {
    await prisma.$transaction(async (tx) => {
      const before = await tx.diagnosticRequest.findUnique({ where: { id } });
      if (!before) throw new DiagnosticNotFoundError(id);
      const freshDecision = evaluateWorkflowTransition({ entity: "DIAGNOSTIC", from: before.status, to: input.status });
      if (!freshDecision.allowed) throw new DiagnosticTransitionError(freshDecision);

      const after = await tx.diagnosticRequest.update({
        where: { id },
        data: {
          status: input.status,
          technicalConclusion: conclusion ?? undefined,
          confirmedAt: input.status === DiagnosticRequestStatus.CONFIRMED ? before.confirmedAt ?? new Date() : undefined,
        },
      });

      await tx.auditEvent.create({
        data: {
          actorName,
          entityType: "DiagnosticRequest",
          entityId: id,
          action: `STATUS_${before.status}_TO_${after.status}`,
          before: jsonSafe(before),
          after: jsonSafe(after),
          metadata: jsonSafe({
            workflowDecision: freshDecision.code,
            actions: freshDecision.actions,
            hardGate: "WORK_ORDER_AFTER_CONFIRMED_DIAGNOSTICS",
          }),
        },
      });
    });
  } else if (conclusion && conclusion !== current.technicalConclusion) {
    await prisma.$transaction(async (tx) => {
      const after = await tx.diagnosticRequest.update({ where: { id }, data: { technicalConclusion: conclusion } });
      await tx.auditEvent.create({
        data: {
          actorName,
          entityType: "DiagnosticRequest",
          entityId: id,
          action: "UPDATE_TECHNICAL_CONCLUSION",
          before: jsonSafe(current),
          after: jsonSafe(after),
        },
      });
    });
  }

  let workOrder = current.workOrder;
  if (input.status === DiagnosticRequestStatus.CONFIRMED) {
    workOrder = await createWorkOrderFromConfirmedDiagnostic(id);
    await prisma.auditEvent.create({
      data: {
        actorName,
        entityType: "WorkOrder",
        entityId: workOrder.id,
        action: "CREATE_AFTER_CONFIRMED_DIAGNOSTICS",
        after: jsonSafe(workOrder),
        metadata: jsonSafe({ diagnosticRequestId: id, hardGate: "WORK_ORDER_AFTER_CONFIRMED_DIAGNOSTICS", passed: true }),
      },
    }).catch(() => undefined);
  }

  const diagnostic = await getDiagnostic(id);
  if (!diagnostic) throw new DiagnosticNotFoundError(id);
  return { diagnostic, workOrder: diagnostic.workOrder ?? workOrder, workflowDecision: decision };
}
