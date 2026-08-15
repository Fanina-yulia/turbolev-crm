import { DiagnosticRequestStatus } from "@/src/generated/prisma/client";
import { HARD_GATE_CODES, WORK_ORDER_INITIAL_STATUS } from "@/src/domain/workflow";
import { getPrisma } from "@/src/lib/prisma";

export class DiagnosticRequestNotFoundError extends Error {
  constructor(id: string) {
    super(`DiagnosticRequest not found: ${id}`);
    this.name = "DiagnosticRequestNotFoundError";
  }
}

export class WorkOrderHardGateError extends Error {
  readonly gate = HARD_GATE_CODES.WORK_ORDER_AFTER_CONFIRMED_DIAGNOSTICS;

  constructor(message = "WorkOrder is blocked until diagnostics are confirmed") {
    super(message);
    this.name = "WorkOrderHardGateError";
  }
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

    if (diagnosticRequest.workOrder) {
      return diagnosticRequest.workOrder;
    }

    return tx.workOrder.upsert({
      where: { diagnosticRequestId: diagnosticRequest.id },
      update: {},
      create: {
        clientId: diagnosticRequest.clientId,
        vehicleId: diagnosticRequest.vehicleId,
        diagnosticRequestId: diagnosticRequest.id,
        status: WORK_ORDER_INITIAL_STATUS,
      },
    });
  });
}
