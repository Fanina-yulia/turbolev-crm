export type PnlBuckets = {
  revenue: number;
  cogs: number;
  opex: number;
  otherIncome: number;
  otherExpense: number;
  tax: number;
};

export type PnlSummary = PnlBuckets & {
  grossProfit: number;
  operatingProfit: number;
  netProfit: number;
  grossMarginPercent: number | null;
  netMarginPercent: number | null;
};

export function decimalToNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value && typeof value === "object" && "toString" in value) {
    const parsed = Number(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function calculatePnl(input: PnlBuckets): PnlSummary {
  const grossProfit = input.revenue - input.cogs;
  const operatingProfit = grossProfit - input.opex;
  const netProfit = operatingProfit + input.otherIncome - input.otherExpense - input.tax;

  return {
    ...input,
    grossProfit,
    operatingProfit,
    netProfit,
    grossMarginPercent: input.revenue === 0 ? null : (grossProfit / input.revenue) * 100,
    netMarginPercent: input.revenue === 0 ? null : (netProfit / input.revenue) * 100,
  };
}

export function outstandingAmount(amount: unknown, settledAmount: unknown): number {
  return Math.max(0, decimalToNumber(amount) - decimalToNumber(settledAmount));
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
