export const MANAGEMENT_RESULT_METRIC = "MANAGEMENT_GROSS_PROFIT" as const;

export type WeightedTarget = { id: string; weight: number };
export type ManagementFinanceSnapshotLike = {
  laborRevenue?: unknown;
  partsRevenue?: unknown;
  externalRevenue?: unknown;
  otherRevenue?: unknown;
  discountAmount?: unknown;
  refundAmount?: unknown;
  partsCost?: unknown;
};

function finite(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function managementGrossFromSnapshot(snapshot: ManagementFinanceSnapshotLike) {
  const laborRevenue = Math.max(0, finite(snapshot.laborRevenue));
  const partsRevenue = Math.max(0, finite(snapshot.partsRevenue));
  const externalRevenue = Math.max(0, finite(snapshot.externalRevenue));
  const otherRevenue = Math.max(0, finite(snapshot.otherRevenue));
  const partsCost = Math.max(0, finite(snapshot.partsCost));
  const discountAmount = Math.max(0, finite(snapshot.discountAmount));
  const refundAmount = Math.max(0, finite(snapshot.refundAmount));
  const grossBeforeReductions = laborRevenue + partsRevenue + externalRevenue + otherRevenue;
  if (grossBeforeReductions <= 0) return roundMoney(-partsCost);

  const reductions = Math.min(grossBeforeReductions, discountAmount + refundAmount);
  const netFactor = (grossBeforeReductions - reductions) / grossBeforeReductions;
  const netLabor = laborRevenue * netFactor;
  const netParts = partsRevenue * netFactor;

  // TURBO LEV management KPI: executed service revenue + margin on parts.
  // External/other revenue is deliberately excluded until a separate management rule is approved.
  return roundMoney(netLabor + netParts - partsCost);
}

export function allocateMoneyByWeight(total: number, items: WeightedTarget[]) {
  const safeTotal = Math.max(0, roundMoney(total));
  const normalized = items.map((item) => ({ id: item.id, weight: Math.max(0, finite(item.weight)) }));
  const weightTotal = normalized.reduce((sum, item) => sum + item.weight, 0);
  if (!normalized.length) return [] as Array<{ id: string; amount: number }>;

  if (weightTotal <= 0) {
    const equal = normalized.map((item) => ({ id: item.id, weight: 1 }));
    return allocateMoneyByWeight(safeTotal, equal);
  }

  const totalCents = Math.round(safeTotal * 100);
  let allocatedCents = 0;
  return normalized.map((item, index) => {
    const cents = index === normalized.length - 1
      ? totalCents - allocatedCents
      : Math.round(totalCents * item.weight / weightTotal);
    allocatedCents += cents;
    return { id: item.id, amount: cents / 100 };
  });
}

function dateKeyFromUtc(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function weekKeys(anchor?: string | Date | null) {
  let base: Date;
  if (anchor instanceof Date) {
    base = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate(), 12));
  } else if (typeof anchor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(anchor)) {
    const [year, month, day] = anchor.split("-").map(Number);
    base = new Date(Date.UTC(year, month - 1, day, 12));
  } else {
    const now = new Date();
    base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
  }

  const mondayOffset = (base.getUTCDay() + 6) % 7;
  const monday = new Date(base);
  monday.setUTCDate(monday.getUTCDate() - mondayOffset);
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  const nextMonday = new Date(monday);
  nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);

  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday);
    day.setUTCDate(day.getUTCDate() + index);
    return dateKeyFromUtc(day);
  });

  return {
    start: dateKeyFromUtc(monday),
    end: dateKeyFromUtc(sunday),
    endExclusive: dateKeyFromUtc(nextMonday),
    days,
  };
}

export function planProgressPercent(fact: number | null, target: number | null) {
  if (fact == null || target == null || target <= 0) return null;
  return Math.round((fact / target) * 1000) / 10;
}

export function gapToPlan(target: number | null, forecastOrFact: number | null) {
  if (target == null || forecastOrFact == null) return null;
  return roundMoney(Math.max(0, target - forecastOrFact));
}
