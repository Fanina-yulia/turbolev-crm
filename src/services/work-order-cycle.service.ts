import { Prisma } from "@/src/generated/prisma/client";
import type { WorkflowGateState } from "@/src/domain/workflow";
import { getPrisma } from "@/src/lib/prisma";
import { getWorkOrderCommercialState, getWorkOrderGateStateTx } from "@/src/services/work-order-commercial.service";
import { getWorkOrderEstimateApprovalStateTx } from "@/src/services/work-order-estimate-approval-scope.service";
import { getQualityControlState, getQualityControlStateTx } from "@/src/services/work-order-qc.service";

type Tx = Prisma.TransactionClient;

async function financeGateStateTx(tx: Tx, workOrderId: string) {
  const actual = await tx.workOrderFinanceSnapshot.findUnique({
    where: { workOrderId_kind: { workOrderId, kind: "ACTUAL" } },
  });
  const actualFinalized = Boolean(actual?.lockedAt);
  if (!actualFinalized) return { actualFinalized: false, receivable: null, outstanding: new Prisma.Decimal(0), zeroBalance: false };

  if (actual && new Prisma.Decimal(actual.grossRevenue).isZero()) {
    return { actualFinalized: true, receivable: null, outstanding: new Prisma.Decimal(0), zeroBalance: true };
  }

  const receivable = await tx.financialObligation.findFirst({
    where: { workOrderId, direction: "RECEIVABLE", status: { not: "CANCELLED" } },
    orderBy: { createdAt: "desc" },
  });
  if (!receivable) return { actualFinalized: true, receivable: null, outstanding: new Prisma.Decimal(0), zeroBalance: false };
  const outstanding = new Prisma.Decimal(receivable.amount).minus(new Prisma.Decimal(receivable.settledAmount));
  return { actualFinalized: true, receivable, outstanding, zeroBalance: outstanding.isZero() };
}

/**
 * Commercial state is the canonical approval gate. In particular, a new
 * DIRECT_REPAIR may not use directPriceConfirmedAt as a bypass for a stale or
 * missing estimate. Legacy in-progress direct repairs are handled explicitly by
 * work-order-commercial.service before they reach this function.
 */
function applyStableApprovalGates(gates: WorkflowGateState): WorkflowGateState {
  const effectiveApproval = gates.ESTIMATE_APPROVED_BEFORE_REPAIR === true;
  return {
    ...gates,
    ESTIMATE_APPROVED_BEFORE_REPAIR: effectiveApproval,
    ADDITIONAL_WORK_REQUIRES_APPROVAL: effectiveApproval,
  };
}

export async function getWorkOrderCycleGateStateTx(tx: Tx, workOrderId: string): Promise<WorkflowGateState> {
  const [commercial, qc, finance] = await Promise.all([
    getWorkOrderGateStateTx(tx, workOrderId),
    getQualityControlStateTx(tx, workOrderId),
    financeGateStateTx(tx, workOrderId),
  ]);
  return {
    ...applyStableApprovalGates(commercial),
    QC_PASSED_BEFORE_READY: qc.passed,
    ZERO_BALANCE_BEFORE_DELIVERY: finance.zeroBalance,
  };
}

export async function getWorkOrderCycleState(workOrderId: string) {
  const prisma = getPrisma();
  const [commercial, approval, qc, finance] = await Promise.all([
    getWorkOrderCommercialState(workOrderId),
    getWorkOrderEstimateApprovalStateTx(prisma, workOrderId),
    getQualityControlState(workOrderId),
    financeGateStateTx(prisma, workOrderId),
  ]);

  const commercialGates = applyStableApprovalGates(commercial.gates);
  const normalizedCommercial = {
    ...commercial,
    currentApprovalFingerprint: approval.currentFingerprint,
    estimateApprovalFingerprint: approval.estimateFingerprint,
    // Source-aware commercial fingerprint is canonical for the actual gate.
    // Approval-scope metadata is still returned for mixed client decisions.
    estimateIsCurrent: commercial.estimateIsCurrent,
    estimateApproved: commercial.estimateApproved,
    mixedApprovalPending: approval.mixedPending,
    mixedApprovalMode: approval.selectionMode,
    mixedApprovalDecisionCount: approval.decisionCount,
    mixedApprovalApprovedCount: approval.approvedDecisionCount,
    mixedApprovalRejectedCount: approval.rejectedDecisionCount,
    gates: commercialGates,
  };
  const gates: WorkflowGateState = {
    ...commercialGates,
    QC_PASSED_BEFORE_READY: qc.passed,
    ZERO_BALANCE_BEFORE_DELIVERY: finance.zeroBalance,
  };
  return {
    commercial: normalizedCommercial,
    qc,
    finance: {
      actualFinalized: finance.actualFinalized,
      receivable: finance.receivable,
      outstanding: finance.outstanding.toFixed(2),
      zeroBalance: finance.zeroBalance,
    },
    gates,
  };
}