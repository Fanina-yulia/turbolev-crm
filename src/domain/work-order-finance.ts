import { Prisma } from "@/src/generated/prisma/client";

export const WORK_ORDER_FINANCE_FIELDS = [
  "laborRevenue",
  "partsRevenue",
  "externalRevenue",
  "otherRevenue",
  "discountAmount",
  "refundAmount",
  "partsCost",
  "laborCost",
  "externalCost",
  "consumablesCost",
  "otherDirectCost",
] as const;

export type WorkOrderFinanceField = (typeof WORK_ORDER_FINANCE_FIELDS)[number];
export type WorkOrderFinanceInput = Partial<Record<WorkOrderFinanceField, unknown>> & {
  currency?: unknown;
  locationId?: unknown;
  recognizedAt?: unknown;
  dueAt?: unknown;
};

export type WorkOrderFinanceCalculation = Record<WorkOrderFinanceField, Prisma.Decimal> & {
  currency: string;
  grossRevenueBeforeDiscounts: Prisma.Decimal;
  grossRevenue: Prisma.Decimal;
  directCost: Prisma.Decimal;
  grossProfit: Prisma.Decimal;
  grossMarginPercent: Prisma.Decimal | null;
  fingerprint: string;
};

export class WorkOrderFinanceValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WorkOrderFinanceValidationError";
    this.code = code;
  }
}

function money(value: unknown, field: WorkOrderFinanceField) {
  if (value == null || value === "") return new Prisma.Decimal(0);
  if (typeof value !== "number" && typeof value !== "string") {
    throw new WorkOrderFinanceValidationError("INVALID_MONEY", `${field} must be numeric`);
  }

  let result: Prisma.Decimal;
  try {
    result = new Prisma.Decimal(String(value));
  } catch {
    throw new WorkOrderFinanceValidationError("INVALID_MONEY", `${field} must be numeric`);
  }

  if (!result.isFinite() || result.lessThan(0)) {
    throw new WorkOrderFinanceValidationError("INVALID_MONEY", `${field} must be a non-negative finite amount`);
  }

  return result.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function normalizeFinanceCurrency(value: unknown) {
  const currency = typeof value === "string" && value.trim() ? value.trim().toUpperCase() : "UAH";
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new WorkOrderFinanceValidationError("INVALID_CURRENCY", "Currency must be a 3-letter ISO code");
  }
  return currency;
}

export function calculateWorkOrderFinance(input: WorkOrderFinanceInput): WorkOrderFinanceCalculation {
  const amounts = Object.fromEntries(
    WORK_ORDER_FINANCE_FIELDS.map((field) => [field, money(input[field], field)]),
  ) as Record<WorkOrderFinanceField, Prisma.Decimal>;

  const currency = normalizeFinanceCurrency(input.currency);
  const grossRevenueBeforeDiscounts = amounts.laborRevenue
    .plus(amounts.partsRevenue)
    .plus(amounts.externalRevenue)
    .plus(amounts.otherRevenue);
  const reductions = amounts.discountAmount.plus(amounts.refundAmount);

  if (reductions.greaterThan(grossRevenueBeforeDiscounts)) {
    throw new WorkOrderFinanceValidationError(
      "REDUCTIONS_EXCEED_REVENUE",
      "Discounts and refunds cannot exceed gross sales",
    );
  }

  const grossRevenue = grossRevenueBeforeDiscounts.minus(reductions);
  const directCost = amounts.partsCost
    .plus(amounts.laborCost)
    .plus(amounts.externalCost)
    .plus(amounts.consumablesCost)
    .plus(amounts.otherDirectCost);
  const grossProfit = grossRevenue.minus(directCost);
  const grossMarginPercent = grossRevenue.isZero()
    ? null
    : grossProfit.div(grossRevenue).mul(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  const fingerprint = [
    currency,
    ...WORK_ORDER_FINANCE_FIELDS.map((field) => amounts[field].toFixed(2)),
  ].join("|");

  return {
    ...amounts,
    currency,
    grossRevenueBeforeDiscounts,
    grossRevenue,
    directCost,
    grossProfit,
    grossMarginPercent,
    fingerprint,
  };
}

export type RevenueAllocation = {
  code: "REV_LABOR" | "REV_PARTS" | "REV_EXTERNAL" | "REV_OTHER";
  label: string;
  amount: Prisma.Decimal;
};

export function allocateNetRevenue(calculation: WorkOrderFinanceCalculation): RevenueAllocation[] {
  const candidates = [
    { code: "REV_LABOR" as const, label: "Роботи", gross: calculation.laborRevenue },
    { code: "REV_PARTS" as const, label: "Продаж запчастин", gross: calculation.partsRevenue },
    { code: "REV_EXTERNAL" as const, label: "Сторонні роботи", gross: calculation.externalRevenue },
    { code: "REV_OTHER" as const, label: "Інші доходи замовлення", gross: calculation.otherRevenue },
  ].filter((item) => item.gross.greaterThan(0));

  if (candidates.length === 0 || calculation.grossRevenue.isZero()) return [];

  let allocated = new Prisma.Decimal(0);
  return candidates.map((item, index) => {
    const isLast = index === candidates.length - 1;
    const amount = isLast
      ? calculation.grossRevenue.minus(allocated)
      : calculation.grossRevenue
          .mul(item.gross)
          .div(calculation.grossRevenueBeforeDiscounts)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    allocated = allocated.plus(amount);
    return { code: item.code, label: item.label, amount };
  }).filter((item) => item.amount.greaterThan(0));
}

export function parseOptionalDate(value: unknown, field: string) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new WorkOrderFinanceValidationError("INVALID_DATE", `${field} must be an ISO date`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new WorkOrderFinanceValidationError("INVALID_DATE", `${field} must be an ISO date`);
  }
  return date;
}
