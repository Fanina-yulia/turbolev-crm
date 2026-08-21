import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { calculatePnl, decimalToNumber, outstandingAmount, roundMoney } from "@/src/domain/finance";
import { getAccessContext, hasPermission } from "@/src/security/access-context";
import { PERMISSIONS, type AccessScopeCode } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const KYIV_TZ = "Europe/Kyiv";

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
  return {
    from: kyivDateStartUtc(now.year, now.month, 1),
    to: kyivDateStartUtc(nextYear, nextMonth, 1),
  };
}
function dayKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: KYIV_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
function sum<T>(rows: T[], getter: (row: T) => unknown) {
  return rows.reduce((total, row) => total + decimalToNumber(getter(row)), 0);
}

export async function GET(request: NextRequest) {
  try {
    const context = await getAccessContext(request);
    if (context.enforcementMode === "ENFORCED" && context.provisioningState !== "ACTIVE") {
      return NextResponse.json(
        { ok: false, error: context.authenticated ? "Доступ до CRM не активований." : "Потрібна авторизація." },
        { status: context.authenticated ? 403 : 401 },
      );
    }
    if (context.enforcementMode === "ENFORCED" && !hasPermission(context, PERMISSIONS.ANALYTICS_READ)) {
      return NextResponse.json({ ok: false, error: "Немає доступу до аналітики." }, { status: 403 });
    }
    const canFinancial = context.enforcementMode !== "ENFORCED" || hasPermission(context, PERMISSIONS.ANALYTICS_FINANCIAL_READ);
    if (!canFinancial) {
      return NextResponse.json({ ok: true, permitted: false, finance: null }, { headers: { "Cache-Control": "no-store" } });
    }

    const defaults = currentMonthRange();
    const from = parseKyivDate(request.nextUrl.searchParams.get("from")) ?? defaults.from;
    const to = addKyivDay(request.nextUrl.searchParams.get("to")) ?? defaults.to;
    if (from >= to) return NextResponse.json({ ok: false, error: "INVALID_DATE_RANGE" }, { status: 400 });

    const prisma = getPrisma();
    const analyticsScope = context.enforcementMode === "ENFORCED"
      ? (context.permissions[PERMISSIONS.ANALYTICS_READ] as AccessScopeCode | undefined)
      : "ALL";
    const allLocations = await prisma.serviceLocation.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
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
      return NextResponse.json({ ok: true, permitted: true, emptyScope: true, finance: null }, { headers: { "Cache-Control": "no-store" } });
    }

    const locationWhere = effectiveLocationIds ? { locationId: { in: effectiveLocationIds } } : {};
    const nonDemoWorkOrder = { OR: [{ workOrderId: null }, { NOT: { workOrderId: { startsWith: "demo_" } } }] };

    const [pnlGroups, cashGroups, accounts, obligations, eventCount, cashCount] = await Promise.all([
      prisma.financialEvent.groupBy({
        by: ["pnlSection"],
        where: {
          status: "POSTED",
          currency: "UAH",
          recognizedAt: { gte: from, lt: to },
          ...locationWhere,
          ...nonDemoWorkOrder,
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.cashTransaction.groupBy({
        by: ["kind", "flowSection"],
        where: {
          status: "POSTED",
          currency: "UAH",
          occurredAt: { gte: from, lt: to },
          ...locationWhere,
          ...nonDemoWorkOrder,
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.moneyAccount.findMany({
        where: {
          isActive: true,
          currency: "UAH",
          ...(effectiveLocationIds ? { locationId: { in: effectiveLocationIds } } : {}),
          NOT: { id: { startsWith: "demo_" } },
        },
        select: { id: true, name: true, type: true, openingBalance: true, locationId: true, sortOrder: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
      prisma.financialObligation.findMany({
        where: {
          status: { in: ["OPEN", "PARTIALLY_PAID", "OVERDUE"] },
          currency: "UAH",
          ...locationWhere,
          ...nonDemoWorkOrder,
        },
        select: { direction: true, amount: true, settledAmount: true, dueAt: true, status: true },
      }),
      prisma.financialEvent.count({
        where: {
          status: "POSTED",
          currency: "UAH",
          recognizedAt: { gte: from, lt: to },
          ...locationWhere,
          ...nonDemoWorkOrder,
        },
      }),
      prisma.cashTransaction.count({
        where: {
          status: "POSTED",
          currency: "UAH",
          occurredAt: { gte: from, lt: to },
          ...locationWhere,
          ...nonDemoWorkOrder,
        },
      }),
    ]);

    const pnlBySection = Object.fromEntries(pnlGroups.map((row) => [row.pnlSection, decimalToNumber(row._sum.amount)]));
    const pnl = calculatePnl({
      revenue: pnlBySection.REVENUE || 0,
      cogs: pnlBySection.COGS || 0,
      opex: pnlBySection.OPEX || 0,
      otherIncome: pnlBySection.OTHER_INCOME || 0,
      otherExpense: pnlBySection.OTHER_EXPENSE || 0,
      tax: pnlBySection.TAX || 0,
    });

    const cashFlow = cashGroups.reduce((acc, row) => {
      const amount = decimalToNumber(row._sum.amount);
      if (row.kind === "INFLOW") acc.inflow += amount;
      if (row.kind === "OUTFLOW") acc.outflow += amount;
      if (row.kind === "INFLOW") acc[row.flowSection] += amount;
      if (row.kind === "OUTFLOW") acc[row.flowSection] -= amount;
      return acc;
    }, { inflow: 0, outflow: 0, OPERATING: 0, INVESTING: 0, FINANCING: 0, INTERNAL_TRANSFER: 0 });

    let receivables = 0;
    let payables = 0;
    let overdueReceivables = 0;
    let overduePayables = 0;
    const now = new Date();
    for (const obligation of obligations) {
      const outstanding = outstandingAmount(obligation.amount, obligation.settledAmount);
      const overdue = obligation.status === "OVERDUE" || Boolean(obligation.dueAt && obligation.dueAt < now);
      if (obligation.direction === "RECEIVABLE") {
        receivables += outstanding;
        if (overdue) overdueReceivables += outstanding;
      } else {
        payables += outstanding;
        if (overdue) overduePayables += outstanding;
      }
    }

    let scopedWorkOrderIds: string[] | null = null;
    if (effectiveLocationIds) {
      const appointmentRows = await prisma.serviceAppointment.findMany({
        where: {
          locationId: { in: effectiveLocationIds },
          workOrderId: { not: null },
          NOT: { id: { startsWith: "demo_" } },
        },
        select: { workOrderId: true },
        distinct: ["workOrderId"],
      });
      scopedWorkOrderIds = appointmentRows.map((row) => row.workOrderId).filter((id): id is string => Boolean(id));
    }

    const closedWorkOrders = scopedWorkOrderIds?.length === 0
      ? []
      : await prisma.workOrder.findMany({
          where: {
            ...(scopedWorkOrderIds ? { id: { in: scopedWorkOrderIds } } : {}),
            status: "CLOSED",
            closedAt: { gte: from, lt: to },
            NOT: { id: { startsWith: "demo_" } },
          },
          select: { id: true },
        });
    const closedIds = closedWorkOrders.map((row) => row.id);
    const snapshots = closedIds.length
      ? await prisma.workOrderFinanceSnapshot.findMany({
          where: { workOrderId: { in: closedIds }, kind: "ACTUAL" },
          select: {
            workOrderId: true,
            laborRevenue: true,
            partsRevenue: true,
            externalRevenue: true,
            otherRevenue: true,
            partsCost: true,
            laborCost: true,
            externalCost: true,
            consumablesCost: true,
            otherDirectCost: true,
            grossRevenue: true,
            directCost: true,
            grossProfit: true,
          },
        })
      : [];

    const grossRevenue = sum(snapshots, (row) => row.grossRevenue);
    const grossProfit = sum(snapshots, (row) => row.grossProfit);
    const currentCash = accounts.reduce((total, account) => total + decimalToNumber(account.openingBalance), 0);

    return NextResponse.json({
      ok: true,
      permitted: true,
      range: { from: dayKey(from), to: dayKey(new Date(to.getTime() - 1)), timezone: KYIV_TZ },
      finance: {
        hasFinancialData: eventCount > 0 || cashCount > 0 || obligations.length > 0 || snapshots.length > 0,
        pnl: {
          revenue: roundMoney(pnl.revenue),
          cogs: roundMoney(pnl.cogs),
          grossProfit: roundMoney(pnl.grossProfit),
          grossMarginPct: pnl.grossMarginPercent,
          opex: roundMoney(pnl.opex),
          operatingProfit: roundMoney(pnl.operatingProfit),
          otherIncome: roundMoney(pnl.otherIncome),
          otherExpense: roundMoney(pnl.otherExpense),
          tax: roundMoney(pnl.tax),
          netProfit: roundMoney(pnl.netProfit),
          netMarginPct: pnl.netMarginPercent,
        },
        cashFlow: {
          inflow: roundMoney(cashFlow.inflow),
          outflow: roundMoney(cashFlow.outflow),
          net: roundMoney(cashFlow.inflow - cashFlow.outflow),
          operating: roundMoney(cashFlow.OPERATING),
          investing: roundMoney(cashFlow.INVESTING),
          financing: roundMoney(cashFlow.FINANCING),
        },
        workingCapital: {
          receivables: roundMoney(receivables),
          payables: roundMoney(payables),
          overdueReceivables: roundMoney(overdueReceivables),
          overduePayables: roundMoney(overduePayables),
        },
        orderEconomics: {
          finalizedOrders: snapshots.length,
          grossRevenue: roundMoney(grossRevenue),
          grossProfit: roundMoney(grossProfit),
          grossMarginPct: grossRevenue > 0 ? Math.round((grossProfit / grossRevenue) * 1000) / 10 : 0,
          averageCheck: snapshots.length ? roundMoney(grossRevenue / snapshots.length) : 0,
          revenueMix: {
            labor: roundMoney(sum(snapshots, (row) => row.laborRevenue)),
            parts: roundMoney(sum(snapshots, (row) => row.partsRevenue)),
            external: roundMoney(sum(snapshots, (row) => row.externalRevenue)),
            other: roundMoney(sum(snapshots, (row) => row.otherRevenue)),
          },
          costMix: {
            parts: roundMoney(sum(snapshots, (row) => row.partsCost)),
            labor: roundMoney(sum(snapshots, (row) => row.laborCost)),
            external: roundMoney(sum(snapshots, (row) => row.externalCost)),
            consumables: roundMoney(sum(snapshots, (row) => row.consumablesCost)),
            other: roundMoney(sum(snapshots, (row) => row.otherDirectCost)),
          },
        },
        accounts: accounts.map((account) => ({
          id: account.id,
          name: account.name,
          type: account.type,
          openingBalance: decimalToNumber(account.openingBalance),
          locationId: account.locationId,
        })),
        counts: {
          postedEvents: eventCount,
          postedCashTransactions: cashCount,
          openObligations: obligations.length,
          activeMoneyAccounts: accounts.length,
        },
        openingCashReference: roundMoney(currentCash),
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/analytics/finance failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити фінансову аналітику." }, { status: 500 });
  }
}
