import type { VehicleWorkflowIndicator } from "@/src/lib/contracts/crm-core";
import { getPrisma } from "@/src/lib/prisma";

const REPAIR_STATUSES = new Set([
  "IN_REPAIR",
  "WAITING_QC",
  "WAITING_PAYMENT",
  "READY_FOR_PICKUP",
  "COMPLETED",
]);

const ACTIVE_ESTIMATE_STATUSES: Array<"DRAFT" | "SENT" | "APPROVED" | "REJECTED"> = ["DRAFT", "SENT", "APPROVED", "REJECTED"];

function emptyIndicator(): VehicleWorkflowIndicator {
  return {
    diagnosticCard: "NONE",
    commercialProposal: "NOT_SENT",
    repair: "NOT_STARTED",
  };
}

export async function getVehicleWorkflowIndicators(vehicleIds: string[]) {
  const result = new Map<string, VehicleWorkflowIndicator>();
  for (const vehicleId of vehicleIds) result.set(vehicleId, emptyIndicator());
  if (!vehicleIds.length) return result;

  const prisma = getPrisma();
  const [diagnostics, workOrders] = await Promise.all([
    prisma.diagnosticRequest.findMany({
      where: { vehicleId: { in: vehicleIds } },
      orderBy: { createdAt: "desc" },
      select: {
        vehicleId: true,
        status: true,
        confirmedAt: true,
        diagnosticCard: { select: { finalizedAt: true } },
      },
    }),
    prisma.workOrder.findMany({
      where: { vehicleId: { in: vehicleIds } },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true, vehicleId: true, status: true, closedAt: true },
    }),
  ]);

  const workOrderIds = workOrders.map((row) => row.id);
  const [estimates, obligations] = await Promise.all([
    workOrderIds.length
      ? prisma.workOrderEstimate.findMany({
          where: { workOrderId: { in: workOrderIds }, status: { in: ACTIVE_ESTIMATE_STATUSES } },
          orderBy: [{ revision: "desc" }, { updatedAt: "desc" }],
          select: { workOrderId: true, status: true },
        })
      : Promise.resolve([]),
    workOrderIds.length
      ? prisma.financialObligation.findMany({
          where: { workOrderId: { in: workOrderIds }, direction: "RECEIVABLE" },
          select: { workOrderId: true, status: true },
        })
      : Promise.resolve([]),
  ]);

  const diagnosticByVehicle = new Map<string, (typeof diagnostics)[number]>();
  for (const row of diagnostics) if (!diagnosticByVehicle.has(row.vehicleId)) diagnosticByVehicle.set(row.vehicleId, row);

  const ordersByVehicle = new Map<string, (typeof workOrders)[number]>();
  for (const row of workOrders) if (!ordersByVehicle.has(row.vehicleId)) ordersByVehicle.set(row.vehicleId, row);

  const estimateByOrder = new Map<string, (typeof estimates)[number]>();
  for (const row of estimates) if (!estimateByOrder.has(row.workOrderId)) estimateByOrder.set(row.workOrderId, row);

  const paidOrderIds = new Set(
    obligations.filter((row) => row.status === "PAID" && row.workOrderId).map((row) => row.workOrderId as string),
  );

  for (const vehicleId of vehicleIds) {
    const indicator = emptyIndicator();
    const diagnostic = diagnosticByVehicle.get(vehicleId);
    if (diagnostic) {
      indicator.diagnosticCard = diagnostic.diagnosticCard?.finalizedAt || (diagnostic.status === "CONFIRMED" && diagnostic.confirmedAt)
        ? "READY"
        : "IN_PROGRESS";
    }

    const order = ordersByVehicle.get(vehicleId);
    const estimate = order ? estimateByOrder.get(order.id) : undefined;
    if (estimate?.status === "APPROVED") indicator.commercialProposal = "APPROVED";
    else if (estimate?.status === "SENT") indicator.commercialProposal = "PENDING";

    if (order && paidOrderIds.has(order.id) && (order.closedAt || order.status === "COMPLETED")) indicator.repair = "PAID";
    else if (order && REPAIR_STATUSES.has(order.status)) indicator.repair = "IN_PROGRESS";

    result.set(vehicleId, indicator);
  }

  return result;
}
