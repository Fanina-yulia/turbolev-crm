import { getPrisma } from "@/src/lib/prisma";
import {
  calculateCapacityUtilization,
  calculateEmployeeEconomics,
  calculateRequiredFte,
  calculateRoleStatus,
} from "@/src/domain/employee-economics";

function dateOnly(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endExclusive(date: Date) {
  const next = dateOnly(date);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function n(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function round(value: number, digits = 2) {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

/**
 * Effective FTE is time-weighted over the requested period. A person assigned
 * for half of a month counts as ~0.5 FTE. Overlapping assignments for the same
 * person are capped at 1.0 FTE inside the role/location scope.
 */
function effectiveFteByEmployee(
  assignments: Array<{ employeeId: string; startsAt: Date; endsAt: Date | null }>,
  periodStart: Date,
  periodEnd: Date,
) {
  const periodFrom = dateOnly(periodStart);
  const periodUntil = endExclusive(periodEnd);
  const periodMs = Math.max(1, periodUntil.getTime() - periodFrom.getTime());
  const fractions = new Map<string, number>();

  for (const assignment of assignments) {
    const fromMs = Math.max(periodFrom.getTime(), assignment.startsAt.getTime());
    const untilMs = Math.min(periodUntil.getTime(), assignment.endsAt?.getTime() ?? periodUntil.getTime());
    const overlapMs = Math.max(0, untilMs - fromMs);
    const fraction = Math.min(1, overlapMs / periodMs);
    fractions.set(assignment.employeeId, Math.min(1, (fractions.get(assignment.employeeId) ?? 0) + fraction));
  }

  return fractions;
}

function weightedAverage(
  rows: Array<{ employeeId: string; value: unknown }>,
  fteByEmployee: Map<string, number>,
) {
  let total = 0;
  let weight = 0;
  for (const row of rows) {
    if (row.value == null) continue;
    const employeeWeight = fteByEmployee.get(row.employeeId) ?? 1;
    if (employeeWeight <= 0) continue;
    total += n(row.value) * employeeWeight;
    weight += employeeWeight;
  }
  return weight > 0 ? round(total / weight) : null;
}

export async function recordRoleDemandSnapshot(args: {
  roleId: string;
  locationId?: string | null;
  periodStart: Date;
  periodEnd: Date;
  metricCode: string;
  demandValue: number;
  unit: "COUNT" | "HOURS" | "NORM_HOURS" | "PERCENT" | "UAH" | "SCORE" | "MINUTES" | "DAYS" | "RATIO";
  sourceType: string;
  sourceId?: string | null;
  dataCompletenessPct?: number | null;
}) {
  if (!Number.isFinite(args.demandValue) || args.demandValue < 0) {
    throw new Error("Role demand must be a non-negative finite value.");
  }
  if (
    args.dataCompletenessPct != null &&
    (!Number.isFinite(args.dataCompletenessPct) || args.dataCompletenessPct < 0 || args.dataCompletenessPct > 100)
  ) {
    throw new Error("Demand data completeness must be between 0 and 100.");
  }

  const prisma = getPrisma();
  const periodStart = dateOnly(args.periodStart);
  const periodEnd = dateOnly(args.periodEnd);
  const locationKey = args.locationId ?? "ALL";
  const metricCode = args.metricCode.trim();
  if (!metricCode) throw new Error("Demand metricCode is required.");

  const snapshotKey = [
    args.roleId,
    locationKey,
    metricCode,
    periodStart.toISOString().slice(0, 10),
    periodEnd.toISOString().slice(0, 10),
  ].join(":");

  return prisma.roleDemandSnapshot.upsert({
    where: { snapshotKey },
    create: {
      snapshotKey,
      roleId: args.roleId,
      locationId: args.locationId ?? null,
      periodStart,
      periodEnd,
      metricCode,
      demandValue: args.demandValue,
      unit: args.unit,
      sourceType: args.sourceType,
      sourceId: args.sourceId ?? null,
      dataCompletenessPct: args.dataCompletenessPct ?? null,
      computedAt: new Date(),
    },
    update: {
      demandValue: args.demandValue,
      unit: args.unit,
      sourceType: args.sourceType,
      sourceId: args.sourceId ?? null,
      dataCompletenessPct: args.dataCompletenessPct ?? null,
      computedAt: new Date(),
    },
  });
}

type CapacityMatch = {
  demand: {
    metricCode: string;
    demandValue: unknown;
    unit: string;
    dataCompletenessPct: unknown;
  };
  capacity: {
    capacityPerFte: unknown;
    unit: string;
    locationId: string | null;
  };
};

/**
 * Builds the role economics snapshot from employee economics plus explicit,
 * verified demand/capacity. It never guesses demand and never silently chooses
 * between competing capacity metrics: ambiguous capacity data blocks Required FTE.
 */
export async function rebuildRoleEconomicsSnapshot(args: {
  roleId: string;
  locationId?: string | null;
  periodStart: Date;
  periodEnd: Date;
}) {
  const prisma = getPrisma();
  const periodStart = dateOnly(args.periodStart);
  const periodEnd = dateOnly(args.periodEnd);
  const until = endExclusive(periodEnd);

  const role = await prisma.staffRole.findUnique({
    where: { id: args.roleId },
    select: { id: true, code: true, name: true, economicsMode: true },
  });
  if (!role) throw new Error("Staff role not found.");

  const assignments = await prisma.employeeRoleAssignment.findMany({
    where: {
      roleId: role.id,
      ...(args.locationId ? { locationId: args.locationId } : {}),
      startsAt: { lt: until },
      OR: [{ endsAt: null }, { endsAt: { gt: periodStart } }],
    },
    select: { employeeId: true, startsAt: true, endsAt: true },
  });

  const fteByEmployee = effectiveFteByEmployee(assignments, periodStart, periodEnd);
  const employeeIds = [...fteByEmployee.keys()];
  const actualFte = round([...fteByEmployee.values()].reduce((sum, value) => sum + value, 0));

  const demands = await prisma.roleDemandSnapshot.findMany({
    where: {
      roleId: role.id,
      locationId: args.locationId ?? null,
      periodStart,
      periodEnd,
    },
    orderBy: [{ computedAt: "desc" }, { metricCode: "asc" }],
    select: {
      metricCode: true,
      demandValue: true,
      unit: true,
      dataCompletenessPct: true,
    },
  });

  const metricCodes = [...new Set(demands.map((item) => item.metricCode))];
  const standards = metricCodes.length
    ? await prisma.roleCapacityStandard.findMany({
        where: {
          roleId: role.id,
          metricCode: { in: metricCodes },
          effectiveFrom: { lte: periodEnd },
          AND: [
            { OR: [{ effectiveTo: null }, { effectiveTo: { gte: periodStart } }] },
            args.locationId
              ? { OR: [{ locationId: args.locationId }, { locationId: null }] }
              : { locationId: null },
          ],
        },
        orderBy: [{ effectiveFrom: "desc" }, { metricCode: "asc" }],
        select: { metricCode: true, capacityPerFte: true, unit: true, locationId: true },
      })
    : [];

  const matches: CapacityMatch[] = [];
  for (const demand of demands) {
    const metricStandards = standards.filter((item) => item.metricCode === demand.metricCode && item.unit === demand.unit);
    const capacity =
      (args.locationId ? metricStandards.find((item) => item.locationId === args.locationId) : undefined) ??
      metricStandards.find((item) => item.locationId == null) ??
      null;
    if (capacity) matches.push({ demand, capacity });
  }

  // One role-period should have exactly one authoritative capacity metric.
  const capacityAmbiguous = matches.length > 1;
  const match = matches.length === 1 ? matches[0] : null;
  const demandValue = match ? n(match.demand.demandValue) : null;
  const capacityPerFte = match ? n(match.capacity.capacityPerFte) : null;
  const requiredFte = demandValue != null && capacityPerFte != null
    ? calculateRequiredFte(demandValue, capacityPerFte)
    : null;
  const utilizationPct = demandValue != null && capacityPerFte != null
    ? calculateCapacityUtilization({ demand: demandValue, capacityPerFte, actualFte })
    : null;

  const employeeSnapshots = employeeIds.length
    ? await prisma.employeeEconomicsSnapshot.findMany({
        where: { employeeId: { in: employeeIds }, periodStart, periodEnd },
        select: {
          employeeId: true,
          fullCost: true,
          directContribution: true,
          managedValue: true,
          kpiScore: true,
        },
      })
    : [];

  const fullCost = round(employeeSnapshots.reduce((sum, row) => sum + n(row.fullCost), 0));
  const directContribution = round(employeeSnapshots.reduce((sum, row) => sum + n(row.directContribution), 0));
  const managedValue = round(employeeSnapshots.reduce((sum, row) => sum + n(row.managedValue), 0));
  const kpiScore = weightedAverage(
    employeeSnapshots.map((row) => ({ employeeId: row.employeeId, value: row.kpiScore })),
    fteByEmployee,
  );

  const economics = calculateEmployeeEconomics({
    economicsMode: role.economicsMode,
    fullCost,
    directContribution,
    managedValue,
    kpiScore,
    capacityUtilization: utilizationPct,
  });

  const status = capacityAmbiguous
    ? "INSUFFICIENT_DATA" as const
    : calculateRoleStatus({
        economicsMode: role.economicsMode,
        actualFte,
        requiredFte,
        fullCost,
        directContribution,
        managedValue,
        kpiScore,
        utilizationPct,
      });

  const snapshotKey = [
    role.id,
    args.locationId ?? "ALL",
    periodStart.toISOString().slice(0, 10),
    periodEnd.toISOString().slice(0, 10),
  ].join(":");

  const snapshot = await prisma.roleEconomicsSnapshot.upsert({
    where: { snapshotKey },
    create: {
      snapshotKey,
      roleId: role.id,
      locationId: args.locationId ?? null,
      periodStart,
      periodEnd,
      actualFte,
      requiredFte,
      fullCost,
      directContribution,
      managedValue,
      roiPct: role.economicsMode === "DIRECT_ROI" ? economics.roiPct : null,
      utilizationPct,
      kpiScore,
      status,
      computedAt: new Date(),
    },
    update: {
      actualFte,
      requiredFte,
      fullCost,
      directContribution,
      managedValue,
      roiPct: role.economicsMode === "DIRECT_ROI" ? economics.roiPct : null,
      utilizationPct,
      kpiScore,
      status,
      computedAt: new Date(),
    },
    include: {
      role: { select: { code: true, name: true, economicsMode: true } },
      location: { select: { id: true, name: true } },
    },
  });

  return {
    snapshot,
    capacityBasis: match
      ? {
          metricCode: match.demand.metricCode,
          demandValue,
          unit: match.demand.unit,
          demandDataCompletenessPct: match.demand.dataCompletenessPct,
          capacityPerFte,
          capacityLocationId: match.capacity.locationId,
        }
      : null,
    diagnostics: {
      employeeCount: employeeIds.length,
      employeeSnapshotsFound: employeeSnapshots.length,
      demandMetrics: metricCodes,
      compatibleCapacityMetrics: matches.map((item) => item.demand.metricCode),
      capacityAmbiguous,
      missingDemand: demands.length === 0,
      missingCompatibleCapacity: matches.length === 0,
    },
  };
}
