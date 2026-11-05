export type CompensationRule = {
  baseSalary: number;
  minimumSalary: number;
  workPercent: number;
  partsSalesPercent: number;
  partsMarginPercent: number;
  netProfitPercent: number;
};

export function roundCompensation(value: number) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function percentAmount(basis: number, percent: number) {
  if (!Number.isFinite(basis) || !Number.isFinite(percent) || basis <= 0 || percent <= 0) return 0;
  return roundCompensation(basis * Math.min(100, Math.max(0, percent)) / 100);
}

export function laborCompensation(revenue: number, workPercent: number) {
  return percentAmount(Math.max(0, revenue), workPercent);
}

export function partsCompensation(args: {
  sales: number;
  cost: number;
  salesPercent: number;
  marginPercent: number;
}) {
  const sales = Math.max(0, Number(args.sales || 0));
  const cost = Math.max(0, Number(args.cost || 0));
  const margin = Math.max(0, sales - cost);
  const fromSales = percentAmount(sales, args.salesPercent);
  const fromMargin = percentAmount(margin, args.marginPercent);
  return {
    sales: roundCompensation(sales),
    cost: roundCompensation(cost),
    margin: roundCompensation(margin),
    fromSales,
    fromMargin,
    total: roundCompensation(fromSales + fromMargin),
  };
}

export function dailyBaseAmount(monthlyBase: number, daysInMonth: number) {
  if (!Number.isFinite(monthlyBase) || monthlyBase <= 0 || daysInMonth <= 0) return 0;
  return roundCompensation(monthlyBase / daysInMonth);
}

export function profitShareCompensation(preShareNetProfit: number, percent: number) {
  return percentAmount(Math.max(0, preShareNetProfit), percent);
}

export function minimumSalaryTopUp(args: {
  minimumSalary: number;
  earnedBeforeTopUp: number;
  activeDays?: number;
  daysInMonth?: number;
}) {
  const minimum = Math.max(0, Number(args.minimumSalary || 0));
  const activeDays = args.activeDays == null ? null : Math.max(0, Number(args.activeDays));
  const daysInMonth = args.daysInMonth == null ? null : Math.max(1, Number(args.daysInMonth));
  const effectiveMinimum = activeDays != null && daysInMonth != null
    ? roundCompensation(minimum * Math.min(1, activeDays / daysInMonth))
    : minimum;
  return roundCompensation(Math.max(0, effectiveMinimum - Math.max(0, Number(args.earnedBeforeTopUp || 0))));
}

export function compensationProjection(args: {
  postedAccrued: number;
  postedBase: number;
  baseSalary: number;
  minimumSalary: number;
  estimatedProfitShare?: number;
}) {
  const postedAccrued = Math.max(0, Number(args.postedAccrued || 0));
  const postedBase = Math.max(0, Number(args.postedBase || 0));
  const futureBase = roundCompensation(Math.max(0, Number(args.baseSalary || 0) - postedBase));
  const profitShare = Math.max(0, Number(args.estimatedProfitShare || 0));
  const beforeMinimum = roundCompensation(postedAccrued + futureBase + profitShare);
  const minimumTopUp = minimumSalaryTopUp({
    minimumSalary: args.minimumSalary,
    earnedBeforeTopUp: beforeMinimum,
  });
  return {
    postedAccrued: roundCompensation(postedAccrued),
    futureBase,
    estimatedProfitShare: roundCompensation(profitShare),
    estimatedMinimumTopUp: minimumTopUp,
    total: roundCompensation(beforeMinimum + minimumTopUp),
  };
}
