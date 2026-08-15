export type EconomicsStatus =
  | "INSUFFICIENT_DATA"
  | "BELOW_BREAK_EVEN"
  | "BREAK_EVEN"
  | "PROFITABLE"
  | "CAPACITY_CONSTRAINED";

export type AttributionType = "DIRECT" | "MANAGED" | "INFLUENCED";

export type EconomicsInput = {
  fullCost: number;
  directContribution: number;
  managedValue?: number;
  influencedValue?: number;
  kpiScore?: number | null;
  capacityUtilization?: number | null;
};

export type EconomicsResult = {
  fullCost: number;
  directContribution: number;
  managedValue: number;
  influencedValue: number;
  breakEvenPct: number | null;
  roiPct: number | null;
  kpiScore: number | null;
  capacityUtilization: number | null;
  status: EconomicsStatus;
};

function finite(value: number | undefined | null, fallback = 0) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function round(value: number, digits = 2) {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

/**
 * DIRECT contribution is the only attribution type included in employee ROI.
 * MANAGED and INFLUENCED are explanatory metrics and must never be added to
 * accounting GP again, otherwise the same economic result would be counted twice.
 */
export function calculateEmployeeEconomics(input: EconomicsInput): EconomicsResult {
  const fullCost = finite(input.fullCost);
  const directContribution = finite(input.directContribution);
  const managedValue = finite(input.managedValue);
  const influencedValue = finite(input.influencedValue);
  const kpiScore = input.kpiScore == null ? null : finite(input.kpiScore);
  const capacityUtilization = input.capacityUtilization == null ? null : finite(input.capacityUtilization);

  if (fullCost <= 0) {
    return {
      fullCost,
      directContribution,
      managedValue,
      influencedValue,
      breakEvenPct: null,
      roiPct: null,
      kpiScore,
      capacityUtilization,
      status: "INSUFFICIENT_DATA",
    };
  }

  const breakEvenPct = round((directContribution / fullCost) * 100);
  const roiPct = round(((directContribution - fullCost) / fullCost) * 100);
  const delta = directContribution - fullCost;
  const status: EconomicsStatus = Math.abs(delta) < 0.01
    ? "BREAK_EVEN"
    : delta > 0
      ? "PROFITABLE"
      : "BELOW_BREAK_EVEN";

  return {
    fullCost,
    directContribution,
    managedValue,
    influencedValue,
    breakEvenPct,
    roiPct,
    kpiScore,
    capacityUtilization,
    status,
  };
}

export type ContributionEvent = {
  occurredAt: Date | string;
  attributionType: AttributionType;
  economicValue: number;
  additiveContribution?: boolean;
};

/** Finds the first moment where cumulative additive DIRECT contribution covers full employee cost. */
export function findBreakEvenAt(fullCost: number, events: ContributionEvent[]): Date | null {
  if (!Number.isFinite(fullCost) || fullCost <= 0) return null;

  const sorted = [...events].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
  );

  let cumulative = 0;
  for (const event of sorted) {
    if (event.attributionType !== "DIRECT" || event.additiveContribution !== true) continue;
    cumulative += finite(event.economicValue);
    if (cumulative + 0.0001 >= fullCost) return new Date(event.occurredAt);
  }
  return null;
}

/** Capacity planning: demand / verified productive capacity of one FTE. */
export function calculateRequiredFte(demand: number, capacityPerFte: number) {
  if (!Number.isFinite(demand) || demand < 0) return null;
  if (!Number.isFinite(capacityPerFte) || capacityPerFte <= 0) return null;
  return round(demand / capacityPerFte, 2);
}

export function calculateRoleStatus(args: {
  actualFte: number;
  requiredFte: number | null;
  fullCost: number;
  directContribution: number;
}): EconomicsStatus {
  const actualFte = finite(args.actualFte);
  const requiredFte = args.requiredFte == null ? null : finite(args.requiredFte);

  if (requiredFte != null && actualFte > 0 && requiredFte > actualFte * 1.05) {
    return "CAPACITY_CONSTRAINED";
  }
  return calculateEmployeeEconomics({
    fullCost: args.fullCost,
    directContribution: args.directContribution,
  }).status;
}

/**
 * Shared mechanic work defaults to evidence-based time allocation.
 * Manual percentages are only a fallback when no timing evidence exists.
 */
export function splitByActualMinutes<T extends { id: string; minutes: number }>(participants: T[]) {
  const normalized = participants.map((item) => ({ ...item, minutes: Math.max(0, finite(item.minutes)) }));
  const total = normalized.reduce((sum, item) => sum + item.minutes, 0);
  if (total <= 0) return normalized.map((item) => ({ ...item, share: 0 }));
  return normalized.map((item) => ({ ...item, share: round(item.minutes / total, 4) }));
}
