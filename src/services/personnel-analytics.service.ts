import { getPrisma } from "@/src/lib/prisma";

function n(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function round(value: number, digits = 2) {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function dateOnly(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Server-only source for Analytics → Personnel & Efficiency.
 * It reads the same economics snapshots used by payroll/KPI workflows; there is no parallel spreadsheet model.
 */
export async function getPersonnelAnalytics(args: {
  periodStart: Date;
  periodEnd: Date;
  locationId?: string | null;
}) {
  const prisma = getPrisma();
  const periodStart = dateOnly(args.periodStart);
  const periodEnd = dateOnly(args.periodEnd);

  const roleAssignments = args.locationId
    ? await prisma.employeeRoleAssignment.findMany({
        where: {
          locationId: args.locationId,
          startsAt: { lte: periodEnd },
          OR: [{ endsAt: null }, { endsAt: { gte: periodStart } }],
        },
        select: { employeeId: true, roleId: true },
      })
    : null;

  const scopedEmployeeIds = roleAssignments ? [...new Set(roleAssignments.map((item) => item.employeeId))] : null;

  const [employees, roles] = await Promise.all([
    prisma.employeeEconomicsSnapshot.findMany({
      where: {
        periodStart,
        periodEnd,
        ...(scopedEmployeeIds ? { employeeId: { in: scopedEmployeeIds } } : {}),
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            position: true,
            isActive: true,
            roleAssignments: {
              where: {
                startsAt: { lte: periodEnd },
                OR: [{ endsAt: null }, { endsAt: { gte: periodStart } }],
              },
              orderBy: [{ isPrimary: "desc" }, { startsAt: "desc" }],
              take: 1,
              include: { role: { select: { code: true, name: true, economicsMode: true } } },
            },
          },
        },
      },
      orderBy: [{ status: "asc" }, { roiPct: "desc" }],
    }),
    prisma.roleEconomicsSnapshot.findMany({
      where: {
        periodStart,
        periodEnd,
        ...(args.locationId ? { locationId: args.locationId } : {}),
      },
      include: {
        role: { select: { code: true, name: true, economicsMode: true } },
        location: { select: { id: true, name: true } },
      },
      orderBy: [{ status: "asc" }, { roiPct: "desc" }],
    }),
  ]);

  const staffCost = employees.reduce((sum, row) => sum + n(row.fullCost), 0);
  const directContribution = employees.reduce((sum, row) => sum + n(row.directContribution), 0);
  const managedValue = employees.reduce((sum, row) => sum + n(row.managedValue), 0);
  const weightedCompleteness = employees.length
    ? employees.reduce((sum, row) => sum + n(row.dataCompletenessPct), 0) / employees.length
    : 0;

  const statusCounts = employees.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});

  const roleStatusCounts = roles.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});

  const headcount = employees.length;
  const profitable = statusCounts.PROFITABLE ?? 0;
  const belowBreakEven = statusCounts.BELOW_BREAK_EVEN ?? 0;
  const effective = statusCounts.EFFECTIVE ?? 0;
  const underutilized = statusCounts.UNDERUTILIZED ?? 0;
  const needsAttention = statusCounts.NEEDS_ATTENTION ?? 0;

  const employeesDto = employees.map((row) => {
    const assignment = row.employee.roleAssignments[0];
    return {
      employeeId: row.employeeId,
      name: `${row.employee.firstName} ${row.employee.lastName}`.trim(),
      position: row.employee.position,
      roleCode: assignment?.role.code ?? null,
      roleName: assignment?.role.name ?? null,
      economicsMode: row.economicsMode,
      isActive: row.employee.isActive,
      fullCost: round(n(row.fullCost)),
      directContribution: round(n(row.directContribution)),
      managedValue: round(n(row.managedValue)),
      influencedValue: round(n(row.influencedValue)),
      breakEvenPct: row.breakEvenPct == null ? null : round(n(row.breakEvenPct)),
      roiPct: row.roiPct == null ? null : round(n(row.roiPct)),
      breakEvenAt: row.breakEvenAt,
      capacityUtilization: row.capacityUtilization == null ? null : round(n(row.capacityUtilization)),
      kpiScore: row.kpiScore == null ? null : round(n(row.kpiScore)),
      status: row.status,
      dataCompletenessPct: row.dataCompletenessPct == null ? null : round(n(row.dataCompletenessPct)),
    };
  });

  const rolesDto = roles.map((row) => ({
    roleId: row.roleId,
    roleCode: row.role.code,
    roleName: row.role.name,
    economicsMode: row.role.economicsMode,
    locationId: row.locationId,
    locationName: row.location?.name ?? null,
    actualFte: round(n(row.actualFte)),
    requiredFte: row.requiredFte == null ? null : round(n(row.requiredFte)),
    fteGap: row.requiredFte == null ? null : round(n(row.requiredFte) - n(row.actualFte)),
    fullCost: round(n(row.fullCost)),
    directContribution: round(n(row.directContribution)),
    managedValue: round(n(row.managedValue)),
    roiPct: row.roiPct == null ? null : round(n(row.roiPct)),
    utilizationPct: row.utilizationPct == null ? null : round(n(row.utilizationPct)),
    kpiScore: row.kpiScore == null ? null : round(n(row.kpiScore)),
    status: row.status,
  }));

  return {
    period: { start: periodStart, end: periodEnd },
    scope: { locationId: args.locationId ?? null },
    summary: {
      headcount,
      fullStaffCost: round(staffCost),
      directContribution: round(directContribution),
      managedValue: round(managedValue),
      directContributionPerFte: headcount ? round(directContribution / headcount) : 0,
      fullCostPerFte: headcount ? round(staffCost / headcount) : 0,
      profitableEmployees: profitable,
      belowBreakEvenEmployees: belowBreakEven,
      effectiveEmployees: effective,
      underutilizedEmployees: underutilized,
      employeesNeedingAttention: needsAttention,
      capacityConstrainedRoles: roleStatusCounts.CAPACITY_CONSTRAINED ?? 0,
      underutilizedRoles: roleStatusCounts.UNDERUTILIZED ?? 0,
      rolesNeedingAttention: roleStatusCounts.NEEDS_ATTENTION ?? 0,
      dataCompletenessPct: round(weightedCompleteness),
    },
    employees: employeesDto,
    roles: rolesDto,
  };
}
