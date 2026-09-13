import { getPrisma } from "@/src/lib/prisma";

const TERMINAL_QC = new Set(["PASSED", "FAILED", "RECHECK"]);

function numberOf(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function round(value: number, digits = 1) {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function pct(part: number, total: number) {
  return total > 0 ? round((part / total) * 100, 1) : null;
}

function minutesBetween(start: Date, end: Date) {
  return Math.max(0, end.getTime() - start.getTime()) / 60_000;
}

function overlapMinutes(start: Date, end: Date | null, from: Date, to: Date) {
  const effectiveEnd = end ?? to;
  const left = Math.max(start.getTime(), from.getTime());
  const right = Math.min(effectiveEnd.getTime(), to.getTime());
  return Math.max(0, right - left) / 60_000;
}

export type PersonnelOperationalAnalyticsArgs = {
  from: Date;
  to: Date;
  locationIds?: string[] | null;
  mechanicId?: string | null;
  postId?: string | null;
};

type MechanicAccumulator = {
  completedJobs: number;
  workOrders: Set<string>;
  normHours: number;
  trackedLaborMinutes: number;
  timedLines: number;
  assignedMinutes: number;
  actualAppointmentMinutes: number;
  completedAppointments: number;
  timedCompletedAppointments: number;
  cycleMinutes: number;
  onTimeAppointments: number;
  blockedWorkOrders: Set<string>;
  blockerMinutes: number;
  qcEligible: number;
  qcFirstPass: number;
};

function emptyAccumulator(): MechanicAccumulator {
  return {
    completedJobs: 0,
    workOrders: new Set<string>(),
    normHours: 0,
    trackedLaborMinutes: 0,
    timedLines: 0,
    assignedMinutes: 0,
    actualAppointmentMinutes: 0,
    completedAppointments: 0,
    timedCompletedAppointments: 0,
    cycleMinutes: 0,
    onTimeAppointments: 0,
    blockedWorkOrders: new Set<string>(),
    blockerMinutes: 0,
    qcEligible: 0,
    qcFirstPass: 0,
  };
}

export async function getPersonnelOperationalAnalytics(args: PersonnelOperationalAnalyticsArgs) {
  const prisma = getPrisma();
  const now = new Date();
  const effectiveTo = new Date(Math.min(args.to.getTime(), now.getTime()));
  const locationIds = args.locationIds ?? null;

  const availableMechanics = await prisma.serviceMechanic.findMany({
    where: {
      isActive: true,
      ...(locationIds ? { locationId: { in: locationIds } } : {}),
    },
    select: { id: true, name: true, locationId: true, employeeId: true },
    orderBy: [{ locationId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });

  const availablePosts = await prisma.servicePost.findMany({
    where: {
      isActive: true,
      ...(locationIds ? { locationId: { in: locationIds } } : {}),
    },
    select: { id: true, name: true, locationId: true },
    orderBy: [{ locationId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });

  let scopedWorkOrderIds: string[] | null = null;
  if (locationIds) {
    const scopedRows = await prisma.serviceAppointment.findMany({
      where: {
        locationId: { in: locationIds },
        workOrderId: { not: null },
        NOT: { id: { startsWith: "demo_" } },
      },
      select: { workOrderId: true },
      distinct: ["workOrderId"],
    });
    scopedWorkOrderIds = scopedRows.map((row) => row.workOrderId).filter((id): id is string => Boolean(id));
  }

  const appointmentScope = {
    ...(locationIds ? { locationId: { in: locationIds } } : {}),
    ...(args.mechanicId ? { mechanicId: args.mechanicId } : { mechanicId: { not: null } }),
    ...(args.postId ? { postId: args.postId } : {}),
  };

  const appointments = await prisma.serviceAppointment.findMany({
    where: {
      ...appointmentScope,
      status: { notIn: ["CANCELLED", "RESERVE", "NO_SHOW"] },
      NOT: { id: { startsWith: "demo_" } },
      OR: [
        { plannedStartAt: { gte: args.from, lt: args.to } },
        { actualEndAt: { gte: args.from, lt: args.to } },
      ],
    },
    select: {
      id: true,
      locationId: true,
      postId: true,
      mechanicId: true,
      workOrderId: true,
      vehicleLabel: true,
      plateNumber: true,
      plannedStartAt: true,
      plannedEndAt: true,
      actualStartAt: true,
      actualEndAt: true,
    },
  });

  const appointmentWorkOrderIds = appointments.map((row) => row.workOrderId).filter((id): id is string => Boolean(id));
  const postScopedIds = args.postId ? [...new Set(appointmentWorkOrderIds)] : null;

  const laborWorkOrderScope = postScopedIds
    ? { workOrderId: { in: postScopedIds } }
    : scopedWorkOrderIds
      ? { workOrderId: { in: scopedWorkOrderIds } }
      : {};

  const laborLines = (postScopedIds?.length === 0 || scopedWorkOrderIds?.length === 0)
    ? []
    : await prisma.workOrderLine.findMany({
        where: {
          ...laborWorkOrderScope,
          type: "LABOR",
          status: "COMPLETED",
          completedAt: { gte: args.from, lt: args.to },
          mechanicId: args.mechanicId ? args.mechanicId : { not: null },
          NOT: { workOrderId: { startsWith: "demo_" } },
        },
        select: {
          id: true,
          workOrderId: true,
          mechanicId: true,
          laborHours: true,
          startedAt: true,
          completedAt: true,
        },
      });

  const workOrderIds = [...new Set([
    ...appointmentWorkOrderIds,
    ...laborLines.map((row) => row.workOrderId),
  ])];
  const appointmentIds = appointments.map((row) => row.id);

  const [blockers, qcRows] = await Promise.all([
    workOrderIds.length || appointmentIds.length
      ? prisma.operationalBlocker.findMany({
          where: {
            status: { not: "CANCELLED" },
            AND: [
              {
                OR: [
                  ...(workOrderIds.length ? [{ workOrderId: { in: workOrderIds } }] : []),
                  ...(appointmentIds.length ? [{ appointmentId: { in: appointmentIds } }] : []),
                ],
              },
              { createdAt: { lt: args.to } },
              { OR: [{ resolvedAt: null }, { resolvedAt: { gte: args.from } }] },
            ],
          },
          select: {
            id: true,
            workOrderId: true,
            workOrderLineId: true,
            appointmentId: true,
            createdAt: true,
            resolvedAt: true,
            code: true,
          },
        })
      : [],
    workOrderIds.length
      ? prisma.workOrderQualityControl.findMany({
          where: {
            workOrderId: { in: workOrderIds },
            attempt: 1,
            completedAt: { gte: args.from, lt: args.to },
          },
          select: { workOrderId: true, status: true, completedAt: true },
        })
      : [],
  ]);

  const mechanicIds = [...new Set([
    ...appointments.map((row) => row.mechanicId),
    ...laborLines.map((row) => row.mechanicId),
  ].filter((id): id is string => Boolean(id)))];

  const mechanicRows = mechanicIds.length
    ? await prisma.serviceMechanic.findMany({
        where: { id: { in: mechanicIds } },
        select: { id: true, name: true, locationId: true, employeeId: true },
      })
    : [];

  const accumulators = new Map<string, MechanicAccumulator>();
  const accumulator = (mechanicId: string) => {
    const current = accumulators.get(mechanicId) ?? emptyAccumulator();
    accumulators.set(mechanicId, current);
    return current;
  };

  const workOrderMechanics = new Map<string, Set<string>>();
  const appointmentById = new Map(appointments.map((row) => [row.id, row]));
  const appointmentByWorkOrder = new Map<string, typeof appointments[number]>();
  for (const appointment of appointments) {
    if (!appointment.mechanicId) continue;
    const current = accumulator(appointment.mechanicId);
    current.assignedMinutes += overlapMinutes(appointment.plannedStartAt, appointment.plannedEndAt, args.from, args.to);
    if (appointment.actualStartAt && appointment.actualEndAt) {
      current.actualAppointmentMinutes += overlapMinutes(appointment.actualStartAt, appointment.actualEndAt, args.from, effectiveTo);
    }
    if (appointment.actualEndAt && appointment.actualEndAt >= args.from && appointment.actualEndAt < args.to) {
      current.completedAppointments += 1;
      if (appointment.actualStartAt) {
        current.timedCompletedAppointments += 1;
        current.cycleMinutes += minutesBetween(appointment.actualStartAt, appointment.actualEndAt);
      }
      if (appointment.actualEndAt <= appointment.plannedEndAt) current.onTimeAppointments += 1;
    }
    if (appointment.workOrderId) {
      const mechanics = workOrderMechanics.get(appointment.workOrderId) ?? new Set<string>();
      mechanics.add(appointment.mechanicId);
      workOrderMechanics.set(appointment.workOrderId, mechanics);
      if (!appointmentByWorkOrder.has(appointment.workOrderId)) appointmentByWorkOrder.set(appointment.workOrderId, appointment);
    }
  }

  const lineById = new Map<string, typeof laborLines[number]>();
  for (const line of laborLines) {
    if (!line.mechanicId) continue;
    lineById.set(line.id, line);
    const current = accumulator(line.mechanicId);
    current.completedJobs += 1;
    current.workOrders.add(line.workOrderId);
    current.normHours += numberOf(line.laborHours);
    if (line.startedAt && line.completedAt) {
      current.timedLines += 1;
      current.trackedLaborMinutes += minutesBetween(line.startedAt, line.completedAt);
    }
    const mechanics = workOrderMechanics.get(line.workOrderId) ?? new Set<string>();
    mechanics.add(line.mechanicId);
    workOrderMechanics.set(line.workOrderId, mechanics);
  }

  const uniqueBlockedWorkOrders = new Set<string>();
  let blockerMinutes = 0;
  for (const blocker of blockers) {
    const minutes = overlapMinutes(blocker.createdAt, blocker.resolvedAt, args.from, effectiveTo);
    blockerMinutes += minutes;
    if (blocker.workOrderId) uniqueBlockedWorkOrders.add(blocker.workOrderId);

    const impacted = new Set<string>();
    if (blocker.workOrderLineId) {
      const line = lineById.get(blocker.workOrderLineId);
      if (line?.mechanicId) impacted.add(line.mechanicId);
    }
    if (blocker.appointmentId) {
      const appointment = appointmentById.get(blocker.appointmentId);
      if (appointment?.mechanicId) impacted.add(appointment.mechanicId);
    }
    if (blocker.workOrderId) {
      for (const mechanicId of workOrderMechanics.get(blocker.workOrderId) ?? []) impacted.add(mechanicId);
    }
    for (const mechanicId of impacted) {
      const current = accumulator(mechanicId);
      if (blocker.workOrderId) current.blockedWorkOrders.add(blocker.workOrderId);
      current.blockerMinutes += minutes;
    }
  }

  const qcByWorkOrder = new Map<string, string>();
  for (const qc of qcRows) {
    if (!TERMINAL_QC.has(qc.status)) continue;
    qcByWorkOrder.set(qc.workOrderId, qc.status);
    for (const mechanicId of workOrderMechanics.get(qc.workOrderId) ?? []) {
      const current = accumulator(mechanicId);
      current.qcEligible += 1;
      if (qc.status === "PASSED") current.qcFirstPass += 1;
    }
  }

  const nameById = new Map(mechanicRows.map((row) => [row.id, row]));
  const mechanics = [...accumulators.entries()].map(([mechanicId, current]) => {
    const meta = nameById.get(mechanicId);
    const trackedLaborHours = round(current.trackedLaborMinutes / 60, 1);
    const normHours = round(current.normHours, 1);
    const assignedHours = round(current.assignedMinutes / 60, 1);
    const actualAppointmentHours = round(current.actualAppointmentMinutes / 60, 1);
    return {
      mechanicId,
      employeeId: meta?.employeeId ?? null,
      locationId: meta?.locationId ?? null,
      name: meta?.name ?? "Механік",
      completedJobs: current.completedJobs,
      workOrders: current.workOrders.size,
      normHours,
      trackedLaborHours,
      efficiencyPct: current.trackedLaborMinutes > 0 ? round((current.normHours * 60 / current.trackedLaborMinutes) * 100, 1) : null,
      timingCoveragePct: pct(current.timedLines, current.completedJobs),
      assignedHours,
      actualAppointmentHours,
      assignedTimeUsePct: current.assignedMinutes > 0 ? round((current.actualAppointmentMinutes / current.assignedMinutes) * 100, 1) : null,
      averageCycleMinutes: current.timedCompletedAppointments > 0 ? round(current.cycleMinutes / current.timedCompletedAppointments, 0) : null,
      onTimePct: pct(current.onTimeAppointments, current.completedAppointments),
      blockerHours: round(current.blockerMinutes / 60, 1),
      blockedWorkOrders: current.blockedWorkOrders.size,
      blockerOrderRatePct: pct(current.blockedWorkOrders.size, current.workOrders.size),
      qcFirstPassPct: pct(current.qcFirstPass, current.qcEligible),
      qcEligibleWorkOrders: current.qcEligible,
    };
  }).sort((a, b) => b.normHours - a.normHours || b.completedJobs - a.completedJobs || a.name.localeCompare(b.name, "uk"));

  const totalNormHours = laborLines.reduce((sum, row) => sum + numberOf(row.laborHours), 0);
  const timedLaborLines = laborLines.filter((row) => row.startedAt && row.completedAt);
  const totalTrackedLaborMinutes = timedLaborLines.reduce((sum, row) => sum + minutesBetween(row.startedAt!, row.completedAt!), 0);
  const completedAppointments = appointments.filter((row) => row.actualEndAt && row.actualEndAt >= args.from && row.actualEndAt < args.to);
  const timedCompletedAppointments = completedAppointments.filter((row) => row.actualStartAt && row.actualEndAt);
  const totalCycleMinutes = timedCompletedAppointments.reduce((sum, row) => sum + minutesBetween(row.actualStartAt!, row.actualEndAt!), 0);
  const onTimeAppointments = completedAppointments.filter((row) => row.actualEndAt! <= row.plannedEndAt).length;
  const assignedMinutes = appointments.reduce((sum, row) => sum + overlapMinutes(row.plannedStartAt, row.plannedEndAt, args.from, args.to), 0);
  const actualAppointmentMinutes = appointments.reduce((sum, row) => row.actualStartAt && row.actualEndAt
    ? sum + overlapMinutes(row.actualStartAt, row.actualEndAt, args.from, effectiveTo)
    : sum, 0);
  const terminalQcRows = qcRows.filter((row) => TERMINAL_QC.has(row.status));
  const firstPassRows = terminalQcRows.filter((row) => row.status === "PASSED");
  const workedWorkOrderIds = new Set(laborLines.map((row) => row.workOrderId));
  const blockedWorkedIds = new Set([...uniqueBlockedWorkOrders].filter((id) => workedWorkOrderIds.has(id)));

  const caseMap = new Map<string, {
    workOrderId: string;
    appointmentId: string | null;
    vehicleLabel: string;
    plateNumber: string | null;
    mechanicIds: Set<string>;
    completedAt: Date | null;
    blockerCount: number;
    qcFirstPass: boolean | null;
  }>();
  for (const line of laborLines) {
    const appointment = appointmentByWorkOrder.get(line.workOrderId);
    const current = caseMap.get(line.workOrderId) ?? {
      workOrderId: line.workOrderId,
      appointmentId: appointment?.id ?? null,
      vehicleLabel: appointment?.vehicleLabel || "Автомобіль",
      plateNumber: appointment?.plateNumber ?? null,
      mechanicIds: new Set<string>(),
      completedAt: null,
      blockerCount: 0,
      qcFirstPass: qcByWorkOrder.has(line.workOrderId) ? qcByWorkOrder.get(line.workOrderId) === "PASSED" : null,
    };
    if (line.mechanicId) current.mechanicIds.add(line.mechanicId);
    if (line.completedAt && (!current.completedAt || line.completedAt > current.completedAt)) current.completedAt = line.completedAt;
    caseMap.set(line.workOrderId, current);
  }
  for (const blocker of blockers) {
    if (!blocker.workOrderId) continue;
    const current = caseMap.get(blocker.workOrderId);
    if (current) current.blockerCount += 1;
  }

  const cases = [...caseMap.values()]
    .map((row) => ({ ...row, mechanicIds: [...row.mechanicIds] }))
    .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))
    .slice(0, 100);

  return {
    filters: {
      mechanics: availableMechanics.map((row) => ({ id: row.id, name: row.name, locationId: row.locationId })),
      posts: availablePosts,
      selectedMechanicId: args.mechanicId ?? null,
      selectedPostId: args.postId ?? null,
    },
    summary: {
      mechanics: mechanics.length,
      completedLaborLines: laborLines.length,
      workOrders: workedWorkOrderIds.size,
      normHours: round(totalNormHours, 1),
      trackedLaborHours: round(totalTrackedLaborMinutes / 60, 1),
      efficiencyPct: totalTrackedLaborMinutes > 0 ? round((totalNormHours * 60 / totalTrackedLaborMinutes) * 100, 1) : null,
      timingCoveragePct: pct(timedLaborLines.length, laborLines.length),
      assignedHours: round(assignedMinutes / 60, 1),
      actualAppointmentHours: round(actualAppointmentMinutes / 60, 1),
      assignedTimeUsePct: assignedMinutes > 0 ? round((actualAppointmentMinutes / assignedMinutes) * 100, 1) : null,
      averageCycleMinutes: timedCompletedAppointments.length ? round(totalCycleMinutes / timedCompletedAppointments.length, 0) : null,
      cycleCoveragePct: pct(timedCompletedAppointments.length, completedAppointments.length),
      onTimePct: pct(onTimeAppointments, completedAppointments.length),
      blockerHours: round(blockerMinutes / 60, 1),
      blockedWorkOrders: blockedWorkedIds.size,
      blockerOrderRatePct: pct(blockedWorkedIds.size, workedWorkOrderIds.size),
      qcFirstPassPct: pct(firstPassRows.length, terminalQcRows.length),
      qcCoveragePct: pct(terminalQcRows.length, workedWorkOrderIds.size),
    },
    mechanics,
    cases,
    semantics: {
      efficiency: "Нормогодини завершених робіт / фактичний elapsed-time тих самих робіт із startedAt+completedAt.",
      assignedTimeUse: "Фактичний час appointment / запланований час призначених appointment. Це не повна зайнятість зміни без графіка персоналу.",
      blockerRate: "Частка виконаних Work Order механіка, які мали операційний blocker у періоді. Не є показником вини механіка.",
      firstPassQc: "Частка Work Order, де перша завершена QC-спроба має статус PASSED.",
    },
  };
}
