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
  "WAITING_PARTS", "READY_FOR_REPAIR", "IN_REPAIR", "WAITING_QC", "READY_FOR_PICKUP", "COMPLETED", "WARRANTY", "PAUSED",
]);

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
  const value = new Intl.DateTimeFormat("en-US", { timeZone: KYIV_TZ, timeZoneName: "shortOffset", hour: "2-digit" }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value;
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
    return NextResponse.json({ ok: true, range: { from, to, timezone: KYIV_TZ }, locations: [], selectedLocationId: null, emptyScope: true }, { headers: { "Cache-Control": "no-store" } });
  }

  const appointmentLocationWhere = effectiveLocationIds ? { locationId: { in: effectiveLocationIds } } : {};
  const appointments = await prisma.serviceAppointment.findMany({
    where: {
      ...appointmentLocationWhere,
      plannedStartAt: { gte: from, lt: to },
      NOT: { id: { startsWith: "demo_" } },
      status: { notIn: ["CANCELLED", "RESERVE"] },
    },
    select: {
      id: true, leadId: true, workOrderId: true, mechanicId: true, status: true,
      plannedStartAt: true, plannedEndAt: true, actualArrivalAt: true, actualStartAt: true, actualEndAt: true,
    },
  });

  const scheduledCount = appointments.length;
  const arrivedCount = appointments.filter((row) => Boolean(row.actualArrivalAt) || ARRIVED_STATUSES.has(row.status)).length;
  const noShowCount = appointments.filter((row) => row.status === "NO_SHOW").length;
  const workOrderLinkedCount = new Set(appointments.map((row) => row.workOrderId).filter(Boolean)).size;

  let leadFunnel: null | { leads: number; booked: number; conversionPct: number } = null;
  const canShowGlobalLeadFunnel = analyticsScope === "ALL" && !selectedLocationId;
  if (canShowGlobalLeadFunnel) {
    const leads = await prisma.lead.findMany({
      where: { createdAt: { gte: from, lt: to }, NOT: { id: { startsWith: "demo_" } } },
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
    leadFunnel = { leads: leads.length, booked, conversionPct: pct(booked, leads.length) };
  }

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
  const closedWorkOrders = scopedWorkOrderIds?.length === 0 ? [] : await prisma.workOrder.findMany({
    where: {
      ...workOrderScopeWhere,
      status: "CLOSED",
      closedAt: { gte: from, lt: to },
      NOT: { id: { startsWith: "demo_" } },
    },
    select: { id: true, clientId: true, closedAt: true },
  });
  const closedIds = closedWorkOrders.map((row) => row.id);

  const financeRows = canFinancial && closedIds.length
    ? await prisma.workOrderFinanceSnapshot.findMany({
        where: { workOrderId: { in: closedIds }, kind: "ACTUAL", NOT: { workOrderId: { startsWith: "demo_" } } },
        select: { workOrderId: true, grossRevenue: true, grossProfit: true },
      })
    : [];
  const financeByWorkOrder = new Map(financeRows.map((row) => [row.workOrderId, row]));
  const grossRevenue = financeRows.reduce((sum, row) => sum + numberOf(row.grossRevenue), 0);
  const grossProfit = financeRows.reduce((sum, row) => sum + numberOf(row.grossProfit), 0);
  const averageCheck = financeRows.length ? round(grossRevenue / financeRows.length) : 0;
  const grossMarginPct = grossRevenue > 0 ? round((grossProfit / grossRevenue) * 100, 1) : 0;

  const servedClientIds = [...new Set(closedWorkOrders.map((row) => row.clientId))];
  let returningClientIds = new Set<string>();
  if (servedClientIds.length) {
    const priorWhere = scopedWorkOrderIds
      ? { id: { in: scopedWorkOrderIds } }
      : {};
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
  const posts = await prisma.servicePost.findMany({
    where: { isActive: true, ...(effectiveLocationIds ? { locationId: { in: effectiveLocationIds } } : {}) },
    select: { id: true, locationId: true },
  });
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY_MS));
  const capacityMinutes = locationsForCapacity.reduce((sum, location) => {
    const postCount = posts.filter((post) => post.locationId === location.id).length;
    return sum + Math.max(0, location.closeMinute - location.openMinute) * postCount * days;
  }, 0);
  const bookedMinutes = appointments.reduce((sum, row) => {
    const duration = Math.max(0, row.plannedEndAt.getTime() - row.plannedStartAt.getTime()) / 60_000;
    return sum + duration;
  }, 0);

  let mechanics: Array<{
    mechanicId: string; name: string; completedJobs: number; workOrders: number; normHours: number; actualHours: number; efficiencyPct: number | null;
  }> = [];
  if (canPersonnel) {
    const lineScopeWhere = scopedWorkOrderIds ? { workOrderId: { in: scopedWorkOrderIds } } : {};
    const laborLines = scopedWorkOrderIds?.length === 0 ? [] : await prisma.workOrderLine.findMany({
      where: {
        ...lineScopeWhere,
        type: "LABOR", status: "COMPLETED", completedAt: { gte: from, lt: to }, mechanicId: { not: null },
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
      const hours = Math.max(0, appointment.actualEndAt.getTime() - appointment.actualStartAt.getTime()) / 3_600_000;
      actualByMechanic.set(appointment.mechanicId, (actualByMechanic.get(appointment.mechanicId) || 0) + hours);
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
    date, closed: row.closed, revenue: canFinancial ? round(row.revenue) : null, grossProfit: canFinancial ? round(row.grossProfit) : null,
  }));

  return NextResponse.json({
    ok: true,
    range: { from, to, timezone: KYIV_TZ, days },
    scope: { analyticsScope, selectedLocationId, locationIds: effectiveLocationIds },
    locations: allowedLocations.map((location) => ({ id: location.id, name: location.name })),
    permissions: { financial: canFinancial, personnel: canPersonnel },
    kpi: {
      bookingToArrivalPct: pct(arrivedCount, scheduledCount),
      averageCheck: canFinancial ? averageCheck : null,
      grossMarginPct: canFinancial ? grossMarginPct : null,
      postUtilizationPct: pct(bookedMinutes, capacityMinutes),
      repeatClientPct: pct(returningClientIds.size, servedClientIds.length),
      closedWorkOrders: closedWorkOrders.length,
    },
    funnel: {
      lead: leadFunnel,
      scheduled: scheduledCount,
      arrived: arrivedCount,
      noShow: noShowCount,
      workOrderLinked: workOrderLinkedCount,
      bookingToArrivalPct: pct(arrivedCount, scheduledCount),
      bookingToWorkOrderPct: pct(workOrderLinkedCount, scheduledCount),
    },
    finance: canFinancial ? {
      grossRevenue: round(grossRevenue), grossProfit: round(grossProfit), grossMarginPct, averageCheck, finalizedOrders: financeRows.length,
    } : null,
    utilization: {
      bookedMinutes: round(bookedMinutes), capacityMinutes: round(capacityMinutes), utilizationPct: pct(bookedMinutes, capacityMinutes), activePosts: posts.length,
    },
    retention: {
      servedClients: servedClientIds.length, returningClients: returningClientIds.size, repeatClientPct: pct(returningClientIds.size, servedClientIds.length),
    },
    mechanics,
    trend,
  }, { headers: { "Cache-Control": "no-store" } });
}
