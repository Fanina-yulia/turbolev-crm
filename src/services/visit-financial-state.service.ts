import { getPrisma } from "@/src/lib/prisma";

export type VisitPaymentStatus = "NOT_FORMED" | "UNPAID" | "PREPAID" | "PARTIAL" | "PAID" | "OVERDUE" | "CANCELLED";
export type VisitFinanceSource = "WORK_ORDER" | "WALK_IN_DIAGNOSTIC" | "ESTIMATE" | "NONE";
export type VisitPaymentMethod = "CASH" | "TERMINAL" | "ONLINE" | "OTHER" | null;

export type VisitFinancialState = {
  appointmentId: string;
  vehicleId: string | null;
  workOrderId: string | null;
  diagnosticId: string | null;
  isCurrentVisit: boolean;
  appointmentStatus: string;
  operationalLabel: string;
  source: VisitFinanceSource;
  /** true only when the total charge comes from a factual FinancialObligation. */
  actual: boolean;
  status: VisitPaymentStatus;
  amount: number | null;
  paid: number;
  outstanding: number | null;
  estimatedAmount: number | null;
  lastPayment: {
    id: string;
    amount: number;
    occurredAt: string;
    method: VisitPaymentMethod;
  } | null;
  diagnostic: {
    reviewState: string | null;
    workflowLabel: string;
    total: number;
    checked: number;
    defects: number;
    completed: boolean;
  } | null;
};

type ResolveInput = { appointmentId?: string | null; vehicleId?: string | null };

const TERMINAL_VISIT_STATUSES = ["COMPLETED", "CANCELLED", "NO_SHOW"] as const;

function num(value: unknown) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function nullableAmount(value: unknown) {
  if (value == null || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function paymentMethod(metadata: unknown, accountType?: string | null): VisitPaymentMethod {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const raw = (metadata as Record<string, unknown>).paymentMethod;
    if (raw === "CASH") return "CASH";
    if (raw === "TERMINAL") return "TERMINAL";
    if (raw === "ONLINE") return "ONLINE";
  }
  if (accountType === "CASH") return "CASH";
  if (accountType === "ACQUIRING" || accountType === "CARD") return "TERMINAL";
  if (accountType === "BANK") return "ONLINE";
  return accountType ? "OTHER" : null;
}

function deriveStatus(amount: number | null, paid: number, overdue: boolean, hasActualCharge: boolean): VisitPaymentStatus {
  const normalizedAmount = amount == null ? null : Math.max(0, amount);
  const normalizedPaid = Math.max(0, paid);
  if (!hasActualCharge && normalizedPaid > 0) return "PREPAID";
  const outstanding = normalizedAmount == null ? null : Math.max(0, normalizedAmount - normalizedPaid);
  if (overdue && outstanding != null && outstanding > 0) return "OVERDUE";
  if (normalizedAmount == null || normalizedAmount <= 0) return normalizedPaid > 0 ? "PREPAID" : "NOT_FORMED";
  if (normalizedPaid <= 0) return "UNPAID";
  if (normalizedPaid + 0.005 < normalizedAmount) return "PARTIAL";
  return "PAID";
}

function operationalLabel(status: string, reviewState: string | null, paidStatus: VisitPaymentStatus) {
  if (reviewState === "CONFIRMED") return "Діагностика підтверджена";
  if (reviewState === "SUBMITTED") return "Діагностика виконана";
  if (status === "WAITING_PAYMENT" && paidStatus === "PAID") return "Потрібна наступна дія";
  const labels: Record<string, string> = {
    BOOKED: "Записаний",
    ARRIVED: "Приїхав",
    DIAGNOSTICS: "Діагностика",
    WAITING_PARTS_SELECTION: "Підбір деталей",
    WAITING_CALCULATION: "Калькуляція",
    WAITING_APPROVAL: "Погодження",
    WAITING_PARTS: "Очікує деталі",
    READY_FOR_REPAIR: "Готовий до ремонту",
    IN_REPAIR: "У ремонті",
    WAITING_QC: "Контроль якості",
    WAITING_PAYMENT: "Очікує оплату",
    READY_FOR_PICKUP: "Готовий до видачі",
    COMPLETED: "Візит завершено",
    WARRANTY: "Гарантія",
    PAUSED: "Пауза",
    NO_SHOW: "Не приїхав",
    CANCELLED: "Скасований",
    RESERVE: "Резерв",
  };
  return labels[status] || status;
}

async function resolveAppointment(input: ResolveInput) {
  const prisma = getPrisma();
  if (input.appointmentId) {
    const appointment = await prisma.serviceAppointment.findUnique({ where: { id: input.appointmentId } });
    return appointment ? { appointment, isCurrentVisit: !TERMINAL_VISIT_STATUSES.includes(appointment.status as (typeof TERMINAL_VISIT_STATUSES)[number]) } : null;
  }
  if (!input.vehicleId) return null;
  const current = await prisma.serviceAppointment.findFirst({
    where: { vehicleId: input.vehicleId, status: { notIn: [...TERMINAL_VISIT_STATUSES] } },
    orderBy: [{ updatedAt: "desc" }, { plannedStartAt: "desc" }],
  });
  if (current) return { appointment: current, isCurrentVisit: true };
  const latest = await prisma.serviceAppointment.findFirst({
    where: { vehicleId: input.vehicleId, status: { not: "CANCELLED" } },
    orderBy: [{ actualEndAt: "desc" }, { updatedAt: "desc" }, { plannedStartAt: "desc" }],
  });
  return latest ? { appointment: latest, isCurrentVisit: false } : null;
}

async function diagnosticSummary(diagnosticId: string | null) {
  if (!diagnosticId) return null;
  const prisma = getPrisma();
  const [review, inspections] = await Promise.all([
    prisma.diagnosticReview.findUnique({ where: { diagnosticRequestId: diagnosticId }, select: { state: true } }),
    prisma.diagnosticInspection.findMany({
      where: { diagnosticRequestId: diagnosticId },
      select: { id: true, status: true, templateId: true },
    }),
  ]);
  if (!inspections.length) {
    const reviewState = review?.state || null;
    return {
      reviewState,
      workflowLabel: reviewState === "CONFIRMED" ? "Діагностика підтверджена" : reviewState === "SUBMITTED" ? "Діагностика виконана" : "Діагностика",
      total: 0,
      checked: 0,
      defects: 0,
      completed: reviewState === "SUBMITTED" || reviewState === "CONFIRMED",
    };
  }

  const templates = await prisma.diagnosticTemplate.findMany({
    where: { id: { in: Array.from(new Set(inspections.map((row) => row.templateId))) } },
    select: { id: true, code: true },
  });
  const templateCodeById = new Map(templates.map((row) => [row.id, row.code]));
  const matrix = inspections.filter((row) => templateCodeById.get(row.templateId) === "SUSPENSION_MATRIX");
  const effective = matrix.length ? matrix : inspections;
  const checks = await prisma.diagnosticCheck.findMany({
    where: { inspectionId: { in: effective.map((row) => row.id) } },
    select: { state: true },
  });
  const reviewState = review?.state || null;
  const checked = checks.filter((row) => row.state !== "NOT_CHECKED").length;
  const defects = checks.filter((row) => row.state === "DEFECT").length;
  const completed = reviewState === "SUBMITTED" || reviewState === "CONFIRMED";
  return {
    reviewState,
    workflowLabel: reviewState === "CONFIRMED" ? "Діагностика підтверджена" : reviewState === "SUBMITTED" ? "Діагностика виконана" : "Діагностика",
    total: checks.length,
    checked,
    defects,
    completed,
  };
}

export async function getVisitFinancialState(input: ResolveInput): Promise<VisitFinancialState | null> {
  const prisma = getPrisma();
  const resolved = await resolveAppointment(input);
  if (!resolved) return null;
  const { appointment, isCurrentVisit } = resolved;

  const link = await prisma.diagnosticVisitLink.findUnique({
    where: { appointmentId: appointment.id },
    select: { diagnosticRequestId: true },
  }).catch(() => null);
  const diagnosticId = link?.diagnosticRequestId || null;

  const obligations = appointment.workOrderId
    ? await prisma.financialObligation.findMany({
        where: { workOrderId: appointment.workOrderId, direction: "RECEIVABLE", status: { not: "CANCELLED" } },
        orderBy: { issuedAt: "asc" },
      })
    : diagnosticId
      ? await prisma.financialObligation.findMany({
          where: {
            direction: "RECEIVABLE",
            status: { not: "CANCELLED" },
            sourceEntity: "WALK_IN_DIAGNOSTIC",
            sourceEntityId: `${diagnosticId}:receivable`,
          },
          orderBy: { issuedAt: "asc" },
        })
      : [];

  const obligationIds = obligations.map((row) => row.id);
  const paymentOr = [
    ...(obligationIds.length ? [{ obligationId: { in: obligationIds } }] : []),
    ...(appointment.workOrderId ? [{ workOrderId: appointment.workOrderId }] : []),
    ...(diagnosticId ? [{ sourceEntity: "WALK_IN_DIAGNOSTIC_PAYMENT", sourceEntityId: `${diagnosticId}:payment` }] : []),
  ];
  const payments = paymentOr.length
    ? await prisma.cashTransaction.findMany({
        where: { status: "POSTED", kind: "INFLOW", OR: paymentOr },
        orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
        include: { toAccount: { select: { type: true } } },
      })
    : [];

  const estimatedAmount = nullableAmount(appointment.estimatedAmount);
  const obligationAmount = obligations.length ? obligations.reduce((sum, row) => sum + num(row.amount), 0) : null;
  const obligationPaid = obligations.length ? obligations.reduce((sum, row) => sum + num(row.settledAmount), 0) : null;
  const postedPaid = payments.reduce((sum, row) => sum + num(row.amount), 0);

  let source: VisitFinanceSource = "NONE";
  let actual = false;
  let amount: number | null = null;
  let paid = 0;

  if (obligations.length) {
    source = appointment.workOrderId ? "WORK_ORDER" : "WALK_IN_DIAGNOSTIC";
    actual = true;
    amount = obligationAmount;
    paid = obligationPaid ?? postedPaid;
  } else if (payments.length) {
    source = appointment.workOrderId ? "WORK_ORDER" : diagnosticId ? "WALK_IN_DIAGNOSTIC" : "NONE";
    actual = false;
    paid = postedPaid;
    amount = estimatedAmount && estimatedAmount > 0 ? estimatedAmount : null;
  } else if (estimatedAmount != null && estimatedAmount > 0) {
    source = "ESTIMATE";
    amount = estimatedAmount;
    paid = 0;
  }

  const overdue = obligations.some((row) => row.status === "OVERDUE");
  const status = deriveStatus(amount, paid, overdue, obligations.length > 0);
  // Until a receivable exists, a prepayment is factual but a debt is not. Do not
  // manufacture an outstanding balance from an estimate.
  const outstanding = obligations.length > 0 && amount != null ? Math.max(0, amount - paid) : status === "UNPAID" && amount != null ? amount : null;
  const last = payments[0] || null;
  const diagnostic = await diagnosticSummary(diagnosticId);

  return {
    appointmentId: appointment.id,
    vehicleId: appointment.vehicleId,
    workOrderId: appointment.workOrderId,
    diagnosticId,
    isCurrentVisit,
    appointmentStatus: appointment.status,
    operationalLabel: operationalLabel(appointment.status, diagnostic?.reviewState || null, status),
    source,
    actual,
    status,
    amount,
    paid,
    outstanding,
    estimatedAmount,
    lastPayment: last ? {
      id: last.id,
      amount: num(last.amount),
      occurredAt: last.occurredAt.toISOString(),
      method: paymentMethod(last.metadata, last.toAccount?.type || null),
    } : null,
    diagnostic,
  };
}
