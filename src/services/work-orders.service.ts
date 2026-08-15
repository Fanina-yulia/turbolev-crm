import { DiagnosticRequestStatus, Prisma } from "@/src/generated/prisma/client";
import {
  HARD_GATE_CODES,
  HARD_GATE_LABELS,
  WORK_ORDER_INITIAL_STATUS,
  WORKFLOW_ACTION_LABELS,
  evaluateWorkflowTransition,
  getAllowedTransitions,
  getWorkflowStatus,
  getWorkflowStatusLabel,
  normalizeWorkflowStatus,
  type WorkflowActionCode,
  type WorkflowTransitionDecision,
} from "@/src/domain/workflow";
import { getPrisma } from "@/src/lib/prisma";

export class DiagnosticRequestNotFoundError extends Error {
  constructor(id: string) {
    super(`DiagnosticRequest not found: ${id}`);
    this.name = "DiagnosticRequestNotFoundError";
  }
}

export class WorkOrderNotFoundError extends Error {
  constructor(id: string) {
    super(`WorkOrder not found: ${id}`);
    this.name = "WorkOrderNotFoundError";
  }
}

export class WorkOrderHardGateError extends Error {
  readonly gate = HARD_GATE_CODES.WORK_ORDER_AFTER_CONFIRMED_DIAGNOSTICS;

  constructor(message = "WorkOrder is blocked until diagnostics are confirmed") {
    super(message);
    this.name = "WorkOrderHardGateError";
  }
}

export class WorkOrderTransitionError extends Error {
  readonly decision: WorkflowTransitionDecision;
  readonly unsupportedActions: readonly WorkflowActionCode[];

  constructor(decision: WorkflowTransitionDecision, unsupportedActions: readonly WorkflowActionCode[] = []) {
    super(unsupportedActions.length ? "ACTIONS_NOT_IMPLEMENTED" : decision.code);
    this.name = "WorkOrderTransitionError";
    this.decision = decision;
    this.unsupportedActions = unsupportedActions;
  }
}

function jsonSafe(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

const IMPLEMENTED_WORK_ORDER_ACTIONS = new Set<WorkflowActionCode>(["CLOSE_WORK_ORDER"]);

function unsupportedActions(actions: readonly WorkflowActionCode[]) {
  return actions.filter((action) => !IMPLEMENTED_WORK_ORDER_ACTIONS.has(action));
}

function transitionView(from: string, to: string) {
  const decision = evaluateWorkflowTransition({ entity: "WORK_ORDER", from, to, gates: {} });
  const unsupported = unsupportedActions(decision.actions);
  return {
    to: decision.normalizedTo,
    label: getWorkflowStatusLabel("WORK_ORDER", decision.normalizedTo),
    allowed: decision.allowed && unsupported.length === 0,
    code: unsupported.length ? "ACTIONS_NOT_IMPLEMENTED" : decision.code,
    requiredGates: decision.requiredGates.map((code) => ({ code, label: HARD_GATE_LABELS[code] })),
    missingGates: decision.missingGates.map((code) => ({ code, label: HARD_GATE_LABELS[code] })),
    actions: decision.actions.map((code) => ({ code, label: WORKFLOW_ACTION_LABELS[code] })),
    unsupportedActions: unsupported.map((code) => ({ code, label: WORKFLOW_ACTION_LABELS[code] })),
  };
}

function decorateWorkOrder<T extends { status: string }>(workOrder: T) {
  const status = normalizeWorkflowStatus("WORK_ORDER", workOrder.status);
  const statusDefinition = getWorkflowStatus("WORK_ORDER", status);
  const transitions = getAllowedTransitions("WORK_ORDER", status).map((item) => transitionView(status, item.to));
  return {
    ...workOrder,
    status,
    statusLabel: statusDefinition?.label ?? status,
    statusTone: statusDefinition?.tone ?? "neutral",
    stage: statusDefinition?.stage ?? null,
    transitions,
  };
}

/**
 * The only supported application-level WorkOrder factory.
 * Hard Gate #1 is checked inside the same DB transaction as idempotent WorkOrder creation.
 */
export async function createWorkOrderFromConfirmedDiagnostic(diagnosticRequestId: string) {
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    const diagnosticRequest = await tx.diagnosticRequest.findUnique({
      where: { id: diagnosticRequestId },
      include: { workOrder: true },
    });

    if (!diagnosticRequest) {
      throw new DiagnosticRequestNotFoundError(diagnosticRequestId);
    }

    if (
      diagnosticRequest.status !== DiagnosticRequestStatus.CONFIRMED ||
      !diagnosticRequest.confirmedAt
    ) {
      throw new WorkOrderHardGateError();
    }

    const workOrder = diagnosticRequest.workOrder ?? await tx.workOrder.upsert({
      where: { diagnosticRequestId: diagnosticRequest.id },
      update: {},
      create: {
        clientId: diagnosticRequest.clientId,
        vehicleId: diagnosticRequest.vehicleId,
        diagnosticRequestId: diagnosticRequest.id,
        status: WORK_ORDER_INITIAL_STATUS,
      },
    });

    if (diagnosticRequest.leadId) {
      await tx.serviceAppointment.updateMany({
        where: { leadId: diagnosticRequest.leadId },
        data: {
          clientId: diagnosticRequest.clientId,
          vehicleId: diagnosticRequest.vehicleId,
          workOrderId: workOrder.id,
        },
      });
    }

    return workOrder;
  });
}

const workOrderInclude = {
  client: { select: { id: true, name: true, phone: true } },
  vehicle: {
    select: {
      id: true,
      brand: true,
      model: true,
      year: true,
      plateNumber: true,
      vin: true,
      mileageKm: true,
      turboLevClass: true,
    },
  },
  diagnosticRequest: {
    select: {
      id: true,
      status: true,
      technicalConclusion: true,
      confirmedAt: true,
      leadId: true,
      createdAt: true,
    },
  },
} as const;

export async function listWorkOrders(input?: { status?: string | null; limit?: number }) {
  const prisma = getPrisma();
  const limit = Math.max(1, Math.min(500, input?.limit ?? 200));
  const rawStatus = input?.status?.trim().toUpperCase() || null;
  const canonicalStatus = rawStatus ? normalizeWorkflowStatus("WORK_ORDER", rawStatus) : null;
  if (canonicalStatus && !getWorkflowStatus("WORK_ORDER", canonicalStatus)) return [];

  const rows = await prisma.workOrder.findMany({
    where: canonicalStatus ? { status: canonicalStatus } : undefined,
    include: workOrderInclude,
    orderBy: [{ closedAt: "asc" }, { updatedAt: "desc" }],
    take: limit,
  });

  return rows.map(decorateWorkOrder);
}

export async function getWorkOrder(id: string) {
  const prisma = getPrisma();
  const workOrder = await prisma.workOrder.findUnique({ where: { id }, include: workOrderInclude });
  if (!workOrder) return null;

  const [appointment, recentCalls] = await Promise.all([
    workOrder.diagnosticRequest.leadId
      ? prisma.serviceAppointment.findFirst({
          where: { leadId: workOrder.diagnosticRequest.leadId },
          orderBy: { createdAt: "desc" },
          include: { post: true, mechanic: true },
        })
      : Promise.resolve(null),
    prisma.callHistory.findMany({
      where: { OR: [{ workOrderId: id }, { clientId: workOrder.clientId }] },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        type: true,
        status: true,
        duration: true,
        startedAt: true,
        recordingUrl: true,
      },
    }),
  ]);

  return { ...decorateWorkOrder(workOrder), appointment, recentCalls };
}

export async function transitionWorkOrder(id: string, toStatus: string, actorName = "CRM") {
  const prisma = getPrisma();
  const requested = toStatus.trim().toUpperCase();
  if (!getWorkflowStatus("WORK_ORDER", requested)) {
    const current = await prisma.workOrder.findUnique({ where: { id }, select: { status: true } });
    if (!current) throw new WorkOrderNotFoundError(id);
    throw new WorkOrderTransitionError(evaluateWorkflowTransition({ entity: "WORK_ORDER", from: current.status, to: requested }));
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`work-order-transition:${id}`}))`;
    const current = await tx.workOrder.findUnique({ where: { id }, include: workOrderInclude });
    if (!current) throw new WorkOrderNotFoundError(id);

    const decision = evaluateWorkflowTransition({ entity: "WORK_ORDER", from: current.status, to: requested, gates: {} });
    const unsupported = unsupportedActions(decision.actions);
    if (!decision.allowed || unsupported.length) throw new WorkOrderTransitionError(decision, unsupported);

    if (decision.code === "NOOP") return decorateWorkOrder(current);

    const terminal = decision.normalizedTo === "CLOSED" || decision.normalizedTo === "CANCELLED";
    const updated = await tx.workOrder.update({
      where: { id },
      data: {
        status: decision.normalizedTo,
        closedAt: terminal ? current.closedAt ?? new Date() : null,
      },
      include: workOrderInclude,
    });

    await tx.auditEvent.create({
      data: {
        actorName,
        entityType: "WorkOrder",
        entityId: id,
        action: `STATUS_${decision.normalizedFrom}_TO_${decision.normalizedTo}`,
        before: jsonSafe(current),
        after: jsonSafe(updated),
        metadata: jsonSafe({
          workflowCode: decision.code,
          requiredGates: decision.requiredGates,
          actions: decision.actions,
        }),
      },
    });

    if (decision.normalizedTo === "CLOSED" && current.diagnosticRequest.leadId) {
      await tx.serviceAppointment.updateMany({
        where: { leadId: current.diagnosticRequest.leadId },
        data: { status: "COMPLETED", actualEndAt: new Date(), workOrderId: id },
      });
    }

    return decorateWorkOrder(updated);
  });
}
