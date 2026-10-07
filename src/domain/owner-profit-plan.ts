export const OWNER_PROFIT_PLAN_MARKER = "OWNER_PROFIT_PLAN_V2|";

export type OwnerProfitBudget = {
  id: string;
  name: string;
  metric: string;
  amount: number;
  actual: number;
  variance: number;
  completionPercent: number | null;
  periodStart: string;
  periodEnd: string;
  notes?: string | null;
};

export type OwnerProfitPlanMeta = {
  periodType: "MONTH" | "QUARTER";
  minimum: number | null;
  stretch: number | null;
};

export type OwnerProfitFacts = {
  netIncome: number;
  expenseBreakdown?: {
    payroll?: number;
    otherDirect?: number;
    otherOperating?: number;
    otherExpense?: number;
    tax?: number;
  };
};

export type OwnerProfitComparison = {
  previousNetIncome: number;
  change: number;
  changePercent: number | null;
  drivers: Array<{ code: string; label: string; current: number; previous: number; impact: number }>;
};

export type OwnerProfitPlanStatus =
  | "NO_PLAN"
  | "NOT_STARTED"
  | "AHEAD"
  | "ON_TRACK"
  | "AT_RISK"
  | "CRITICAL"
  | "COMPLETED_MET"
  | "COMPLETED_MISSED";

export type OwnerProfitPlanSummary = {
  metric: "NET_INCOME";
  plan: OwnerProfitBudget | null;
  meta: OwnerProfitPlanMeta;
  start: string;
  end: string;
  totalDays: number;
  elapsedDays: number;
  remainingDays: number;
  actual: number;
  expectedToNow: number | null;
  gapToPace: number | null;
  remaining: number | null;
  requiredPerDay: number | null;
  paceForecast: number | null;
  forecastGap: number | null;
  completionPercent: number | null;
  projectedCompletionPercent: number | null;
  monthTarget: number | null;
  weekTarget: number | null;
  dayTarget: number | null;
  projectedShared: number;
  weekContributionTarget: number | null;
  status: OwnerProfitPlanStatus;
  previous: {
    amount: number | null;
    change: number | null;
    changePercent: number | null;
  };
  drivers: Array<{ code: string; label: string; current: number; previous: number; impact: number; direction: "POSITIVE" | "NEGATIVE" }>;
  preliminary: boolean;
  dataQualityScore: number | null;
};

const DAY_MS = 86_400_000;
export const OWNER_PLAN_STATUS_THRESHOLDS = {
  onTrackRatio: 0.98,
  criticalRatio: 0.90,
} as const;

function roundMoney(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

export function ownerFinanceDayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function ownerDateOnly(value: string) {
  return value.slice(0, 10);
}

function dateAtNoon(value: string) {
  return new Date(`${ownerDateOnly(value)}T12:00:00Z`);
}

function addDays(value: string, days: number) {
  const date = dateAtNoon(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function ownerDaysInclusive(from: string, to: string) {
  const start = dateAtNoon(from).getTime();
  const end = dateAtNoon(to).getTime();
  if (end < start) return 0;
  return Math.floor((end - start) / DAY_MS) + 1;
}

function clampDate(value: string, from: string, to: string) {
  return value < from ? from : value > to ? to : value;
}

function intersectionDays(aFrom: string, aTo: string, bFrom: string, bTo: string) {
  const start = aFrom > bFrom ? aFrom : bFrom;
  const end = aTo < bTo ? aTo : bTo;
  return end < start ? 0 : ownerDaysInclusive(start, end);
}

function monthBounds(anchor: string) {
  const date = dateAtNoon(anchor);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1, 12)).toISOString().slice(0, 10),
    end: new Date(Date.UTC(year, month + 1, 0, 12)).toISOString().slice(0, 10),
  };
}

function weekBounds(anchor: string) {
  const date = dateAtNoon(anchor);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  const start = date.toISOString().slice(0, 10);
  return { start, end: addDays(start, 6) };
}

export function ownerCurrentMonthBounds(today = ownerFinanceDayKey()) {
  return monthBounds(today);
}

export function parseOwnerProfitPlanMeta(plan: OwnerProfitBudget | null): OwnerProfitPlanMeta {
  if (!plan?.notes?.startsWith(OWNER_PROFIT_PLAN_MARKER)) {
    const from = ownerDateOnly(plan?.periodStart || ownerFinanceDayKey());
    const to = ownerDateOnly(plan?.periodEnd || ownerFinanceDayKey());
    return { periodType: ownerDaysInclusive(from, to) > 45 ? "QUARTER" : "MONTH", minimum: null, stretch: null };
  }
  try {
    const parsed = JSON.parse(plan.notes.slice(OWNER_PROFIT_PLAN_MARKER.length)) as Partial<OwnerProfitPlanMeta>;
    return {
      periodType: parsed.periodType === "QUARTER" ? "QUARTER" : "MONTH",
      minimum: typeof parsed.minimum === "number" ? parsed.minimum : null,
      stretch: typeof parsed.stretch === "number" ? parsed.stretch : null,
    };
  } catch {
    return { periodType: "MONTH", minimum: null, stretch: null };
  }
}

export function findOwnerProfitPlan(budgets: OwnerProfitBudget[] | undefined) {
  const candidates = (budgets || []).filter(
    (row) => row.metric === "NET_INCOME" && row.notes?.startsWith(OWNER_PROFIT_PLAN_MARKER),
  );
  return candidates.sort(
    (a, b) =>
      ownerDaysInclusive(ownerDateOnly(a.periodStart), ownerDateOnly(a.periodEnd))
      - ownerDaysInclusive(ownerDateOnly(b.periodStart), ownerDateOnly(b.periodEnd)),
  )[0] || null;
}

function statusFor(plan: OwnerProfitBudget | null, today: string, start: string, end: string, forecast: number | null, actual: number) {
  if (!plan) return "NO_PLAN" as const;
  if (today < start) return "NOT_STARTED" as const;
  if (today > end) return actual >= plan.amount ? "COMPLETED_MET" as const : "COMPLETED_MISSED" as const;
  if (forecast == null) return "AT_RISK" as const;
  if (forecast > plan.amount) return "AHEAD" as const;
  const ratio = plan.amount > 0 ? forecast / plan.amount : 0;
  if (ratio >= OWNER_PLAN_STATUS_THRESHOLDS.onTrackRatio) return "ON_TRACK" as const;
  if (ratio >= OWNER_PLAN_STATUS_THRESHOLDS.criticalRatio) return "AT_RISK" as const;
  return "CRITICAL" as const;
}

export function calculateOwnerProfitPlanSummary(input: {
  plan: OwnerProfitBudget | null;
  facts: OwnerProfitFacts | null | undefined;
  comparison?: OwnerProfitComparison | null;
  fixedMonthlyCosts?: number | null;
  preliminary?: boolean;
  dataQualityScore?: number | null;
  today?: string;
  fallbackPeriod?: { from: string; to: string };
}): OwnerProfitPlanSummary {
  const today = input.today || ownerFinanceDayKey();
  const fallback = input.fallbackPeriod || ownerCurrentMonthBounds(today);
  const plan = input.plan;
  const start = plan ? ownerDateOnly(plan.periodStart) : fallback.from;
  const end = plan ? ownerDateOnly(plan.periodEnd) : fallback.to;
  const totalDays = Math.max(1, ownerDaysInclusive(start, end));
  const elapsedDays = today < start ? 0 : today > end ? totalDays : ownerDaysInclusive(start, today);
  const remainingDays = Math.max(0, totalDays - elapsedDays);
  const actual = roundMoney(input.facts?.netIncome || 0) || 0;

  const paceForecastRaw = elapsedDays > 0
    ? (today > end ? actual : actual / elapsedDays * totalDays)
    : null;
  const paceForecast = roundMoney(paceForecastRaw);

  const expectedToNow = plan ? roundMoney(plan.amount * elapsedDays / totalDays) : null;
  const gapToPace = expectedToNow == null ? null : roundMoney(actual - expectedToNow);
  const remaining = plan ? roundMoney(Math.max(0, plan.amount - actual)) : null;
  const requiredPerDay = plan && remaining != null
    ? roundMoney(remainingDays > 0 ? remaining / remainingDays : remaining)
    : null;
  const forecastGap = plan && paceForecast != null ? roundMoney(paceForecast - plan.amount) : null;
  const completionPercent = plan?.amount ? roundMoney(actual / plan.amount * 100) : null;
  const projectedCompletionPercent = plan?.amount && paceForecast != null
    ? roundMoney(paceForecast / plan.amount * 100)
    : null;

  const anchor = clampDate(today, start, end);
  const month = monthBounds(anchor);
  const week = weekBounds(anchor);
  const monthDays = intersectionDays(start, end, month.start, month.end);
  const weekDays = intersectionDays(start, end, week.start, week.end);
  const monthTarget = plan ? roundMoney(plan.amount * monthDays / totalDays) : null;
  const weekTarget = plan ? roundMoney(plan.amount * weekDays / totalDays) : null;
  const dayTarget = plan ? roundMoney(plan.amount / totalDays) : null;

  const expense = input.facts?.expenseBreakdown;
  const sharedActual = (expense?.otherOperating || 0) + (expense?.otherExpense || 0) + (expense?.tax || 0);
  const projectedShared = roundMoney(
    elapsedDays > 0
      ? sharedActual / elapsedDays * totalDays
      : (input.fixedMonthlyCosts || 0) * (totalDays / 30),
  ) || 0;
  const requiredContributionTotal = plan ? plan.amount + Math.max(0, projectedShared) : 0;
  const weekContributionTarget = plan ? roundMoney(requiredContributionTotal * weekDays / totalDays) : null;

  const drivers = [...(input.comparison?.drivers || [])]
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
    .slice(0, 3)
    .map((row) => ({ ...row, direction: row.impact >= 0 ? "POSITIVE" as const : "NEGATIVE" as const }));

  return {
    metric: "NET_INCOME",
    plan,
    meta: parseOwnerProfitPlanMeta(plan),
    start,
    end,
    totalDays,
    elapsedDays,
    remainingDays,
    actual,
    expectedToNow,
    gapToPace,
    remaining,
    requiredPerDay,
    paceForecast,
    forecastGap,
    completionPercent,
    projectedCompletionPercent,
    monthTarget,
    weekTarget,
    dayTarget,
    projectedShared,
    weekContributionTarget,
    status: statusFor(plan, today, start, end, paceForecast, actual),
    previous: {
      amount: input.comparison ? roundMoney(input.comparison.previousNetIncome) : null,
      change: input.comparison ? roundMoney(input.comparison.change) : null,
      changePercent: input.comparison?.changePercent == null ? null : roundMoney(input.comparison.changePercent),
    },
    drivers,
    preliminary: Boolean(input.preliminary),
    dataQualityScore: input.dataQualityScore == null ? null : roundMoney(input.dataQualityScore),
  };
}
