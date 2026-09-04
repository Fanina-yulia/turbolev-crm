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
  type HardGateCode,
  type WorkflowActionCode,
  type WorkflowGateState,
  type WorkflowTransitionDecision,
} from "@/src/domain/workflow";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import {
  ensureEstimateSnapshotTx,
  ensurePartsRequestTx,
} from "@/src/services/work-order-commercial.service";
import {
  getWorkOrderCycleGateStateTx,
  getWorkOrderCycleState,
} from "@/src/services/work-order-cycle.service";
import { ensureQualityControlTaskTx } from "@/src/services/work-order-qc.service";
import { finalizeWorkOrderFinanceFromLines } from "@/src/services/work-order-lines.service";
import type { PlannerStatus } from "@/src/services/planner.service";

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

const IMPLEMENTED_WORK_ORDER_ACTIONS = new Set<WorkflowActionCode>([
  "CREATE_ESTIMATE",
  "OPEN_PARTS_REQUEST",
  "CREATE_QC_TASK",
  "SET_VEHICLE_LOCATION_QC",
  "SET_VEHICLE_LOCATION_READY",
  "CLOSE_WORK_ORDER",
]);

function unsupportedActions(actions: readonly WorkflowActionCode[]) {
  return actions.filter((action) => !IMPLEMENTED_WORK_ORDER_ACTIONS.has(action));
}

function uniqueGates(values: readonly HardGateCode[]) {
  return [...new Set(values)];
}

function evaluateWorkOrderTransition(from: string, to: string, gates: WorkflowGateState = {}) {
  const base = evaluateWorkflowTransition({ entity: "WORK_ORDER", from, to, gates });
  if (!base.allowed || base.code === "NOOP" || base.normalizedTo !== "READY_FOR_REPAIR") return base;

  const operational: HardGateCode[] = [
    "ESTIMATE_APPROVED_BEFORE_REPAIR",
    "REQUIRED_PARTS_READY_BEFORE_REPAIR",
  ];
  const missing = operational.filter((gate) => gates[gate] !== true);
  if (!missing.length) return base;

  const requiredGates = uniqueGates([...base.requiredGates, ...operational]);
  const missingGates = uniqueGates([...base.missingGates, ...missing]);
  return {
    ...base,
    allowed: false,
    code: "GATES_NOT_SATISFIED" as const,
    requiredGates,
    missingGates,
    satisfiedGates: requiredGates.filter((gate) => gates[gate] === true),
  };
}

function transitionView(from: string, to: string, gates: WorkflowGateState = {}) {
  const decision = evaluateWorkOrderTransition(from, to, gates);
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

function decorateWorkOrder<T extends { status: string }>(workOrder: T, gates: WorkflowGateState = {}) {
  const status = normalizeWorkflowStatus("WORK_ORDER", workOrder.status);
  const statusDefinition = getWorkflowStatus("WORK_ORDER", status);
  return {
    ...workOrder,
    status,
    statusLabel: statusDefinition?.label ?? status,
    statusTone: statusDefinition?.tone ?? "neutral",
    stage: statusDefinition?.stage ?? null,
    transitions: getAllowedTransitions("WORK_ORDER", status).map((item) => transitionView(status, item.to, gates)),
  };
}

export async function createWorkOrderFromConfirmedDiagnostic(diagnosticRequestId: string) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const diagnosticRequest = await tx.diagnosticRequest.findUnique({
      where: { id: diagnosticRequestId },
      include: { workOrder: true },
    });
    if (!diagnosticRequest) throw new DiagnosticRequestNotFoundError(diagnosticRequestId);
    if (diagnosticRequest.status !== DiagnosticRequestStatus.CONFIRMED || !diagnosticRequest.confirmedAt) {
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
    // A confirmed diagnostic creates a repair case, not a repair appointment.
    // Only an explicitly scheduled REPAIR appointment may receive this WorkOrder.
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

export async function listWorkOrders(input?: { status?: string | null; limit?: number; ids?: string[] | null }) {
  const prisma = getPrisma();
  const limit = Math.max(1, Math.min(500, input?.limit ?? 200));
  const rawStatus = input?.status?.trim().toUpperCase() || null;
  const canonicalStatus = rawStatus ? normalizeWorkflowStatus("WORK_ORDER", rawStatus) : null;
  if (canonicalStatus && !getWorkflowStatus("WORK_ORDER", canonicalStatus)) return [];
  if (Array.isArray(input?.ids) && input.ids.length === 0) return [];

  const filters: Prisma.WorkOrderWhereInput[] = [];
  if (canonicalStatus) filters.push({ status: canonicalStatus });
  if (Array.isArray(input?.ids)) filters.push({ id: { in: input.ids } });

  const rows = await prisma.workOrder.findMany({
    where: filters.length ? { AND: filters } : undefined,
    include: workOrderInclude,
    orderBy: [{ closedAt: "asc" }, { updatedAt: "desc" }],
    take: limit,
  });
  return rows.map((row) => decorateWorkOrder(row));
}

export async function getWorkOrder(id: string) {
  const prisma = getPrisma();
  const workOrder = await prisma.workOrder.findUnique({ where: { id }, include: workOrderInclude });
  if (!workOrder) return null;

  const [appointment, recentCalls, cycle] = await Promise.all([
    prisma.serviceAppointment.findFirst({
      where: { workOrderId: id },
      orderBy: { createdAt: "desc" },
      include: { post: true, mechanic: true },
    }),
    prisma.callHistory.findMany({
      where: { OR: [{ workOrderId: id }, { clientId: workOrder.clientId }] },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, type: true, status: true, duration: true, startedAt: true, recordingUrl: true },
    }),
    getWorkOrderCycleState(id),
  ]);

  return {
    ...decorateWorkOrder(workOrder, cycle.gates),
    appointment,
    recentCalls,
    commercial: cycle.commercial,
    qualityControl: cycle.qc,
    financeGate: cycle.finance,
  };
}

async function executeWorkOrderActions(
  tx: Prisma.TransactionClient,
  workOrderId: string,
  actions: readonly WorkflowActionCode[],
  actorName: string,
) {
  const results: Record<string, unknown> = {};
  for (const action of actions) {
    if (action === "CREATE_ESTIMATE") {
      const result = await ensureEstimateSnapshotTx(tx, workOrderId, { send: true, actorName });
      results[action] = { estimateId: result.estimate.id, revision: result.estimate.revision, status: result.estimate.status };
    } else if (action === "OPEN_PARTS_REQUEST") {
      const request = await ensurePartsRequestTx(tx, workOrderId, actorName);
      results[action] = { partsRequestId: request.id, status: request.status, itemCount: request.items.length };
    } else if (action === "CREATE_QC_TASK") {
      const task = await ensureQualityControlTaskTx(tx, workOrderId, actorName);
      results[action] = { qualityControlId: task.id, attempt: task.attempt, status: task.status };
    } else if (action === "SET_VEHICLE_LOCATION_QC" || action === "SET_VEHICLE_LOCATION_READY") {
      results[action] = { handledByPlannerStatusSync: true };
    } else if (action === "CLOSE_WORK_ORDER") {
      results[action] = { handledByStatusUpdate: true };
    }
  }
  return results;
}

function plannerStatusForWorkOrder(status: string): PlannerStatus | null {
  const mapping: Record<string, PlannerStatus> = {
    PARTS_REVIEW: "WAITING_CALCULATION",
    WAITING_APPROVAL: "WAITING_APPROVAL",
    WAITING_PARTS: "WAITING_PARTS",
    READY_FOR_REPAIR: "READY_FOR_REPAIR",
    IN_REPAIR: "IN_REPAIR",
    REWORK: "IN_REPAIR",
    PAUSED: "PAUSED",
    WAITING_QC: "WAITING_QC",
    WAITING_PAYMENT: "WAITING_PAYMENT" as PlannerStatus,
    READY_FOR_PICKUP: "READY_FOR_PICKUP",
    CLOSED: "COMPLETED",
    CANCELLED: "CANCELLED",
  };
  return mapping[status] ?? null;
}

export async function transitionWorkOrder(id: string, toStatus: string, actorName = "CRM") {
  const prisma = getPrisma();
  const requested = toStatus.trim().toUpperCase();
  if (!getWorkflowStatus("WORK_ORDER", requested)) {
    const current = await prisma.workOrder.findUnique({ where: { id }, select: { status: true } });
    if (!current) throw new WorkOrderNotFoundError(id);
    throw new WorkOrderTransitionError(evaluateWorkflowTransition({ entity: "WORK_ORDER", from: current.status, to: requested }));
  }

  const preflight = await prisma.workOrder.findUnique({ where: { id }, select: { status: true } });
  if (!preflight) throw new WorkOrderNotFoundError(id);
  const normalizedFrom = normalizeWorkflowStatus("WORK_ORDER", preflight.status);

  // After QC passes, finalize the factual invoice/receivable before the car becomes ready for pickup.
  // Payment remains a separate financial state; readiness describes the physical/service state of the car.
  // Finalization happens first so finance errors cannot leave a false READY_FOR_PICKUP state.
  if (normalizedFrom === "WAITING_QC" && requested === "READY_FOR_PICKUP") {
    const preGates = (await getWorkOrderCycleState(id)).gates;
    const preDecision = evaluateWorkOrderTransition(normalizedFrom, requested, preGates);
    if (!preDecision.allowed) throw new WorkOrderTransitionError(preDecision, unsupportedActions(preDecision.actions));
    await finalizeWorkOrderFinanceFromLines(id, {}, actorName);
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`work-order-transition:${id}`}))`;
    const current = await tx.workOrder.findUnique({ where: { id }, include: workOrderInclude });
    if (!current) throw new WorkOrderNotFoundError(id);

    const gates = await getWorkOrderCycleGateStateTx(tx, id);
    const decision = evaluateWorkOrderTransition(current.status, requested, gates);
    const unsupported = unsupportedActions(decision.actions);
    if (!decision.allowed || unsupported.length) throw new WorkOrderTransitionError(decision, unsupported);
    if (decision.code === "NOOP") return decorateWorkOrder(current, gates);

    const actionResults = await executeWorkOrderActions(tx, id, decision.actions, actorName);
    const terminal = decision.normalizedTo === "CLOSED" || decision.normalizedTo === "CANCELLED";
    const updated = await tx.workOrder.update({
      where: { id },
      data: { status: decision.normalizedTo, closedAt: terminal ? current.closedAt ?? new Date() : null },
      include: workOrderInclude,
    });

    const plannerStatus = plannerStatusForWorkOrder(decision.normalizedTo);
    if (plannerStatus) {
      const now = new Date();
      await tx.serviceAppointment.updateMany({
        where: { workOrderId: id },
        data: {
          status: plannerStatus,
          actualStartAt: decision.normalizedTo === "IN_REPAIR" ? now : undefined,
          actualEndAt: decision.normalizedTo === "CLOSED" ? now : undefined,
        },
      });
    }

    await tx.auditEvent.create({
      data: {
        actorName,
        entityType: "WorkOrder",
        entityId: id,
        action: `STATUS_${decision.normalizedFrom}_TO_${decision.normalizedTo}`,
        before: toPrismaJson(current),
        after: toPrismaJson(updated),
        metadata: toPrismaJson({
          workflowCode: decision.code,
          requiredGates: decision.requiredGates,
          satisfiedGates: decision.satisfiedGates,
          actions: decision.actions,
          actionResults,
        }),
      },
    });

    const refreshedGates = await getWorkOrderCycleGateStateTx(tx, id);
    return decorateWorkOrder(updated, refreshedGates);
  });
}
