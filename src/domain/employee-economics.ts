export type EconomicsStatus =
  | "INSUFFICIENT_DATA"
  | "BELOW_BREAK_EVEN"
  | "BREAK_EVEN"
  | "PROFITABLE"
  | "CAPACITY_CONSTRAINED"
  | "EFFECTIVE"
  | "UNDERUTILIZED"
  | "NEEDS_ATTENTION";

export type RoleEconomicsMode = "DIRECT_ROI" | "MANAGED_VALUE" | "SUPPORT_CAPACITY" | "OWNER";
export type AttributionType = "DIRECT" | "MANAGED" | "INFLUENCED";

export type EconomicsInput = {
  economicsMode?: RoleEconomicsMode;
  fullCost: number;
  directContribution: number;
  managedValue?: number;
  influencedValue?: number;
  kpiScore?: number | null;
  capacityUtilization?: number | null;
  underutilizedBelowPct?: number;
  capacityConstrainedAbovePct?: number;
  needsAttentionBelowKpi?: number;
};

export type EconomicsResult = {
  economicsMode: RoleEconomicsMode;
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

function operationalStatus(args: {
  mode: RoleEconomicsMode;
  managedValue: number;
  kpiScore: number | null;
  capacityUtilization: number | null;
  underutilizedBelowPct: number;
  capacityConstrainedAbovePct: number;
  needsAttentionBelowKpi: number;
}): EconomicsStatus {
  if (args.mode === "OWNER") return "INSUFFICIENT_DATA";
  if (args.capacityUtilization != null && args.capacityUtilization > args.capacityConstrainedAbovePct) {
    return "CAPACITY_CONSTRAINED";
  }
  if (args.capacityUtilization != null && args.capacityUtilization < args.underutilizedBelowPct) {
    return "UNDERUTILIZED";
  }
  if (args.kpiScore != null && args.kpiScore < args.needsAttentionBelowKpi) {
    return "NEEDS_ATTENTION";
  }
  if (args.kpiScore != null || args.capacityUtilization != null || (args.mode === "MANAGED_VALUE" && args.managedValue !== 0)) {
    return "EFFECTIVE";
  }
  return "INSUFFICIENT_DATA";
}

/**
 * DIRECT_ROI roles may use direct additive contribution for break-even/ROI.
 * MANAGED_VALUE and SUPPORT_CAPACITY roles are intentionally NOT given a fake
 * revenue ROI: they are evaluated through managed outcomes, KPI and capacity.
 * OWNER is evaluated by company-level economics, not as a normal employee role.
 */
export function calculateEmployeeEconomics(input: EconomicsInput): EconomicsResult {
  const economicsMode = input.economicsMode ?? "DIRECT_ROI";
  const fullCost = finite(input.fullCost);
  const directContribution = finite(input.directContribution);
  const managedValue = finite(input.managedValue);
  const influencedValue = finite(input.influencedValue);
  const kpiScore = input.kpiScore == null ? null : finite(input.kpiScore);
  const capacityUtilization = input.capacityUtilization == null ? null : finite(input.capacityUtilization);

  if (economicsMode !== "DIRECT_ROI") {
    return {
      economicsMode,
      fullCost,
      directContribution,
      managedValue,
      influencedValue,
      breakEvenPct: null,
      roiPct: null,
      kpiScore,
      capacityUtilization,
      status: operationalStatus({
        mode: economicsMode,
        managedValue,
        kpiScore,
        capacityUtilization,
        underutilizedBelowPct: input.underutilizedBelowPct ?? 60,
        capacityConstrainedAbovePct: input.capacityConstrainedAbovePct ?? 105,
        needsAttentionBelowKpi: input.needsAttentionBelowKpi ?? 70,
      }),
    };
  }

  if (fullCost <= 0) {
    return {
      economicsMode,
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
  let status: EconomicsStatus = Math.abs(delta) < 0.01
    ? "BREAK_EVEN"
    : delta > 0
      ? "PROFITABLE"
      : "BELOW_BREAK_EVEN";

  // Capacity explains *why* a direct role may be below break-even, without
  // overwriting the financial ROI number itself.
  if (capacityUtilization != null && capacityUtilization > (input.capacityConstrainedAbovePct ?? 105)) {
    status = "CAPACITY_CONSTRAINED";
  } else if (capacityUtilization != null && capacityUtilization < (input.underutilizedBelowPct ?? 60)) {
    status = "UNDERUTILIZED";
  } else if (kpiScore != null && kpiScore < (input.needsAttentionBelowKpi ?? 70) && directContribution < fullCost) {
    status = "NEEDS_ATTENTION";
  }

  return {
    economicsMode,
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

/** Capacity planning: verified demand / verified productive capacity of one FTE. */
export function calculateRequiredFte(demand: number, capacityPerFte: number) {
  if (!Number.isFinite(demand) || demand < 0) return null;
  if (!Number.isFinite(capacityPerFte) || capacityPerFte <= 0) return null;
  return round(demand / capacityPerFte, 2);
}

export function calculateCapacityUtilization(args: {
  demand: number;
  capacityPerFte: number;
  actualFte: number;
}) {
  if (!Number.isFinite(args.demand) || args.demand < 0) return null;
  if (!Number.isFinite(args.capacityPerFte) || args.capacityPerFte <= 0) return null;
  if (!Number.isFinite(args.actualFte) || args.actualFte <= 0) return args.demand > 0 ? null : 0;
  return round((args.demand / (args.capacityPerFte * args.actualFte)) * 100);
}

export function calculateRoleStatus(args: {
  economicsMode?: RoleEconomicsMode;
  actualFte: number;
  requiredFte: number | null;
  fullCost: number;
  directContribution: number;
  managedValue?: number;
  kpiScore?: number | null;
  utilizationPct?: number | null;
}): EconomicsStatus {
  const actualFte = finite(args.actualFte);
  const requiredFte = args.requiredFte == null ? null : finite(args.requiredFte);
  const utilizationPct = args.utilizationPct == null ? null : finite(args.utilizationPct);

  if (requiredFte != null && requiredFte > 0 && actualFte <= 0) return "CAPACITY_CONSTRAINED";

  return calculateEmployeeEconomics({
    economicsMode: args.economicsMode ?? "DIRECT_ROI",
    fullCost: args.fullCost,
    directContribution: args.directContribution,
    managedValue: args.managedValue,
    kpiScore: args.kpiScore,
    capacityUtilization: utilizationPct,
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
