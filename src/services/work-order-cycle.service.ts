import { Prisma } from "@/src/generated/prisma/client";
import type { WorkflowGateState } from "@/src/domain/workflow";
import { getPrisma } from "@/src/lib/prisma";
import { getWorkOrderCommercialState, getWorkOrderGateStateTx } from "@/src/services/work-order-commercial.service";
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

export async function getWorkOrderCycleGateStateTx(tx: Tx, workOrderId: string): Promise<WorkflowGateState> {
  const [commercial, qc, finance] = await Promise.all([
    getWorkOrderGateStateTx(tx, workOrderId),
    getQualityControlStateTx(tx, workOrderId),
    financeGateStateTx(tx, workOrderId),
  ]);
  return {
    ...commercial,
    QC_PASSED_BEFORE_READY: qc.passed,
    ZERO_BALANCE_BEFORE_DELIVERY: finance.zeroBalance,
  };
}

export async function getWorkOrderCycleState(workOrderId: string) {
  const prisma = getPrisma();
  const [commercial, qc] = await Promise.all([
    getWorkOrderCommercialState(workOrderId),
    getQualityControlState(workOrderId),
  ]);
  const finance = await financeGateStateTx(prisma, workOrderId);
  const gates: WorkflowGateState = {
    ...commercial.gates,
    QC_PASSED_BEFORE_READY: qc.passed,
    ZERO_BALANCE_BEFORE_DELIVERY: finance.zeroBalance,
  };
  return {
    commercial,
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
