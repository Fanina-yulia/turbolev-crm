import { getPrisma } from "@/src/lib/prisma";
import { updateWorkOrderLine } from "@/src/services/work-order-lines.service";
import { reconcileWorkOrderIssueLinks } from "@/src/services/vehicle-issues.service";

function numeric(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function syncInstalledPartWorkOrderLine(input: {
  workOrderId: string;
  workOrderLineId: string;
  quantity: unknown;
  installedQuantity: unknown;
  actorName?: string | null;
}) {
  const workOrderId = input.workOrderId.trim();
  const workOrderLineId = input.workOrderLineId.trim();
  if (!workOrderId || !workOrderLineId) return { changed: false, reason: "LINE_CONTEXT_MISSING" as const };

  const line = await getPrisma().workOrderLine.findFirst({
    where: { id: workOrderLineId, workOrderId },
    select: { id: true, status: true, type: true },
  });
  if (!line || line.type !== "PART" || ["COMPLETED", "CANCELLED"].includes(line.status)) {
    return { changed: false, reason: !line ? "LINE_NOT_FOUND" as const : "NO_CHANGE" as const };
  }

  const quantity = numeric(input.quantity);
  const installedQuantity = numeric(input.installedQuantity);
  const fullyInstalled = quantity > 0 && installedQuantity >= quantity;
  const partiallyInstalled = installedQuantity > 0 && !fullyInstalled;
  let target: "IN_PROGRESS" | "COMPLETED" | null = null;

  if (fullyInstalled && (line.status === "APPROVED" || line.status === "IN_PROGRESS")) target = "COMPLETED";
  else if (partiallyInstalled && line.status === "APPROVED") target = "IN_PROGRESS";
  if (!target) {
    return { changed: false, reason: line.status === "DRAFT" ? "ESTIMATE_NOT_APPROVED" as const : "NO_CHANGE" as const };
  }

  const updated = await updateWorkOrderLine(workOrderId, workOrderLineId, { status: target }, input.actorName || "CRM / Закупівлі та склад");
  const issueSync = await reconcileWorkOrderIssueLinks(workOrderId);
  return { changed: true, status: updated.line.status, issueSync };
}
