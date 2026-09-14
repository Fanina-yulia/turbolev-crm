import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext, hasPermission } from "@/src/security/access-context";
import { PERMISSIONS, type AccessScopeCode } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const KYIV_TZ = "Europe/Kyiv";
const DAY_MS = 86_400_000;
const APPROVED_LINE_STATUSES = new Set(["APPROVED", "IN_PROGRESS", "COMPLETED"]);
const PIPELINE_EXCLUDED_STATUSES = new Set(["CANCELLED", "RESERVE", "NO_SHOW", "COMPLETED", "WAITING_PAYMENT"]);

function numberOf(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function kyivParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KYIV_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value),
  };
}

function kyivOffsetMinutes(date: Date) {
  const value = new Intl.DateTimeFormat("en-US", {
    timeZone: KYIV_TZ,
    timeZoneName: "shortOffset",
    hour: "2-digit",
  }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value;
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

function nextKyivDay(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1, 12));
  const parts = kyivParts(next);
  return kyivDateStartUtc(parts.year, parts.month, parts.day);
}

function dayKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: KYIV_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function lineAmount(line: {
  plannedQuantity: { toString(): string };
  plannedUnitPrice: { toString(): string };
  plannedDiscount: { toString(): string };
}) {
  return Math.max(
    0,
    numberOf(line.plannedQuantity.toString()) * numberOf(line.plannedUnitPrice.toString())
      - numberOf(line.plannedDiscount.toString()),
  );
}

export async function GET(request: NextRequest) {
  const context = await getAccessContext(request);
  if (context.enforcementMode === "ENFORCED" && context.provisioningState !== "ACTIVE") {
    return NextResponse.json({ ok: false, error: context.authenticated ? "Доступ до CRM не активований." : "Потрібна авторизація." }, { status: context.authenticated ? 403 : 401 });
  }
  if (context.enforcementMode === "ENFORCED" && (!hasPermission(context, PERMISSIONS.ANALYTICS_READ) || !hasPermission(context, PERMISSIONS.ANALYTICS_FINANCIAL_READ))) {
    return NextResponse.json({ ok: false, error: "Немає доступу до фінансової аналітики." }, { status: 403 });
  }

  const prisma = getPrisma();
  const today = kyivParts();
  const fallbackTo = kyivDateStartUtc(today.year, today.month, today.day + 1);
  const fallbackFrom = new Date(fallbackTo.getTime() - 30 * DAY_MS);
  const from = parseKyivDate(request.nextUrl.searchParams.get("from")) ?? fallbackFrom;
  const to = nextKyivDay(request.nextUrl.searchParams.get("to")) ?? fallbackTo;
  if (from >= to) return NextResponse.json({ ok: false, error: "INVALID_DATE_RANGE" }, { status: 400 });
  const previousFrom = new Date(from.getTime() - Math.max(DAY_MS, to.getTime() - from.getTime()));
  const previousTo = from;

  const analyticsScope = context.enforcementMode === "ENFORCED"
    ? (context.permissions[PERMISSIONS.ANALYTICS_READ] as AccessScopeCode | undefined)
    : "ALL";
  const scopedLocationIds = analyticsScope === "ALL" || context.enforcementMode !== "ENFORCED" ? null : context.locationIds;
  if (scopedLocationIds && scopedLocationIds.length === 0) {
    return NextResponse.json({ ok: true, pipeline: null, directRevenue: null, retention: null, dataQuality: null }, { headers: { "Cache-Control": "no-store" } });
  }
  const appointmentWhere = scopedLocationIds ? { locationId: { in: scopedLocationIds } } : {};
  const cashLocationWhere = scopedLocationIds ? { locationId: { in: scopedLocationIds } } : {};

  const [liveAppointments, scopedWorkOrderRows] = await Promise.all([
    prisma.serviceAppointment.findMany({
      where: {
        ...appointmentWhere,
        NOT: { id: { startsWith: "demo_" } },
        status: { notIn: ["CANCELLED", "RESERVE", "NO_SHOW", "COMPLETED"] },
      },
      select: { id: true, status: true, workOrderId: true, estimatedAmount: true, purpose: true },
      take: 1000,
    }),
    scopedLocationIds
      ? prisma.serviceAppointment.findMany({
          where: { ...appointmentWhere, workOrderId: { not: null }, NOT: { id: { startsWith: "demo_" } } },
          select: { workOrderId: true },
          distinct: ["workOrderId"],
        })
      : Promise.resolve([]),
  ]);

  const scopedWorkOrderIds = scopedLocationIds
    ? scopedWorkOrderRows.map((row) => row.workOrderId).filter((id): id is string => Boolean(id))
    : null;
  const openWorkOrders = scopedWorkOrderIds?.length === 0
    ? []
    : await prisma.workOrder.findMany({
        where: {
          status: { not: "CLOSED" },
          NOT: { id: { startsWith: "demo_" } },
          ...(scopedWorkOrderIds ? { id: { in: scopedWorkOrderIds } } : {}),
        },
        select: { id: true },
        take: 1000,
      });
  const openWorkOrderIds = openWorkOrders.map((row) => row.id);
  const lines = openWorkOrderIds.length
    ? await prisma.workOrderLine.findMany({
        where: { workOrderId: { in: openWorkOrderIds }, status: { not: "CANCELLED" } },
        select: {
          workOrderId: true,
          status: true,
          currency: true,
          plannedQuantity: true,
          plannedUnitPrice: true,
          plannedDiscount: true,
        },
      })
    : [];

  let scheduledAmount = 0;
  let diagnosticsAmount = 0;
  let scheduledCount = 0;
  let diagnosticsCount = 0;
  let unpricedPipelineCount = 0;
  let waitingPaymentUnpricedCount = 0;
  for (const appointment of liveAppointments) {
    const estimated = Math.max(0, numberOf(appointment.estimatedAmount));
    if (appointment.status === "WAITING_PAYMENT") {
      if (!appointment.workOrderId && estimated <= 0) waitingPaymentUnpricedCount += 1;
      continue;
    }
    if (appointment.workOrderId || PIPELINE_EXCLUDED_STATUSES.has(appointment.status)) continue;
    if (estimated <= 0) unpricedPipelineCount += 1;
    if (appointment.status === "BOOKED") {
      scheduledAmount += estimated;
      scheduledCount += 1;
    } else {
      diagnosticsAmount += estimated;
      diagnosticsCount += 1;
    }
  }

  let approvedAmount = 0;
  let approvedCount = 0;
  let pendingAmount = 0;
  let pendingCount = 0;
  const pricedCurrencies = new Set<string>();
  for (const line of lines) {
    const amount = lineAmount(line);
    if (amount > 0) pricedCurrencies.add(line.currency.toUpperCase());
    if (APPROVED_LINE_STATUSES.has(line.status)) {
      approvedAmount += amount;
      approvedCount += 1;
    } else if (line.status === "DRAFT") {
      pendingAmount += amount;
      pendingCount += 1;
    }
  }
  const mixedCurrency = [...pricedCurrencies].some((currency) => currency !== "UAH");
  const moneyInWorkTotal = mixedCurrency ? null : round(scheduledAmount + diagnosticsAmount + approvedAmount);

  const directRevenueWhere = {
    kind: "INFLOW" as const,
    status: "POSTED" as const,
    flowSection: "OPERATING" as const,
    workOrderId: null,
    clientId: { not: null },
    ...cashLocationWhere,
  };
  const [currentDirectRevenueRows, previousDirectRevenueRows] = await Promise.all([
    prisma.cashTransaction.findMany({
      where: { ...directRevenueWhere, occurredAt: { gte: from, lt: to } },
      select: { amount: true, occurredAt: true, clientId: true },
    }),
    prisma.cashTransaction.findMany({
      where: { ...directRevenueWhere, occurredAt: { gte: previousFrom, lt: previousTo } },
      select: { amount: true, occurredAt: true, clientId: true },
    }),
  ]);
  const directCurrent = currentDirectRevenueRows.reduce((sum, row) => sum + numberOf(row.amount), 0);
  const directPrevious = previousDirectRevenueRows.reduce((sum, row) => sum + numberOf(row.amount), 0);
  const directTrendMap = new Map<string, number>();
  for (const row of currentDirectRevenueRows) {
    const key = dayKey(row.occurredAt);
    directTrendMap.set(key, (directTrendMap.get(key) || 0) + numberOf(row.amount));
  }

  const workOrderScopeWhere = scopedWorkOrderIds ? { id: { in: scopedWorkOrderIds } } : {};
  const [periodClosedOrders, priorClosedClients, priorDirectClients] = await Promise.all([
    scopedWorkOrderIds?.length === 0
      ? Promise.resolve([])
      : prisma.workOrder.findMany({
          where: { ...workOrderScopeWhere, status: "CLOSED", closedAt: { gte: from, lt: to }, NOT: { id: { startsWith: "demo_" } } },
          select: { clientId: true },
        }),
    scopedWorkOrderIds?.length === 0
      ? Promise.resolve([])
      : prisma.workOrder.findMany({
          where: { ...workOrderScopeWhere, status: "CLOSED", closedAt: { lt: from }, NOT: { id: { startsWith: "demo_" } } },
          select: { clientId: true },
          distinct: ["clientId"],
        }),
    prisma.cashTransaction.findMany({
      where: { ...directRevenueWhere, occurredAt: { lt: from } },
      select: { clientId: true },
      distinct: ["clientId"],
    }),
  ]);
  const servedClients = new Set<string>();
  for (const row of periodClosedOrders) servedClients.add(row.clientId);
  for (const row of currentDirectRevenueRows) if (row.clientId) servedClients.add(row.clientId);
  const priorClients = new Set<string>();
  for (const row of priorClosedClients) priorClients.add(row.clientId);
  for (const row of priorDirectClients) if (row.clientId) priorClients.add(row.clientId);
  const returningClients = [...servedClients].filter((clientId) => priorClients.has(clientId)).length;

  return NextResponse.json({
    ok: true,
    range: { from: dayKey(from), to: dayKey(new Date(to.getTime() - 1)), previousFrom: dayKey(previousFrom), previousTo: dayKey(new Date(previousTo.getTime() - 1)) },
    pipeline: {
      currency: mixedCurrency ? null : "UAH",
      mixedCurrency,
      total: moneyInWorkTotal,
      scheduledAmount: round(scheduledAmount),
      scheduledCount,
      diagnosticsAmount: round(diagnosticsAmount),
      diagnosticsCount,
      approvedAmount: round(approvedAmount),
      approvedCount,
      pendingApprovalAmount: mixedCurrency ? null : round(pendingAmount),
      pendingApprovalCount: pendingCount,
      openWorkOrders: openWorkOrderIds.length,
      unpricedCount: unpricedPipelineCount,
    },
    directRevenue: {
      current: round(directCurrent),
      previous: round(directPrevious),
      count: currentDirectRevenueRows.length,
      averageCheck: currentDirectRevenueRows.length ? round(directCurrent / currentDirectRevenueRows.length) : null,
      trend: [...directTrendMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => ({ date, amount: round(amount) })),
    },
    retention: {
      servedClients: servedClients.size,
      returningClients,
      repeatClientPct: servedClients.size ? round((returningClients / servedClients.size) * 100, 1) : null,
    },
    dataQuality: {
      pipelineUnpricedCount: unpricedPipelineCount,
      waitingPaymentUnpricedCount,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
