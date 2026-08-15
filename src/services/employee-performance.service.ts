import { getPrisma } from "@/src/lib/prisma";
import { calculateEmployeeEconomics, findBreakEvenAt } from "@/src/domain/employee-economics";

function endExclusive(date: Date) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

function dateOnly(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function asNumber(value: unknown) {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function weightedKpiScore(
  results: Array<{ kpiDefinitionId: string; score: unknown }>,
  rules: Array<{ kpiDefinitionId: string; weight: unknown }>,
) {
  const scores = new Map(
    results
      .filter((result) => result.score != null)
      .map((result) => [result.kpiDefinitionId, asNumber(result.score)] as const),
  );

  if (!scores.size) return null;

  let weighted = 0;
  let usedWeight = 0;
  for (const rule of rules) {
    const score = scores.get(rule.kpiDefinitionId);
    if (score == null) continue;
    const weight = asNumber(rule.weight);
    if (weight <= 0) continue;
    weighted += score * weight;
    usedWeight += weight;
  }

  if (usedWeight > 0) return Math.round((weighted / usedWeight) * 100) / 100;

  const values = [...scores.values()];
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

/**
 * Rebuilds one employee-period snapshot from immutable source facts.
 * No salary formula is encoded here: posted SalaryAccrual facts are consumed as-is.
 */
export async function rebuildEmployeeEconomicsSnapshot(args: {
  employeeId: string;
  periodStart: Date;
  periodEnd: Date;
  payrollPeriodId?: string | null;
}) {
  const prisma = getPrisma();
  const periodStart = dateOnly(args.periodStart);
  const periodEnd = dateOnly(args.periodEnd);
  const until = endExclusive(periodEnd);

  const [assignment, payroll, directCosts, attributionEntries, kpiResults] = await Promise.all([
    prisma.employeeRoleAssignment.findFirst({
      where: {
        employeeId: args.employeeId,
        startsAt: { lt: until },
        OR: [{ endsAt: null }, { endsAt: { gte: periodStart } }],
      },
      orderBy: [{ isPrimary: "desc" }, { startsAt: "desc" }],
      include: { role: { include: { kpiRules: true } } },
    }),
    prisma.salaryAccrual.aggregate({
      where: {
        employeeId: args.employeeId,
        status: "POSTED",
        occurredAt: { gte: periodStart, lt: until },
      },
      _sum: { amount: true },
    }),
    prisma.employeeCostEntry.aggregate({
      where: {
        employeeId: args.employeeId,
        occurredAt: { gte: periodStart, lt: until },
      },
      _sum: { amount: true },
    }),
    prisma.attributionLedgerEntry.findMany({
      where: {
        employeeId: args.employeeId,
        event: { status: "POSTED", occurredAt: { gte: periodStart, lt: until } },
      },
      include: { event: { select: { occurredAt: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.employeeKpiResult.findMany({
      where: { employeeId: args.employeeId, periodStart, periodEnd },
      select: { kpiDefinitionId: true, score: true },
    }),
  ]);

  const payrollCost = asNumber(payroll._sum.amount);
  const otherDirectCost = asNumber(directCosts._sum.amount);
  const fullCost = payrollCost + otherDirectCost;

  let directContribution = 0;
  let managedValue = 0;
  let influencedValue = 0;

  for (const entry of attributionEntries) {
    const economicValue = asNumber(entry.economicValue);
    if (entry.attributionType === "DIRECT" && entry.additiveContribution) {
      directContribution += economicValue;
    } else if (entry.attributionType === "MANAGED") {
      managedValue += economicValue;
    } else if (entry.attributionType === "INFLUENCED") {
      influencedValue += economicValue;
    }
  }

  const kpiScore = weightedKpiScore(kpiResults, assignment?.role.kpiRules ?? []);
  const economics = calculateEmployeeEconomics({
    fullCost,
    directContribution,
    managedValue,
    influencedValue,
    kpiScore,
    capacityUtilization: null,
  });

  const breakEvenAt = findBreakEvenAt(
    fullCost,
    attributionEntries.map((entry) => ({
      occurredAt: entry.event.occurredAt,
      attributionType: entry.attributionType,
      economicValue: asNumber(entry.economicValue),
      additiveContribution: entry.additiveContribution,
    })),
  );

  const completeness =
    (assignment ? 25 : 0) +
    (fullCost > 0 ? 25 : 0) +
    (attributionEntries.length ? 25 : 0) +
    (kpiResults.length ? 25 : 0);

  return prisma.employeeEconomicsSnapshot.upsert({
    where: {
      employeeId_periodStart_periodEnd: {
        employeeId: args.employeeId,
        periodStart,
        periodEnd,
      },
    },
    create: {
      employeeId: args.employeeId,
      payrollPeriodId: args.payrollPeriodId ?? null,
      periodStart,
      periodEnd,
      fullCost,
      directContribution,
      managedValue,
      influencedValue,
      breakEvenPct: economics.breakEvenPct,
      roiPct: economics.roiPct,
      breakEvenAt,
      capacityUtilization: null,
      kpiScore,
      status: economics.status,
      dataCompletenessPct: completeness,
      computedAt: new Date(),
    },
    update: {
      payrollPeriodId: args.payrollPeriodId ?? null,
      fullCost,
      directContribution,
      managedValue,
      influencedValue,
      breakEvenPct: economics.breakEvenPct,
      roiPct: economics.roiPct,
      breakEvenAt,
      kpiScore,
      status: economics.status,
      dataCompletenessPct: completeness,
      computedAt: new Date(),
    },
  });
}

export async function getEmployeePeriodEconomics(employeeId: string, periodStart: Date, periodEnd: Date) {
  const prisma = getPrisma();
  return prisma.employeeEconomicsSnapshot.findUnique({
    where: {
      employeeId_periodStart_periodEnd: {
        employeeId,
        periodStart: dateOnly(periodStart),
        periodEnd: dateOnly(periodEnd),
      },
    },
    include: {
      employee: { select: { id: true, firstName: true, lastName: true, position: true } },
      payrollPeriod: { select: { key: true, status: true } },
    },
  });
}
