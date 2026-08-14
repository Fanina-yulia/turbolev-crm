import { DiagnosticRequestStatus } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";

export class DiagnosticRequestNotFoundError extends Error {
  constructor(id: string) {
    super(`DiagnosticRequest not found: ${id}`);
    this.name = "DiagnosticRequestNotFoundError";
  }
}

export class WorkOrderHardGateError extends Error {
  readonly gate = "WORK_ORDER_AFTER_CONFIRMED_DIAGNOSTICS";

  constructor(message = "WorkOrder is blocked until diagnostics are confirmed") {
    super(message);
    this.name = "WorkOrderHardGateError";
  }
}

/**
 * The only supported application-level WorkOrder factory.
 * Hard Gate #1 is checked inside the same DB transaction as WorkOrder creation.
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

    if (diagnosticRequest.workOrder) {
      return diagnosticRequest.workOrder;
    }

    if (
      diagnosticRequest.status !== DiagnosticRequestStatus.CONFIRMED ||
      !diagnosticRequest.confirmedAt
    ) {
      throw new WorkOrderHardGateError();
    }

    return tx.workOrder.create({
      data: {
        clientId: diagnosticRequest.clientId,
        vehicleId: diagnosticRequest.vehicleId,
        diagnosticRequestId: diagnosticRequest.id,
        status: "PARTS_REVIEW",
      },
    });
  });
}
