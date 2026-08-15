import { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { getWorkOrderEstimateApprovalStateTx } from "@/src/services/work-order-estimate-approval-scope.service";

function jsonSafe(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function normalizeApprovedEstimateFingerprint(
  workOrderId: string,
  estimateId: string,
  actorName = "CRM / Сервіс-менеджер",
) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`wo-commercial:${workOrderId}`}))`;
    const estimate = await tx.workOrderEstimate.findFirst({
      where: { id: estimateId, workOrderId, status: "APPROVED" },
    });
    if (!estimate) return null;

    const approval = await getWorkOrderEstimateApprovalStateTx(tx, workOrderId);
    if (!approval.isCurrent || approval.estimate?.id !== estimate.id) return estimate;
    const lineFingerprint = approval.currentFingerprint;
    if (estimate.lineFingerprint === lineFingerprint) return estimate;

    const updated = await tx.workOrderEstimate.update({
      where: { id: estimate.id },
      data: { lineFingerprint },
    });
    await tx.auditEvent.create({
      data: {
        actorName,
        entityType: "WorkOrderEstimate",
        entityId: estimate.id,
        action: "ESTIMATE_APPROVAL_FINGERPRINT_NORMALIZED",
        before: jsonSafe({ lineFingerprint: estimate.lineFingerprint }),
        after: jsonSafe({ lineFingerprint }),
        metadata: jsonSafe({ workOrderId, lineCount: approval.lineCount, scope: "CLIENT_APPROVAL" }),
      },
    });
    return updated;
  });
}
