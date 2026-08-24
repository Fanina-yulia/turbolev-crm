import { VehicleIssueStatus } from "@/src/generated/prisma/client";
import { decideEstimate } from "@/src/services/work-order-commercial.service";
import { markWorkOrderIssues } from "@/src/services/vehicle-issues.service";

type EstimateDecisionInput = Parameters<typeof decideEstimate>[1];

export async function decideEstimateWithVehicleIssues(
  workOrderId: string,
  input: EstimateDecisionInput,
  actorName = "CRM / Сервіс-менеджер",
) {
  const estimate = await decideEstimate(workOrderId, input, actorName);
  if (input.decision === "APPROVE") {
    try {
      await markWorkOrderIssues(workOrderId, VehicleIssueStatus.APPROVED);
    } catch (error) {
      console.error("Vehicle issue estimate approval sync failed", { workOrderId, error });
    }
  }
  return estimate;
}
