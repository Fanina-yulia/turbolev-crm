import { getPrisma } from "@/src/lib/prisma";

export type PlannerFinancialTone = "neutral" | "warning" | "success" | "danger";
export type PlannerFinancialApprovalState = "NOT_CALCULATED" | "ESTIMATED" | "APPROVED" | "REJECTED";
export type PlannerFinancialPaymentStatus = "NOT_FORMED" | "UNPAID" | "PARTIAL" | "PAID" | "OVERDUE";

export type PlannerFinancialPresentationInput = {
  amount: number | null;
  approved: boolean;
  rejected?: boolean;
  paid: number;
  overdue?: boolean;
  appointmentStatus: string;
  additionalPending?: number | null;
};

export type PlannerFinancialPresentation = {
  approvalState: PlannerFinancialApprovalState;
  paymentStatus: PlannerFinancialPaymentStatus;
  displayStatus: string;
  displayTone: PlannerFinancialTone;
  outstanding: number | null;
};

const PAYMENT_DUE_STATUSES = new Set(["WAITING_PAYMENT", "READY_FOR_PICKUP", "COMPLETED"]);
const POST_APPROVAL_STATUSES = new Set([
  "WAITING_PARTS",
  "READY_FOR_REPAIR",
  "IN_REPAIR",
  "WAITING_QC",
  "WAITING_PAYMENT",
  "READY_FOR_PICKUP",
  "COMPLETED",
]);

function money(value: unknown) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : null;
}

export function derivePlannerFinancialPresentation(input: PlannerFinancialPresentationInput): PlannerFinancialPresentation {
  const amount = money(input.amount);
  const paid = money(input.paid) ?? 0;
  const rejected = Boolean(input.rejected);
  const approved = Boolean(input.approved) && amount != null;
  const outstanding = amount == null ? null : Math.max(0, amount - paid);

  const approvalState: PlannerFinancialApprovalState = amount == null
    ? "NOT_CALCULATED"
    : rejected
      ? "REJECTED"
      : approved
        ? "APPROVED"
        : "ESTIMATED";

  const paymentStatus: PlannerFinancialPaymentStatus = amount == null
    ? "NOT_FORMED"
    : paid >= amount && amount > 0
      ? "PAID"
      : input.overdue
        ? "OVERDUE"
        : paid > 0
          ? "PARTIAL"
          : "UNPAID";

  if (amount == null) {
    return { approvalState, paymentStatus, displayStatus: "Очікує розрахунку", displayTone: "neutral", outstanding };
  }
  if (rejected) {
    return { approvalState, paymentStatus, displayStatus: "Погодження відхилено", displayTone: "danger", outstanding };
  }
  if (!approved) {
    return { approvalState, paymentStatus, displayStatus: "Очікує погодження", displayTone: "warning", outstanding };
  }
  if (paymentStatus === "PAID") {
    return { approvalState, paymentStatus, displayStatus: "Оплачено", displayTone: "success", outstanding };
  }
  if (paymentStatus === "PARTIAL") {
    return { approvalState, paymentStatus, displayStatus: "Частково оплачено", displayTone: "warning", outstanding };
  }
  if (paymentStatus === "OVERDUE") {
    return { approvalState, paymentStatus, displayStatus: "Оплата прострочена", displayTone: "danger", outstanding };
  }
  if (PAYMENT_DUE_STATUSES.has(input.appointmentStatus)) {
    return { approvalState, paymentStatus, displayStatus: "Очікує оплату", displayTone: "warning", outstanding };
  }
  return { approvalState, paymentStatus, displayStatus: "Погоджено", displayTone: "success", outstanding };
}

export async function getPlannerAppointmentFinancialSummary(appointmentId: string) {
  const prisma = getPrisma();
  const appointment = await prisma.serviceAppointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      locationId: true,
      mechanicId: true,
      createdById: true,
      leadId: true,
      workOrderId: true,
      purpose: true,
      status: true,
      estimatedAmount: true,
    },
  });
  if (!appointment) return null;

  const fallbackAmount = money(appointment.estimatedAmount);
  let amount = fallbackAmount;
  let approved = false;
  let rejected = false;
  let approvedAt: Date | null = null;
  let approvalSource: string | null = null;
  let paid = 0;
  let overdue = false;
  let additionalPending: number | null = null;
  let pendingTotal: number | null = null;
  let source: "APPOINTMENT" | "ESTIMATE" | "OBLIGATION" | "DIAGNOSTIC" = "APPOINTMENT";

  if (appointment.workOrderId) {
    const [estimates, obligations] = await Promise.all([
      prisma.workOrderEstimate.findMany({
        where: { workOrderId: appointment.workOrderId },
        orderBy: [{ revision: "desc" }, { updatedAt: "desc" }],
        select: {
          revision: true,
          status: true,
          totalAmount: true,
          approvedAt: true,
          approvalSource: true,
          updatedAt: true,
        },
        take: 20,
      }),
      prisma.financialObligation.findMany({
        where: {
          workOrderId: appointment.workOrderId,
          direction: "RECEIVABLE",
          status: { not: "CANCELLED" },
        },
        select: { status: true, amount: true, settledAmount: true },
      }),
    ]);

    const currentEstimate = estimates.find((row) => row.status !== "CANCELLED" && row.status !== "SUPERSEDED") ?? estimates[0] ?? null;
    const approvedEstimate = estimates.find((row) => row.status === "APPROVED" || Boolean(row.approvedAt)) ?? null;
    const obligationAmount = obligations.reduce((sum, row) => sum + (money(row.amount) ?? 0), 0);
    paid = obligations.reduce((sum, row) => sum + (money(row.settledAmount) ?? 0), 0);
    overdue = obligations.some((row) => row.status === "OVERDUE");

    if (approvedEstimate) {
      amount = money(approvedEstimate.totalAmount);
      approved = amount != null;
      approvedAt = approvedEstimate.approvedAt;
      approvalSource = approvedEstimate.approvalSource || "ESTIMATE_APPROVAL";
      source = "ESTIMATE";

      if (
        currentEstimate
        && currentEstimate.revision > approvedEstimate.revision
        && currentEstimate.status !== "APPROVED"
        && currentEstimate.status !== "REJECTED"
      ) {
        pendingTotal = money(currentEstimate.totalAmount);
        if (pendingTotal != null && amount != null && pendingTotal > amount) additionalPending = pendingTotal - amount;
      }
    } else if (currentEstimate) {
      amount = money(currentEstimate.totalAmount) ?? fallbackAmount;
      rejected = currentEstimate.status === "REJECTED";
      source = "ESTIMATE";
    } else if (obligationAmount > 0) {
      amount = obligationAmount;
      approved = true;
      approvalSource = "FINANCIAL_OBLIGATION";
      source = "OBLIGATION";
    }

    if (!approved && amount != null && !currentEstimate && POST_APPROVAL_STATUSES.has(appointment.status)) {
      approved = true;
      approvalSource = "ADMIN_WORKFLOW";
    }
  } else {
    const link = await prisma.diagnosticVisitLink.findUnique({
      where: { appointmentId },
      select: { diagnosticRequestId: true },
    });
    if (link) {
      const [obligation, payments] = await Promise.all([
        prisma.financialObligation.findFirst({
          where: {
            sourceEntity: "WALK_IN_DIAGNOSTIC",
            sourceEntityId: `${link.diagnosticRequestId}:receivable`,
            direction: "RECEIVABLE",
            status: { not: "CANCELLED" },
          },
          select: { amount: true, settledAmount: true, status: true, issuedAt: true },
        }),
        prisma.cashTransaction.findMany({
          where: {
            sourceEntity: "WALK_IN_DIAGNOSTIC_PAYMENT",
            sourceEntityId: `${link.diagnosticRequestId}:payment`,
            status: "POSTED",
          },
          select: { amount: true, occurredAt: true },
        }),
      ]);

      const paymentTotal = payments.reduce((sum, row) => sum + (money(row.amount) ?? 0), 0);
      if (obligation) {
        amount = money(obligation.amount) ?? fallbackAmount;
        paid = money(obligation.settledAmount) ?? paymentTotal;
        approved = amount != null;
        approvedAt = obligation.issuedAt;
        approvalSource = "DIAGNOSTIC_SETTLEMENT";
        overdue = obligation.status === "OVERDUE";
        source = "DIAGNOSTIC";
      } else {
        paid = paymentTotal;
        if (paid > 0 && amount != null) {
          approved = true;
          approvedAt = payments[0]?.occurredAt ?? null;
          approvalSource = "PAYMENT";
          source = "DIAGNOSTIC";
        }
      }
    }

    if (!approved && amount != null && POST_APPROVAL_STATUSES.has(appointment.status)) {
      approved = true;
      approvalSource = "ADMIN_WORKFLOW";
    }
  }

  const presentation = derivePlannerFinancialPresentation({
    amount,
    approved,
    rejected,
    paid,
    overdue,
    appointmentStatus: appointment.status,
    additionalPending,
  });

  return {
    appointment: {
      id: appointment.id,
      locationId: appointment.locationId,
      mechanicId: appointment.mechanicId,
      createdById: appointment.createdById,
      leadId: appointment.leadId,
    },
    summary: {
      amount,
      amountKind: approved ? "FINAL" as const : "ESTIMATED" as const,
      approved,
      approvedAt: approvedAt?.toISOString() ?? null,
      approvalSource,
      approvalState: presentation.approvalState,
      rejected,
      paid,
      outstanding: presentation.outstanding,
      paymentStatus: presentation.paymentStatus,
      displayStatus: presentation.displayStatus,
      displayTone: presentation.displayTone,
      additionalPending,
      pendingTotal,
      source,
    },
  };
}
