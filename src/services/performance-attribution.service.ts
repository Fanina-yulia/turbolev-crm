import { getPrisma } from "@/src/lib/prisma";

export type AttributionInput = {
  employeeId: string;
  attributionType: "DIRECT" | "MANAGED" | "INFLUENCED";
  metricCode: string;
  kpiDefinitionId?: string | null;
  value?: number;
  unit: "COUNT" | "HOURS" | "NORM_HOURS" | "PERCENT" | "UAH" | "SCORE" | "MINUTES" | "DAYS" | "RATIO";
  share?: number | null;
  economicValue?: number | null;
  currency?: string;
  additiveContribution?: boolean;
  reason?: string | null;
  payrollPeriodId?: string | null;
  metadata?: Record<string, unknown>;
};

export type PerformanceEventInput = {
  idempotencyKey: string;
  eventType: string;
  occurredAt: Date;
  sourceType: string;
  sourceId: string;
  workOrderId?: string | null;
  leadId?: string | null;
  locationId?: string | null;
  payload?: Record<string, unknown>;
  attributions: AttributionInput[];
};

function validateAttributions(items: AttributionInput[]) {
  if (!items.length) throw new Error("Performance event requires at least one attribution entry.");

  for (const item of items) {
    if (item.additiveContribution && item.attributionType !== "DIRECT") {
      throw new Error("Only DIRECT attribution may be additive employee contribution.");
    }
    if (item.share != null && (!Number.isFinite(item.share) || item.share < 0 || item.share > 1)) {
      throw new Error("Attribution share must be between 0 and 1.");
    }
    if (!item.metricCode.trim()) throw new Error("Attribution metricCode is required.");
  }

  const shareBuckets = new Map<string, number>();
  for (const item of items) {
    if (item.share == null) continue;
    const key = `${item.attributionType}:${item.metricCode}`;
    shareBuckets.set(key, (shareBuckets.get(key) ?? 0) + item.share);
  }
  for (const [key, share] of shareBuckets) {
    if (share > 1.0001) throw new Error(`Attribution shares exceed 100% for ${key}.`);
  }
}

/**
 * Immutable, idempotent business-event posting.
 * The financial ledger remains authoritative for P&L/Cash Flow; this ledger only explains attribution.
 */
export async function postPerformanceEvent(input: PerformanceEventInput) {
  validateAttributions(input.attributions);
  const prisma = getPrisma();

  const existing = await prisma.performanceEvent.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    include: { attributions: true },
  });
  if (existing) return existing;

  const payrollPeriodIds = [...new Set(input.attributions.map((item) => item.payrollPeriodId).filter(Boolean) as string[])];
  if (payrollPeriodIds.length) {
    const closed = await prisma.payrollPeriod.findFirst({
      where: { id: { in: payrollPeriodIds }, status: "CLOSED" },
      select: { key: true },
    });
    if (closed) throw new Error(`Payroll period ${closed.key} is closed. Post an adjustment in a later open period.`);
  }

  return prisma.performanceEvent.create({
    data: {
      idempotencyKey: input.idempotencyKey,
      eventType: input.eventType,
      occurredAt: input.occurredAt,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      workOrderId: input.workOrderId ?? null,
      leadId: input.leadId ?? null,
      locationId: input.locationId ?? null,
      payload: input.payload ?? {},
      attributions: {
        create: input.attributions.map((item) => ({
          employeeId: item.employeeId,
          attributionType: item.attributionType,
          metricCode: item.metricCode.trim(),
          kpiDefinitionId: item.kpiDefinitionId ?? null,
          value: item.value ?? 1,
          unit: item.unit,
          share: item.share ?? null,
          economicValue: item.economicValue ?? null,
          currency: item.currency ?? "UAH",
          additiveContribution: item.additiveContribution ?? false,
          reason: item.reason ?? null,
          payrollPeriodId: item.payrollPeriodId ?? null,
          metadata: item.metadata ?? {},
        })),
      },
    },
    include: { attributions: true },
  });
}

/** Payroll close freezes both salary facts and linked attribution facts for the period. */
export async function closePayrollPeriod(args: { payrollPeriodId: string; closedByEmployeeId?: string | null }) {
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    const period = await tx.payrollPeriod.findUnique({ where: { id: args.payrollPeriodId } });
    if (!period) throw new Error("Payroll period not found.");
    if (period.status === "CLOSED") return period;

    const drafts = await tx.salaryAccrual.count({
      where: { payrollPeriodId: period.id, status: "DRAFT" },
    });
    if (drafts > 0) throw new Error(`Payroll period has ${drafts} draft accrual(s). Review/post them before closing.`);

    const now = new Date();
    await tx.attributionLedgerEntry.updateMany({
      where: { payrollPeriodId: period.id, isFrozen: false },
      data: { isFrozen: true, frozenAt: now },
    });

    return tx.payrollPeriod.update({
      where: { id: period.id },
      data: {
        status: "CLOSED",
        closedAt: now,
        closedByEmployeeId: args.closedByEmployeeId ?? null,
      },
    });
  });
}
