import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext, hasPermission } from "@/src/security/access-context";
import { PERMISSIONS, type AccessScopeCode } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const KYIV_TZ = "Europe/Kyiv";
const DAY_MS = 86_400_000;

const ARRIVED_STATUSES = new Set([
  "ARRIVED", "DIAGNOSTICS", "WAITING_PARTS_SELECTION", "WAITING_CALCULATION", "WAITING_APPROVAL",
  "WAITING_PARTS", "READY_FOR_REPAIR", "IN_REPAIR", "WAITING_QC", "WAITING_PAYMENT", "READY_FOR_PICKUP",
  "COMPLETED", "WARRANTY", "PAUSED",
]);
const DIAGNOSTIC_REACHED_STATUSES = new Set([
  "DIAGNOSTICS", "WAITING_PARTS_SELECTION", "WAITING_CALCULATION", "WAITING_APPROVAL", "WAITING_PARTS",
  "READY_FOR_REPAIR", "IN_REPAIR", "WAITING_QC", "WAITING_PAYMENT", "READY_FOR_PICKUP", "COMPLETED", "WARRANTY", "PAUSED",
]);
const REPAIR_REACHED_STATUSES = new Set([
  "READY_FOR_REPAIR", "IN_REPAIR", "WAITING_QC", "WAITING_PAYMENT", "READY_FOR_PICKUP", "COMPLETED", "WARRANTY",
]);
const ACTIVE_OPERATION_STATUSES = [
  "ARRIVED", "DIAGNOSTICS", "WAITING_PARTS_SELECTION", "WAITING_CALCULATION", "WAITING_APPROVAL", "WAITING_PARTS",
  "READY_FOR_REPAIR", "IN_REPAIR", "WAITING_QC", "WAITING_PAYMENT", "READY_FOR_PICKUP", "WARRANTY", "PAUSED",
] as const;

function round(value: number, digits = 2) {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}
function numberOf(value: unknown) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}
function pct(part: number, total: number) {
  return total > 0 ? round((part / total) * 100, 1) : 0;
}
function kyivParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: KYIV_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value),
  };
}
function kyivOffsetMinutes(date: Date) {
  const value = new Intl.DateTimeFormat("en-US", { timeZone: KYIV_TZ, timeZoneName: "shortOffset", hour: "2-digit" })
    .formatToParts(date).find((part) => part.type === "timeZoneName")?.value;
  const match = value?.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 180;
  const minutes = Number(match[2]) * 60 + Number(match[3] || 0);
  return match[1] === "+" ? minutes : -minutes;
}
function kyivDateStartUtc(year: number, month: number, day: number) {
  const probe = new Date(Date.UTC(year, month - 1, day, 12));
  const offset = kyivOffsetMinutes(probe);
  return new Date(Date.UTC(year, month - 1, day, 0, -offset));
}
function parseKyivDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return kyivDateStartUtc(year, month, day);
}
function addKyivDay(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1, 12));
  const parts = kyivParts(next);
  return kyivDateStartUtc(parts.year, parts.month, parts.day);
}
function currentMonthRange() {
  const now = kyivParts();
  const nextYear = now.month === 12 ? now.year + 1 : now.year;
  const nextMonth = now.month === 12 ? 1 : now.month + 1;
  return { from: kyivDateStartUtc(now.year, now.month, 1), to: kyivDateStartUtc(nextYear, nextMonth, 1) };
}
function dayKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: KYIV_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function minutesBetween(start: Date, end: Date) {
  return Math.max(0, end.getTime() - start.getTime()) / 60_000;
}
function periodDeltaStart(from: Date, to: Date) {
  return new Date(from.getTime() - Math.max(DAY_MS, to.getTime() - from.getTime()));
}
function compactStatus(status: string) {
  const labels: Record<string, string> = {
    ARRIVED: "Прийнято",
    DIAGNOSTICS: "Діагностика",
    WAITING_PARTS_SELECTION: "Підбір запчастин",
    WAITING_CALCULATION: "Калькуляція",
    WAITING_APPROVAL: "Очікує погодження",
    WAITING_PARTS: "Очікує запчастини",
    READY_FOR_REPAIR: "Готово до ремонту",
    IN_REPAIR: "У ремонті",
    WAITING_QC: "Контроль якості",
    WAITING_PAYMENT: "Очікує оплату",
    READY_FOR_PICKUP: "Готово до видачі",
    WARRANTY: "Гарантія",
    PAUSED: "Пауза",
  };
  return labels[status] || status;
}

export async function GET(request: NextRequest) {
  const context = await getAccessContext(request);
  if (context.enforcementMode === "ENFORCED" && context.provisioningState !== "ACTIVE") {
    return NextResponse.json({ ok: false, error: context.authenticated ? "Доступ до CRM не активований." : "Потрібна авторизація." }, { status: context.authenticated ? 403 : 401 });
  }
  if (context.enforcementMode === "ENFORCED" && !hasPermission(context, PERMISSIONS.ANALYTICS_READ)) {
    return NextResponse.json({ ok: false, error: "Немає доступу до аналітики." }, { status: 403 });
  }

  const prisma = getPrisma();
  const defaults = currentMonthRange();
  const from = parseKyivDate(request.nextUrl.searchParams.get("from")) ?? defaults.from;
  const to = addKyivDay(request.nextUrl.searchParams.get("to")) ?? defaults.to;
  if (from >= to) return NextResponse.json({ ok: false, error: "INVALID_DATE_RANGE" }, { status: 400 });

  const previousFrom = periodDeltaStart(from, to);
  const previousTo = from;
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY_MS));
  const previousDays = Math.max(1, Math.round((previousTo.getTime() - previousFrom.getTime()) / DAY_MS));

  const analyticsScope = context.enforcementMode === "ENFORCED"
    ? (context.permissions[PERMISSIONS.ANALYTICS_READ] as AccessScopeCode | undefined)
    : "ALL";
  const canFinancial = context.enforcementMode !== "ENFORCED" || hasPermission(context, PERMISSIONS.ANALYTICS_FINANCIAL_READ);
  const canPersonnel = context.enforcementMode !== "ENFORCED" || hasPermission(context, PERMISSIONS.ANALYTICS_PERSONNEL_READ);

  const allLocations = await prisma.serviceLocation.findMany({
    where: { isActive: true },
    select: { id: true, name: true, openMinute: true, closeMinute: true, timezone: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const allowedLocations = analyticsScope === "ALL" || context.enforcementMode !== "ENFORCED"
    ? allLocations
    : allLocations.filter((location) => context.locationIds.includes(location.id));
  const requestedLocationId = request.nextUrl.searchParams.get("locationId")?.trim() || null;
  const selectedLocationId = requestedLocationId && allowedLocations.some((location) => location.id === requestedLocationId)
    ? requestedLocationId
    : null;
  const effectiveLocationIds = selectedLocationId
    ? [selectedLocationId]
    : analyticsScope === "ALL" || context.enforcementMode !== "ENFORCED"
      ? null
      : allowedLocations.map((location) => location.id);

  if (effectiveLocationIds && effectiveLocationIds.length === 0) {
    return NextResponse.json({
      ok: true,
      range: { from: dayKey(from), to: dayKey(new Date(to.getTime() - 1)), timezone: KYIV_TZ, days },
      locations: [],
      selectedLocationId: null,
      emptyScope: true,
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const locationWhere = effectiveLocationIds ? { locationId: { in: effectiveLocationIds } } : {};
  const appointmentSelect = {
    id: true,
    locationId: true,
    postId: true,
    mechanicId: true,
    leadId: true,
    clientId: true,
    vehicleId: true,
    workOrderId: true,
    status: true,
    customerName: true,
    vehicleLabel: true,
    plateNumber: true,
    plannedStartAt: true,
    plannedEndAt: true,
    actualArrivalAt: true,
    actualStartAt: true,
    actualEndAt: true,
  } as const;

  const [appointments, previousAppointments, posts, liveAppointments] = await Promise.all([
    prisma.serviceAppointment.findMany({
      where: {
        ...locationWhere,
        plannedStartAt: { gte: from, lt: to },
        NOT: { id: { startsWith: "demo_" } },
        status: { notIn: ["CANCELLED", "RESERVE"] },
      },
      select: appointmentSelect,
    }),
    prisma.serviceAppointment.findMany({
      where: {
        ...locationWhere,
        plannedStartAt: { gte: previousFrom, lt: previousTo },
        NOT: { id: { startsWith: "demo_" } },
        status: { notIn: ["CANCELLED", "RESERVE"] },
      },
      select: appointmentSelect,
    }),
    prisma.servicePost.findMany({
      where: { isActive: true, ...(effectiveLocationIds ? { locationId: { in: effectiveLocationIds } } : {}) },
      select: { id: true, locationId: true, name: true, sortOrder: true },
      orderBy: [{ locationId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.serviceAppointment.findMany({
      where: {
        ...locationWhere,
        status: { in: [...ACTIVE_OPERATION_STATUSES] },
        NOT: { id: { startsWith: "demo_" } },
      },
      select: appointmentSelect,
      orderBy: { plannedEndAt: "asc" },
      take: 250,
    }),
  ]);

  const scheduledCount = appointments.length;
  const arrivedCount = appointments.filter((row) => Boolean(row.actualArrivalAt) || ARRIVED_STATUSES.has(row.status)).length;
  const diagnosticReachedCount = appointments.filter((row) => DIAGNOSTIC_REACHED_STATUSES.has(row.status) || Boolean(row.workOrderId)).length;
  const workOrderLinkedCount = new Set(appointments.map((row) => row.workOrderId).filter(Boolean)).size;
  const repairReachedCount = appointments.filter((row) => REPAIR_REACHED_STATUSES.has(row.status)).length;
  const completedCount = appointments.filter((row) => row.status === "COMPLETED" || Boolean(row.actualEndAt)).length;
  const noShowCount = appointments.filter((row) => row.status === "NO_SHOW").length;

  const previousScheduledCount = previousAppointments.length;
  const previousArrivedCount = previousAppointments.filter((row) => Boolean(row.actualArrivalAt) || ARRIVED_STATUSES.has(row.status)).length;
  const previousCompletedCount = previousAppointments.filter((row) => row.status === "COMPLETED" || Boolean(row.actualEndAt)).length;

  async function leadFunnelFor(start: Date, end: Date) {
    const leads = await prisma.lead.findMany({
      where: { createdAt: { gte: start, lt: end }, NOT: { id: { startsWith: "demo_" } } },
      select: { id: true },
    });
    const leadIds = leads.map((row) => row.id);
    const bookedRows = leadIds.length
      ? await prisma.serviceAppointment.findMany({
          where: { leadId: { in: leadIds }, status: { notIn: ["CANCELLED", "RESERVE"] }, NOT: { id: { startsWith: "demo_" } } },
          select: { leadId: true },
          distinct: ["leadId"],
        })
      : [];
    const booked = bookedRows.filter((row) => row.leadId).length;
    return { leads: leads.length, booked, conversionPct: pct(booked, leads.length) };
  }

  const canShowGlobalLeadFunnel = analyticsScope === "ALL" && !selectedLocationId;
  const [leadFunnel, previousLeadFunnel] = canShowGlobalLeadFunnel
    ? await Promise.all([leadFunnelFor(from, to), leadFunnelFor(previousFrom, previousTo)])
    : [null, null];

  let scopedWorkOrderIds: string[] | null = null;
  if (effectiveLocationIds) {
    const scopedRows = await prisma.serviceAppointment.findMany({
      where: { locationId: { in: effectiveLocationIds }, workOrderId: { not: null }, NOT: { id: { startsWith: "demo_" } } },
      select: { workOrderId: true },
      distinct: ["workOrderId"],
    });
    scopedWorkOrderIds = scopedRows.map((row) => row.workOrderId).filter((id): id is string => Boolean(id));
  }
  const workOrderScopeWhere = scopedWorkOrderIds ? { id: { in: scopedWorkOrderIds } } : {};

  async function closedOrdersFor(start: Date, end: Date) {
    if (scopedWorkOrderIds?.length === 0) return [];
    return prisma.workOrder.findMany({
      where: {
        ...workOrderScopeWhere,
        status: "CLOSED",
        closedAt: { gte: start, lt: end },
        NOT: { id: { startsWith: "demo_" } },
      },
      select: { id: true, clientId: true, closedAt: true },
    });
  }

  const [closedWorkOrders, previousClosedWorkOrders] = await Promise.all([
    closedOrdersFor(from, to),
    closedOrdersFor(previousFrom, previousTo),
  ]);
  const closedIds = closedWorkOrders.map((row) => row.id);
  const previousClosedIds = previousClosedWorkOrders.map((row) => row.id);

  const [financeRows, previousFinanceRows] = canFinancial
    ? await Promise.all([
        closedIds.length
          ? prisma.workOrderFinanceSnapshot.findMany({
              where: { workOrderId: { in: closedIds }, kind: "ACTUAL", NOT: { workOrderId: { startsWith: "demo_" } } },
              select: { workOrderId: true, grossRevenue: true, grossProfit: true },
            })
          : Promise.resolve([]),
        previousClosedIds.length
          ? prisma.workOrderFinanceSnapshot.findMany({
              where: { workOrderId: { in: previousClosedIds }, kind: "ACTUAL", NOT: { workOrderId: { startsWith: "demo_" } } },
              select: { workOrderId: true, grossRevenue: true, grossProfit: true },
            })
          : Promise.resolve([]),
      ])
    : [[], []];

  const financeByWorkOrder = new Map(financeRows.map((row) => [row.workOrderId, row]));
  const grossRevenue = financeRows.reduce((sum, row) => sum + numberOf(row.grossRevenue), 0);
  const grossProfit = financeRows.reduce((sum, row) => sum + numberOf(row.grossProfit), 0);
  const averageCheck = financeRows.length ? round(grossRevenue / financeRows.length) : 0;
  const grossMarginPct = grossRevenue > 0 ? round((grossProfit / grossRevenue) * 100, 1) : 0;

  const previousGrossRevenue = previousFinanceRows.reduce((sum, row) => sum + numberOf(row.grossRevenue), 0);
  const previousGrossProfit = previousFinanceRows.reduce((sum, row) => sum + numberOf(row.grossProfit), 0);
  const previousAverageCheck = previousFinanceRows.length ? round(previousGrossRevenue / previousFinanceRows.length) : 0;
  const previousGrossMarginPct = previousGrossRevenue > 0 ? round((previousGrossProfit / previousGrossRevenue) * 100, 1) : 0;

  const servedClientIds = [...new Set(closedWorkOrders.map((row) => row.clientId))];
  let returningClientIds = new Set<string>();
  if (servedClientIds.length) {
    const priorWhere = scopedWorkOrderIds ? { id: { in: scopedWorkOrderIds } } : {};
    const priorRows = await prisma.workOrder.findMany({
      where: {
        ...priorWhere,
        clientId: { in: servedClientIds }, status: "CLOSED", closedAt: { lt: from },
        NOT: { id: { startsWith: "demo_" } },
      },
      select: { clientId: true },
      distinct: ["clientId"],
    });
    returningClientIds = new Set(priorRows.map((row) => row.clientId));
  }

  const locationsForCapacity = effectiveLocationIds
    ? allowedLocations.filter((location) => effectiveLocationIds.includes(location.id))
    : allowedLocations;
  const locationById = new Map(locationsForCapacity.map((location) => [location.id, location]));
  const capacityMinutes = posts.reduce((sum, post) => {
    const location = locationById.get(post.locationId);
    return sum + (location ? Math.max(0, location.closeMinute - location.openMinute) * days : 0);
  }, 0);
  const previousCapacityMinutes = posts.reduce((sum, post) => {
    const location = locationById.get(post.locationId);
    return sum + (location ? Math.max(0, location.closeMinute - location.openMinute) * previousDays : 0);
  }, 0);
  const bookedMinutes = appointments.reduce((sum, row) => sum + minutesBetween(row.plannedStartAt, row.plannedEndAt), 0);
  const previousBookedMinutes = previousAppointments.reduce((sum, row) => sum + minutesBetween(row.plannedStartAt, row.plannedEndAt), 0);

  const postUtilization = posts.map((post) => {
    const location = locationById.get(post.locationId);
    const postCapacityMinutes = location ? Math.max(0, location.closeMinute - location.openMinute) * days : 0;
    const rows = appointments.filter((row) => row.postId === post.id);
    const usedMinutes = rows.reduce((sum, row) => sum + minutesBetween(row.plannedStartAt, row.plannedEndAt), 0);
    return {
      postId: post.id,
      name: post.name,
      locationId: post.locationId,
      locationName: location?.name || "СТО",
      appointments: rows.length,
      bookedMinutes: round(usedMinutes),
      capacityMinutes: round(postCapacityMinutes),
      utilizationPct: pct(usedMinutes, postCapacityMinutes),
    };
  }).sort((a, b) => b.utilizationPct - a.utilizationPct || a.name.localeCompare(b.name, "uk"));

  let mechanics: Array<{
    mechanicId: string;
    name: string;
    completedJobs: number;
    workOrders: number;
    normHours: number;
    actualHours: number;
    efficiencyPct: number | null;
  }> = [];
  if (canPersonnel) {
    const lineScopeWhere = scopedWorkOrderIds ? { workOrderId: { in: scopedWorkOrderIds } } : {};
    const laborLines = scopedWorkOrderIds?.length === 0 ? [] : await prisma.workOrderLine.findMany({
      where: {
        ...lineScopeWhere,
        type: "LABOR",
        status: "COMPLETED",
        completedAt: { gte: from, lt: to },
        mechanicId: { not: null },
        NOT: { workOrderId: { startsWith: "demo_" } },
      },
      select: { mechanicId: true, workOrderId: true, laborHours: true },
    });
    const mechanicIds = [...new Set(laborLines.map((row) => row.mechanicId).filter((id): id is string => Boolean(id)))];
    const mechanicRows = mechanicIds.length
      ? await prisma.serviceMechanic.findMany({ where: { id: { in: mechanicIds } }, select: { id: true, name: true } })
      : [];
    const actualByMechanic = new Map<string, number>();
    for (const appointment of appointments) {
      if (!appointment.mechanicId || !appointment.actualStartAt || !appointment.actualEndAt) continue;
      const value = minutesBetween(appointment.actualStartAt, appointment.actualEndAt) / 60;
      actualByMechanic.set(appointment.mechanicId, (actualByMechanic.get(appointment.mechanicId) || 0) + value);
    }
    const grouped = new Map<string, { completedJobs: number; workOrders: Set<string>; normHours: number }>();
    for (const line of laborLines) {
      if (!line.mechanicId) continue;
      const current = grouped.get(line.mechanicId) || { completedJobs: 0, workOrders: new Set<string>(), normHours: 0 };
      current.completedJobs += 1;
      current.workOrders.add(line.workOrderId);
      current.normHours += numberOf(line.laborHours);
      grouped.set(line.mechanicId, current);
    }
    const nameById = new Map(mechanicRows.map((row) => [row.id, row.name]));
    mechanics = [...grouped.entries()].map(([mechanicId, value]) => {
      const actualHours = round(actualByMechanic.get(mechanicId) || 0, 1);
      const normHours = round(value.normHours, 1);
      return {
        mechanicId,
        name: nameById.get(mechanicId) || "Механік",
        completedJobs: value.completedJobs,
        workOrders: value.workOrders.size,
        normHours,
        actualHours,
        efficiencyPct: actualHours > 0 ? round((normHours / actualHours) * 100, 1) : null,
      };
    }).sort((a, b) => b.normHours - a.normHours || b.completedJobs - a.completedJobs);
  }

  const trendMap = new Map<string, { closed: number; revenue: number; grossProfit: number }>();
  for (const workOrder of closedWorkOrders) {
    if (!workOrder.closedAt) continue;
    const key = dayKey(workOrder.closedAt);
    const current = trendMap.get(key) || { closed: 0, revenue: 0, grossProfit: 0 };
    current.closed += 1;
    const snapshot = financeByWorkOrder.get(workOrder.id);
    if (snapshot) {
      current.revenue += numberOf(snapshot.grossRevenue);
      current.grossProfit += numberOf(snapshot.grossProfit);
    }
    trendMap.set(key, current);
  }
  const trend = [...trendMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, row]) => ({
    date,
    closed: row.closed,
    revenue: canFinancial ? round(row.revenue) : null,
    grossProfit: canFinancial ? round(row.grossProfit) : null,
  }));

  const now = new Date();
  const overdueAppointments = liveAppointments.filter((row) => row.plannedEndAt < now);
  const waitingPartsNow = liveAppointments.filter((row) => row.status === "WAITING_PARTS" || row.status === "WAITING_PARTS_SELECTION").length;
  const waitingApprovalNow = liveAppointments.filter((row) => row.status === "WAITING_APPROVAL" || row.status === "WAITING_CALCULATION").length;
  const inRepairNow = liveAppointments.filter((row) => row.status === "IN_REPAIR").length;
  const readyNow = liveAppointments.filter((row) => row.status === "READY_FOR_PICKUP").length;

  const completedWithTiming = appointments.filter((row) => row.actualEndAt);
  const onTimeCompleted = completedWithTiming.filter((row) => row.actualEndAt && row.actualEndAt <= row.plannedEndAt).length;
  const cycles = appointments.flatMap((row) => row.actualArrivalAt && row.actualEndAt ? [minutesBetween(row.actualArrivalAt, row.actualEndAt)] : []);
  const averageCycleMinutes = cycles.length ? round(cycles.reduce((sum, value) => sum + value, 0) / cycles.length) : 0;

  const delayReasons = [
    {
      code: "PARTS",
      label: "Запчастини",
      count: overdueAppointments.filter((row) => row.status === "WAITING_PARTS" || row.status === "WAITING_PARTS_SELECTION").length,
    },
    {
      code: "APPROVAL",
      label: "Погодження / калькуляція",
      count: overdueAppointments.filter((row) => row.status === "WAITING_APPROVAL" || row.status === "WAITING_CALCULATION").length,
    },
    {
      code: "NO_MECHANIC",
      label: "Не призначено механіка",
      count: overdueAppointments.filter((row) => !row.mechanicId).length,
    },
    {
      code: "PAUSED",
      label: "Пауза",
      count: overdueAppointments.filter((row) => row.status === "PAUSED").length,
    },
    {
      code: "OTHER",
      label: "Робота / інше",
      count: overdueAppointments.filter((row) => ![
        "WAITING_PARTS", "WAITING_PARTS_SELECTION", "WAITING_APPROVAL", "WAITING_CALCULATION", "PAUSED",
      ].includes(row.status) && Boolean(row.mechanicId)).length,
    },
  ].filter((row) => row.count > 0).sort((a, b) => b.count - a.count);

  const statusMap = new Map<string, number>();
  for (const row of liveAppointments) statusMap.set(row.status, (statusMap.get(row.status) || 0) + 1);
  const liveStatusBreakdown = [...statusMap.entries()]
    .map(([status, count]) => ({ status, label: compactStatus(status), count }))
    .sort((a, b) => b.count - a.count);

  const overdue = overdueAppointments.slice(0, 40).map((row) => ({
    appointmentId: row.id,
    customerName: row.customerName || "Клієнт",
    vehicleLabel: row.vehicleLabel || "Автомобіль",
    plateNumber: row.plateNumber || null,
    status: row.status,
    statusLabel: compactStatus(row.status),
    plannedStartAt: row.plannedStartAt,
    plannedEndAt: row.plannedEndAt,
    delayMinutes: round(minutesBetween(row.plannedEndAt, now)),
  }));

  return NextResponse.json({
    ok: true,
    range: {
      from: dayKey(from),
      to: dayKey(new Date(to.getTime() - 1)),
      timezone: KYIV_TZ,
      days,
      previousFrom: dayKey(previousFrom),
      previousTo: dayKey(new Date(previousTo.getTime() - 1)),
    },
    scope: { analyticsScope, selectedLocationId, locationIds: effectiveLocationIds },
    locations: allowedLocations.map((location) => ({ id: location.id, name: location.name })),
    permissions: { financial: canFinancial, personnel: canPersonnel },
    kpi: {
      grossRevenue: canFinancial ? round(grossRevenue) : null,
      grossProfit: canFinancial ? round(grossProfit) : null,
      bookingToArrivalPct: pct(arrivedCount, scheduledCount),
      averageCheck: canFinancial ? averageCheck : null,
      grossMarginPct: canFinancial ? grossMarginPct : null,
      postUtilizationPct: pct(bookedMinutes, capacityMinutes),
      repeatClientPct: pct(returningClientIds.size, servedClientIds.length),
      closedWorkOrders: closedWorkOrders.length,
      arrivedVehicles: arrivedCount,
      completedVehicles: completedCount,
      activeNow: liveAppointments.length,
      readyNow,
      overdueNow: overdueAppointments.length,
    },
    previous: {
      grossRevenue: canFinancial ? round(previousGrossRevenue) : null,
      grossProfit: canFinancial ? round(previousGrossProfit) : null,
      averageCheck: canFinancial ? previousAverageCheck : null,
      grossMarginPct: canFinancial ? previousGrossMarginPct : null,
      bookingToArrivalPct: pct(previousArrivedCount, previousScheduledCount),
      postUtilizationPct: pct(previousBookedMinutes, previousCapacityMinutes),
      closedWorkOrders: previousClosedWorkOrders.length,
      arrivedVehicles: previousArrivedCount,
      completedVehicles: previousCompletedCount,
      leads: previousLeadFunnel?.leads ?? null,
    },
    funnel: {
      lead: leadFunnel,
      scheduled: scheduledCount,
      arrived: arrivedCount,
      diagnosticsReached: diagnosticReachedCount,
      workOrderLinked: workOrderLinkedCount,
      repairReached: repairReachedCount,
      completed: completedCount,
      noShow: noShowCount,
      bookingToArrivalPct: pct(arrivedCount, scheduledCount),
      arrivalToDiagnosticsPct: pct(diagnosticReachedCount, arrivedCount),
      diagnosticsToWorkOrderPct: pct(workOrderLinkedCount, diagnosticReachedCount),
      workOrderToRepairPct: pct(repairReachedCount, workOrderLinkedCount),
      repairToCompletedPct: pct(completedCount, repairReachedCount),
      bookingToCompletedPct: pct(completedCount, scheduledCount),
    },
    finance: canFinancial ? {
      grossRevenue: round(grossRevenue),
      grossProfit: round(grossProfit),
      grossMarginPct,
      averageCheck,
      finalizedOrders: financeRows.length,
    } : null,
    utilization: {
      bookedMinutes: round(bookedMinutes),
      capacityMinutes: round(capacityMinutes),
      utilizationPct: pct(bookedMinutes, capacityMinutes),
      activePosts: posts.length,
      posts: postUtilization,
    },
    retention: {
      servedClients: servedClientIds.length,
      returningClients: returningClientIds.size,
      repeatClientPct: pct(returningClientIds.size, servedClientIds.length),
    },
    operations: {
      activeNow: liveAppointments.length,
      inRepairNow,
      waitingPartsNow,
      waitingApprovalNow,
      readyNow,
      overdueNow: overdueAppointments.length,
      averageCycleMinutes,
      onTimeCompletedPct: pct(onTimeCompleted, completedWithTiming.length),
      timedCompleted: completedWithTiming.length,
      liveStatusBreakdown,
      delayReasons,
      overdue,
    },
    mechanics,
    trend,
  }, { headers: { "Cache-Control": "no-store" } });
}
