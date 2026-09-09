import { Prisma } from "@/src/generated/prisma/client";
import { calculatePnl, decimalToNumber, outstandingAmount, roundMoney } from "@/src/domain/finance";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";

const DAY_MS = 86_400_000;
const OPEN_OBLIGATION_STATUSES = ["OPEN", "PARTIALLY_PAID", "OVERDUE"] as const;
const ACTIVE_FORECAST_STATUSES = ["PLANNED", "CONFIRMED"] as const;
const BUDGET_METRICS = ["REVENUE", "COGS", "OPEX", "GROSS_PROFIT", "OPERATING_PROFIT", "NET_PROFIT", "CASH_FLOW", "CATEGORY"] as const;

type BudgetMetric = (typeof BUDGET_METRICS)[number];

export type FinancialCenterScope = {
  from: Date;
  to: Date;
  currency?: string;
  locationId?: string | null;
  allowedLocationIds?: string[] | null;
};

export type FinanceActor = {
  id: string | null;
  name: string;
};

export class FinancialCenterV2Error extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "FinancialCenterV2Error";
    this.code = code;
    this.status = status;
  }
}

function locationWhere(scope: FinancialCenterScope) {
  if (scope.locationId) return { locationId: scope.locationId };
  if (scope.allowedLocationIds?.length) return { locationId: { in: scope.allowedLocationIds } };
  return {};
}

function locationMatches(locationId: string | null, scope: FinancialCenterScope) {
  if (scope.locationId) return locationId === scope.locationId;
  if (scope.allowedLocationIds?.length) return Boolean(locationId && scope.allowedLocationIds.includes(locationId));
  return true;
}

function currencyOf(scope: FinancialCenterScope) {
  const value = (scope.currency || "UAH").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(value) ? value : "UAH";
}

function text(value: unknown, max = 240) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function decimal(value: unknown, code: string, message: string, allowZero = false) {
  if (value === null || value === undefined || value === "") throw new FinancialCenterV2Error(code, message);
  let result: Prisma.Decimal;
  try {
    result = new Prisma.Decimal(String(value).replace(",", ".")).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  } catch {
    throw new FinancialCenterV2Error(code, message);
  }
  if (!result.isFinite() || (allowZero ? result.lessThan(0) : result.lessThanOrEqualTo(0))) {
    throw new FinancialCenterV2Error(code, message);
  }
  return result;
}

function optionalDecimal(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return decimal(value, "INVALID_AMOUNT", "Некоректна сума.", true);
}

function parseDate(value: unknown, code: string, message: string, fallback?: Date) {
  if (value === null || value === undefined || value === "") {
    if (fallback) return fallback;
    throw new FinancialCenterV2Error(code, message);
  }
  const raw = String(value);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00+03:00`) : new Date(raw);
  if (Number.isNaN(date.getTime())) throw new FinancialCenterV2Error(code, message);
  return date;
}

function isoDay(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonths(value: Date, months: number) {
  const next = new Date(value);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function periodDuration(scope: FinancialCenterScope) {
  return Math.max(DAY_MS, scope.to.getTime() - scope.from.getTime());
}

function previousPeriod(scope: FinancialCenterScope) {
  const duration = periodDuration(scope);
  return {
    from: new Date(scope.from.getTime() - duration),
    to: new Date(scope.from.getTime()),
  };
}

function changePercent(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function daysOverdue(dueAt: Date | null, issuedAt: Date, now: Date) {
  const basis = dueAt || issuedAt;
  if (basis >= now) return 0;
  return Math.max(0, Math.floor((now.getTime() - basis.getTime()) / DAY_MS));
}

function agingBucket(days: number) {
  if (days <= 7) return "0_7";
  if (days <= 14) return "8_14";
  if (days <= 30) return "15_30";
  if (days <= 60) return "31_60";
  return "60_PLUS";
}

function remainingWorkingDays(from: Date, to: Date) {
  let count = 0;
  const cursor = new Date(from);
  cursor.setUTCHours(12, 0, 0, 0);
  const end = new Date(to);
  while (cursor < end) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

function advanceOccurrence(value: Date, frequency: string, intervalCount: number) {
  const interval = Math.max(1, Math.min(120, intervalCount || 1));
  switch (frequency) {
    case "DAILY": return addDays(value, interval);
    case "WEEKLY": return addDays(value, 7 * interval);
    case "QUARTERLY": return addMonths(value, 3 * interval);
    case "YEARLY": {
      const next = new Date(value);
      next.setUTCFullYear(next.getUTCFullYear() + interval);
      return next;
    }
    case "MONTHLY":
    default:
      return addMonths(value, interval);
  }
}

function accountBalances(
  accounts: Array<{ id: string; name: string; type: string; openingBalance: Prisma.Decimal; openingBalanceAt: Date; locationId: string | null }>,
  cash: Array<{ kind: string; amount: Prisma.Decimal; fromAccountId: string | null; toAccountId: string | null }>,
) {
  const balances = new Map(accounts.map((account) => [account.id, decimalToNumber(account.openingBalance)]));
  for (const tx of cash) {
    const amount = decimalToNumber(tx.amount);
    if (tx.kind === "INFLOW" && tx.toAccountId && balances.has(tx.toAccountId)) {
      balances.set(tx.toAccountId, (balances.get(tx.toAccountId) || 0) + amount);
    }
    if (tx.kind === "OUTFLOW" && tx.fromAccountId && balances.has(tx.fromAccountId)) {
      balances.set(tx.fromAccountId, (balances.get(tx.fromAccountId) || 0) - amount);
    }
    if (tx.kind === "TRANSFER") {
      if (tx.fromAccountId && balances.has(tx.fromAccountId)) balances.set(tx.fromAccountId, (balances.get(tx.fromAccountId) || 0) - amount);
      if (tx.toAccountId && balances.has(tx.toAccountId)) balances.set(tx.toAccountId, (balances.get(tx.toAccountId) || 0) + amount);
    }
  }
  return accounts.map((account) => ({
    id: account.id,
    name: account.name,
    type: account.type,
    locationId: account.locationId,
    openingBalance: roundMoney(decimalToNumber(account.openingBalance)),
    balance: roundMoney(balances.get(account.id) || 0),
  }));
}

function pnlFromEvents(events: Array<{ pnlSection: string; amount: Prisma.Decimal }>) {
  const sums: Record<string, number> = {};
  for (const event of events) sums[event.pnlSection] = (sums[event.pnlSection] || 0) + decimalToNumber(event.amount);
  const pnl = calculatePnl({
    revenue: sums.REVENUE || 0,
    cogs: sums.COGS || 0,
    opex: sums.OPEX || 0,
    otherIncome: sums.OTHER_INCOME || 0,
    otherExpense: sums.OTHER_EXPENSE || 0,
    tax: sums.TAX || 0,
  });
  return {
    revenue: roundMoney(pnl.revenue),
    cogs: roundMoney(pnl.cogs),
    grossProfit: roundMoney(pnl.grossProfit),
    grossMarginPercent: pnl.grossMarginPercent == null ? null : roundMoney(pnl.grossMarginPercent),
    opex: roundMoney(pnl.opex),
    operatingProfit: roundMoney(pnl.operatingProfit),
    otherIncome: roundMoney(pnl.otherIncome),
    otherExpense: roundMoney(pnl.otherExpense),
    tax: roundMoney(pnl.tax),
    netProfit: roundMoney(pnl.netProfit),
    netMarginPercent: pnl.netMarginPercent == null ? null : roundMoney(pnl.netMarginPercent),
  };
}

async function resolveSettings(scope: FinancialCenterScope) {
  const prisma = getPrisma();
  if (scope.locationId) {
    const local = await prisma.financialSettings.findUnique({ where: { scopeKey: `LOCATION:${scope.locationId}` } });
    if (local) return local;
  }
  return prisma.financialSettings.findUnique({ where: { scopeKey: "GLOBAL" } });
}

export async function getFinancialCenterV2(scope: FinancialCenterScope) {
  const prisma = getPrisma();
  const currency = currencyOf(scope);
  const location = locationWhere(scope);
  const previous = previousPeriod(scope);
  const now = new Date();

  const accounts = await prisma.moneyAccount.findMany({
    where: { isActive: true, currency, ...location },
    select: { id: true, name: true, type: true, openingBalance: true, openingBalanceAt: true, locationId: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const accountIds = accounts.map((item) => item.id);

  const [events, previousEvents, cashPeriod, cashAll, obligations, categories, budgets, recurring, settings, costCenters] = await Promise.all([
    prisma.financialEvent.findMany({
      where: { status: "POSTED", currency, recognizedAt: { gte: scope.from, lt: scope.to }, ...location },
      select: {
        id: true, pnlSection: true, amount: true, recognizedAt: true, categoryId: true, costCenterId: true,
        workOrderId: true, clientId: true, vehicleId: true, supplierId: true, employeeId: true, locationId: true,
        description: true, sourceEntity: true, sourceEntityId: true,
        category: { select: { id: true, code: true, name: true, parentId: true, pnlSection: true, cashFlowSection: true } },
      },
      orderBy: { recognizedAt: "desc" },
    }),
    prisma.financialEvent.findMany({
      where: { status: "POSTED", currency, recognizedAt: { gte: previous.from, lt: previous.to }, ...location },
      select: { pnlSection: true, amount: true },
    }),
    prisma.cashTransaction.findMany({
      where: { status: "POSTED", currency, occurredAt: { gte: scope.from, lt: scope.to }, ...location },
      select: { id: true, kind: true, flowSection: true, amount: true, occurredAt: true, fromAccountId: true, toAccountId: true, categoryId: true, costCenterId: true, obligationId: true, workOrderId: true, clientId: true, supplierId: true, locationId: true, description: true, sourceEntity: true, sourceEntityId: true },
      orderBy: { occurredAt: "desc" },
    }),
    accountIds.length ? prisma.cashTransaction.findMany({
      where: {
        status: "POSTED", currency,
        OR: [{ fromAccountId: { in: accountIds } }, { toAccountId: { in: accountIds } }],
      },
      select: { kind: true, amount: true, fromAccountId: true, toAccountId: true },
    }) : Promise.resolve([]),
    prisma.financialObligation.findMany({
      where: { status: { in: [...OPEN_OBLIGATION_STATUSES] }, currency, ...location },
      select: { id: true, direction: true, status: true, amount: true, settledAmount: true, issuedAt: true, dueAt: true, settledAt: true, categoryId: true, costCenterId: true, workOrderId: true, clientId: true, supplierId: true, locationId: true, counterpartyName: true, sourceEntity: true, sourceEntityId: true, description: true },
      orderBy: [{ dueAt: "asc" }, { issuedAt: "asc" }],
    }),
    prisma.financialCategory.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, pnlSection: true, cashFlowSection: true, parentId: true, isSystem: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.financialBudget.findMany({
      where: { currency, status: { in: ["ACTIVE", "APPROVED"] }, periodStart: { lt: scope.to }, periodEnd: { gt: scope.from }, ...location },
      orderBy: [{ periodStart: "asc" }, { name: "asc" }],
    }),
    prisma.recurringFinancialRule.findMany({
      where: { isActive: true, currency, ...location },
      orderBy: [{ nextOccurrenceAt: "asc" }, { name: "asc" }],
    }),
    resolveSettings(scope),
    prisma.costCenter.findMany({ where: { isActive: true, ...location }, select: { id: true, code: true, name: true, locationId: true, sortOrder: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);

  const pnl = pnlFromEvents(events);
  const previousPnl = pnlFromEvents(previousEvents);
  const categoryMap = new Map(categories.map((category) => [category.id, category]));

  const pnlCategories = new Map<string, { id: string; code: string; name: string; section: string; amount: number; count: number }>();
  for (const event of events) {
    const key = event.categoryId || `UNCATEGORIZED:${event.pnlSection}`;
    const current = pnlCategories.get(key) || {
      id: event.categoryId || key,
      code: event.category?.code || "UNCATEGORIZED",
      name: event.category?.name || "Без категорії",
      section: event.pnlSection,
      amount: 0,
      count: 0,
    };
    current.amount += decimalToNumber(event.amount);
    current.count += 1;
    pnlCategories.set(key, current);
  }

  const cashSection = { inflow: 0, outflow: 0, operating: 0, investing: 0, financing: 0, internalTransfer: 0 };
  for (const tx of cashPeriod) {
    const amount = decimalToNumber(tx.amount);
    if (tx.kind === "INFLOW") cashSection.inflow += amount;
    if (tx.kind === "OUTFLOW") cashSection.outflow += amount;
    const signed = tx.kind === "INFLOW" ? amount : tx.kind === "OUTFLOW" ? -amount : 0;
    if (tx.flowSection === "OPERATING") cashSection.operating += signed;
    if (tx.flowSection === "INVESTING") cashSection.investing += signed;
    if (tx.flowSection === "FINANCING") cashSection.financing += signed;
    if (tx.flowSection === "INTERNAL_TRANSFER") cashSection.internalTransfer += amount;
  }

  const accountRows = accountBalances(accounts, cashAll);
  const currentCash = roundMoney(accountRows.reduce((sum, row) => sum + row.balance, 0));

  const aging = {
    receivables: { total: 0, overdue: 0, buckets: { "0_7": 0, "8_14": 0, "15_30": 0, "31_60": 0, "60_PLUS": 0 } as Record<string, number> },
    payables: { total: 0, overdue: 0, buckets: { "0_7": 0, "8_14": 0, "15_30": 0, "31_60": 0, "60_PLUS": 0 } as Record<string, number> },
  };
  const obligationRows = obligations.map((obligation) => {
    const outstanding = roundMoney(outstandingAmount(obligation.amount, obligation.settledAmount));
    const overdueDays = daysOverdue(obligation.dueAt, obligation.issuedAt, now);
    const target = obligation.direction === "RECEIVABLE" ? aging.receivables : aging.payables;
    target.total += outstanding;
    if (overdueDays > 0) target.overdue += outstanding;
    target.buckets[agingBucket(overdueDays)] += outstanding;
    return {
      ...obligation,
      amount: decimalToNumber(obligation.amount),
      settledAmount: decimalToNumber(obligation.settledAmount),
      outstanding,
      overdueDays,
      isOverdue: overdueDays > 0,
    };
  });
  aging.receivables.total = roundMoney(aging.receivables.total);
  aging.receivables.overdue = roundMoney(aging.receivables.overdue);
  aging.payables.total = roundMoney(aging.payables.total);
  aging.payables.overdue = roundMoney(aging.payables.overdue);
  Object.keys(aging.receivables.buckets).forEach((key) => {
    aging.receivables.buckets[key] = roundMoney(aging.receivables.buckets[key]);
    aging.payables.buckets[key] = roundMoney(aging.payables.buckets[key]);
  });

  const categoryActual = new Map<string, number>();
  for (const event of events) {
    if (!event.categoryId) continue;
    categoryActual.set(event.categoryId, (categoryActual.get(event.categoryId) || 0) + decimalToNumber(event.amount));
  }

  const actualForMetric = (metric: string, categoryId: string | null) => {
    if (metric === "REVENUE") return pnl.revenue;
    if (metric === "COGS") return pnl.cogs;
    if (metric === "OPEX") return pnl.opex;
    if (metric === "GROSS_PROFIT") return pnl.grossProfit;
    if (metric === "OPERATING_PROFIT") return pnl.operatingProfit;
    if (metric === "NET_PROFIT") return pnl.netProfit;
    if (metric === "CASH_FLOW") return roundMoney(cashSection.inflow - cashSection.outflow);
    if (metric === "CATEGORY" && categoryId) return roundMoney(categoryActual.get(categoryId) || 0);
    return 0;
  };

  const planFact = budgets.map((budget) => {
    const plan = decimalToNumber(budget.amount);
    const actual = actualForMetric(budget.metric, budget.categoryId);
    const variance = roundMoney(actual - plan);
    const completionPercent = plan === 0 ? null : roundMoney((actual / plan) * 100);
    return {
      ...budget,
      amount: plan,
      categoryName: budget.categoryId ? categoryMap.get(budget.categoryId)?.name || null : null,
      actual,
      variance,
      completionPercent,
    };
  });

  const settingsView = {
    scopeKey: settings?.scopeKey || "GLOBAL",
    locationId: settings?.locationId || null,
    defaultCurrency: settings?.defaultCurrency || currency,
    minimumCashReserve: decimalToNumber(settings?.minimumCashReserve || 0),
    fixedMonthlyCosts: decimalToNumber(settings?.fixedMonthlyCosts || 0),
    targetGrossMarginPercent: decimalToNumber(settings?.targetGrossMarginPercent || 40),
    warningGrossMarginPercent: decimalToNumber(settings?.warningGrossMarginPercent || 25),
    forecastHorizonDays: Math.max(30, Math.min(365, settings?.forecastHorizonDays || 90)),
  };

  const horizonEnd = addDays(now, settingsView.forecastHorizonDays);
  const forecastRows = await prisma.financialForecastItem.findMany({
    where: {
      status: { in: [...ACTIVE_FORECAST_STATUSES] }, currency,
      expectedAt: { gte: now, lte: horizonEnd }, ...location,
    },
    orderBy: { expectedAt: "asc" },
  });

  const calendar: Array<{
    id: string;
    sourceType: string;
    direction: "INFLOW" | "OUTFLOW";
    amount: number;
    weightedAmount: number;
    expectedAt: string;
    status: string;
    counterparty: string | null;
    description: string | null;
    sourceId: string | null;
  }> = [];

  for (const obligation of obligationRows) {
    const expectedAt = obligation.dueAt && obligation.dueAt > now ? obligation.dueAt : now;
    if (expectedAt > horizonEnd) continue;
    calendar.push({
      id: `obligation:${obligation.id}`,
      sourceType: "OBLIGATION",
      direction: obligation.direction === "RECEIVABLE" ? "INFLOW" : "OUTFLOW",
      amount: obligation.outstanding,
      weightedAmount: obligation.outstanding,
      expectedAt: expectedAt.toISOString(),
      status: obligation.status,
      counterparty: obligation.counterpartyName,
      description: obligation.description,
      sourceId: obligation.id,
    });
  }

  for (const rule of recurring) {
    let occurrence = rule.nextOccurrenceAt > now ? new Date(rule.nextOccurrenceAt) : new Date(now);
    let guard = 0;
    while (occurrence <= horizonEnd && guard < 400) {
      if (!rule.endAt || occurrence <= rule.endAt) {
        const amount = decimalToNumber(rule.amount);
        calendar.push({
          id: `recurring:${rule.id}:${isoDay(occurrence)}`,
          sourceType: "RECURRING",
          direction: rule.direction === "INFLOW" ? "INFLOW" : "OUTFLOW",
          amount,
          weightedAmount: amount,
          expectedAt: occurrence.toISOString(),
          status: "PLANNED",
          counterparty: rule.counterpartyName,
          description: rule.description || rule.name,
          sourceId: rule.id,
        });
      }
      occurrence = advanceOccurrence(occurrence, rule.frequency, rule.intervalCount);
      guard += 1;
    }
  }

  for (const row of forecastRows) {
    const amount = decimalToNumber(row.amount);
    const probability = Math.max(0, Math.min(100, row.probability));
    calendar.push({
      id: `forecast:${row.id}`,
      sourceType: row.sourceEntity || "FORECAST",
      direction: row.direction === "OUTFLOW" ? "OUTFLOW" : "INFLOW",
      amount,
      weightedAmount: roundMoney(amount * probability / 100),
      expectedAt: row.expectedAt.toISOString(),
      status: row.status,
      counterparty: row.counterpartyName,
      description: row.description,
      sourceId: row.sourceEntityId || row.id,
    });
  }
  calendar.sort((a, b) => a.expectedAt.localeCompare(b.expectedAt));

  const dayMap = new Map<string, { inflow: number; outflow: number; items: number }>();
  for (const item of calendar) {
    const day = item.expectedAt.slice(0, 10);
    const current = dayMap.get(day) || { inflow: 0, outflow: 0, items: 0 };
    if (item.direction === "INFLOW") current.inflow += item.weightedAmount;
    else current.outflow += item.weightedAmount;
    current.items += 1;
    dayMap.set(day, current);
  }

  const forecastPoints: Array<{ date: string; inflow: number; outflow: number; net: number; closingCash: number; belowReserve: boolean }> = [];
  let projectedCash = currentCash;
  const cursor = new Date(now);
  cursor.setUTCHours(12, 0, 0, 0);
  while (cursor <= horizonEnd) {
    const day = isoDay(cursor);
    const values = dayMap.get(day) || { inflow: 0, outflow: 0, items: 0 };
    projectedCash += values.inflow - values.outflow;
    forecastPoints.push({
      date: day,
      inflow: roundMoney(values.inflow),
      outflow: roundMoney(values.outflow),
      net: roundMoney(values.inflow - values.outflow),
      closingCash: roundMoney(projectedCash),
      belowReserve: projectedCash < settingsView.minimumCashReserve,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const firstGap = forecastPoints.find((point) => point.closingCash < 0) || null;
  const firstReserveWarning = forecastPoints.find((point) => point.belowReserve) || null;
  const minimumForecastCash = forecastPoints.reduce((min, point) => Math.min(min, point.closingCash), currentCash);

  const fixedCosts = settingsView.fixedMonthlyCosts > 0
    ? settingsView.fixedMonthlyCosts
    : planFact.filter((item) => item.metric === "OPEX").reduce((sum, item) => sum + item.amount, 0) || pnl.opex;
  const grossMarginRatio = pnl.grossMarginPercent && pnl.grossMarginPercent > 0 ? pnl.grossMarginPercent / 100 : 0;
  const breakEvenRevenue = grossMarginRatio > 0 ? roundMoney(fixedCosts / grossMarginRatio) : null;
  const breakEvenRemaining = breakEvenRevenue == null ? null : roundMoney(Math.max(0, breakEvenRevenue - pnl.revenue));
  const workingDays = remainingWorkingDays(now > scope.from ? now : scope.from, scope.to);
  const requiredRevenuePerDay = breakEvenRemaining == null || workingDays <= 0 ? null : roundMoney(breakEvenRemaining / workingDays);

  const workOrderIdsInScope = Array.from(new Set(events.map((event) => event.workOrderId).filter(Boolean) as string[]));
  const snapshotWhere: Prisma.WorkOrderFinanceSnapshotWhereInput = {
    kind: "ACTUAL",
    ...(scope.locationId || scope.allowedLocationIds?.length
      ? { workOrderId: { in: workOrderIdsInScope.length ? workOrderIdsInScope : ["__none__"] } }
      : { calculatedAt: { gte: scope.from, lt: scope.to } }),
  };
  const snapshots = await prisma.workOrderFinanceSnapshot.findMany({ where: snapshotWhere, orderBy: { grossProfit: "desc" }, take: 500 });
  const snapshotOrderIds = snapshots.map((row) => row.workOrderId);
  const workOrders = snapshotOrderIds.length ? await prisma.workOrder.findMany({
    where: { id: { in: snapshotOrderIds } },
    select: { id: true, status: true, closedAt: true, client: { select: { id: true, name: true } }, vehicle: { select: { id: true, brand: true, model: true, year: true, plateNumber: true } } },
  }) : [];
  const workOrderById = new Map(workOrders.map((row) => [row.id, row]));

  const workOrderProfitability = snapshots.map((row) => {
    const order = workOrderById.get(row.workOrderId);
    return {
      workOrderId: row.workOrderId,
      client: order?.client.name || null,
      vehicle: order ? ([order.vehicle.brand, order.vehicle.model, order.vehicle.year].filter(Boolean).join(" ") || order.vehicle.plateNumber || "Автомобіль") : null,
      plateNumber: order?.vehicle.plateNumber || null,
      status: order?.status || null,
      closedAt: order?.closedAt || null,
      revenue: decimalToNumber(row.grossRevenue),
      directCost: decimalToNumber(row.directCost),
      grossProfit: decimalToNumber(row.grossProfit),
      marginPercent: row.grossMarginPercent == null ? null : decimalToNumber(row.grossMarginPercent),
      laborRevenue: decimalToNumber(row.laborRevenue),
      partsRevenue: decimalToNumber(row.partsRevenue),
      partsCost: decimalToNumber(row.partsCost),
      laborCost: decimalToNumber(row.laborCost),
      consumablesCost: decimalToNumber(row.consumablesCost),
    };
  });

  const lines = snapshotOrderIds.length ? await prisma.workOrderLine.findMany({
    where: { workOrderId: { in: snapshotOrderIds }, status: { in: ["APPROVED", "IN_PROGRESS", "COMPLETED"] } },
    select: { id: true, workOrderId: true, type: true, description: true, article: true, brand: true, mechanicId: true, supplierId: true, actualQuantity: true, actualUnitPrice: true, actualUnitCost: true, actualDiscount: true, plannedQuantity: true, plannedUnitPrice: true, plannedUnitCost: true, plannedDiscount: true, laborHours: true },
  }) : [];

  const lineEconomics = (line: (typeof lines)[number]) => {
    const qty = decimalToNumber(line.actualQuantity ?? line.plannedQuantity);
    const price = decimalToNumber(line.actualUnitPrice ?? line.plannedUnitPrice);
    const cost = decimalToNumber(line.actualUnitCost ?? line.plannedUnitCost);
    const discount = decimalToNumber(line.actualDiscount ?? line.plannedDiscount);
    const revenue = Math.max(0, qty * price - discount);
    const directCost = Math.max(0, qty * cost);
    const profit = revenue - directCost;
    return { qty, revenue: roundMoney(revenue), directCost: roundMoney(directCost), profit: roundMoney(profit), marginPercent: revenue > 0 ? roundMoney(profit / revenue * 100) : null };
  };

  const serviceGroups = new Map<string, { type: string; name: string; revenue: number; directCost: number; profit: number; count: number }>();
  const partGroups = new Map<string, { name: string; brand: string | null; article: string | null; supplierId: string | null; quantity: number; revenue: number; directCost: number; profit: number }>();
  const mechanicGroups = new Map<string, { mechanicId: string; revenue: number; directCost: number; profit: number; laborHours: number; lines: number }>();
  for (const line of lines) {
    const economics = lineEconomics(line);
    const serviceKey = `${line.type}:${line.description}`;
    const service = serviceGroups.get(serviceKey) || { type: line.type, name: line.description, revenue: 0, directCost: 0, profit: 0, count: 0 };
    service.revenue += economics.revenue;
    service.directCost += economics.directCost;
    service.profit += economics.profit;
    service.count += 1;
    serviceGroups.set(serviceKey, service);

    if (line.type === "PART") {
      const key = `${line.brand || ""}:${line.article || ""}:${line.description}:${line.supplierId || ""}`;
      const part = partGroups.get(key) || { name: line.description, brand: line.brand, article: line.article, supplierId: line.supplierId, quantity: 0, revenue: 0, directCost: 0, profit: 0 };
      part.quantity += economics.qty;
      part.revenue += economics.revenue;
      part.directCost += economics.directCost;
      part.profit += economics.profit;
      partGroups.set(key, part);
    }

    if (line.type === "LABOR" && line.mechanicId) {
      const mechanic = mechanicGroups.get(line.mechanicId) || { mechanicId: line.mechanicId, revenue: 0, directCost: 0, profit: 0, laborHours: 0, lines: 0 };
      mechanic.revenue += economics.revenue;
      mechanic.directCost += economics.directCost;
      mechanic.profit += economics.profit;
      mechanic.laborHours += decimalToNumber(line.laborHours || 0);
      mechanic.lines += 1;
      mechanicGroups.set(line.mechanicId, mechanic);
    }
  }

  const mechanicIds = Array.from(mechanicGroups.keys());
  const employeeProfiles = mechanicIds.length ? await prisma.employeeProfile.findMany({
    where: { id: { in: mechanicIds } },
    select: { id: true, firstName: true, lastName: true, middleName: true, position: true },
  }) : [];
  const employeesById = new Map(employeeProfiles.map((row) => [row.id, row]));

  const services = Array.from(serviceGroups.values()).map((row) => ({
    ...row,
    revenue: roundMoney(row.revenue), directCost: roundMoney(row.directCost), profit: roundMoney(row.profit),
    marginPercent: row.revenue > 0 ? roundMoney(row.profit / row.revenue * 100) : null,
  })).sort((a, b) => b.profit - a.profit);
  const parts = Array.from(partGroups.values()).map((row) => ({
    ...row,
    quantity: roundMoney(row.quantity), revenue: roundMoney(row.revenue), directCost: roundMoney(row.directCost), profit: roundMoney(row.profit),
    markupPercent: row.directCost > 0 ? roundMoney(row.profit / row.directCost * 100) : null,
    marginPercent: row.revenue > 0 ? roundMoney(row.profit / row.revenue * 100) : null,
  })).sort((a, b) => b.profit - a.profit);
  const mechanics = Array.from(mechanicGroups.values()).map((row) => {
    const profile = employeesById.get(row.mechanicId);
    return {
      ...row,
      name: profile ? [profile.lastName, profile.firstName, profile.middleName].filter(Boolean).join(" ") : row.mechanicId,
      position: profile?.position || null,
      revenue: roundMoney(row.revenue), directCost: roundMoney(row.directCost), profit: roundMoney(row.profit), laborHours: roundMoney(row.laborHours),
      marginPercent: row.revenue > 0 ? roundMoney(row.profit / row.revenue * 100) : null,
    };
  }).sort((a, b) => b.profit - a.profit);

  const supplierGroups = new Map<string, { supplierId: string; revenue: number; directCost: number; profit: number; parts: number }>();
  for (const part of parts) {
    if (!part.supplierId) continue;
    const row = supplierGroups.get(part.supplierId) || { supplierId: part.supplierId, revenue: 0, directCost: 0, profit: 0, parts: 0 };
    row.revenue += part.revenue;
    row.directCost += part.directCost;
    row.profit += part.profit;
    row.parts += 1;
    supplierGroups.set(part.supplierId, row);
  }
  const supplierIds = Array.from(supplierGroups.keys());
  const suppliers = supplierIds.length ? await prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true } }) : [];
  const supplierById = new Map(suppliers.map((row) => [row.id, row.name]));
  const supplierProfitability = Array.from(supplierGroups.values()).map((row) => ({
    ...row,
    name: supplierById.get(row.supplierId) || row.supplierId,
    revenue: roundMoney(row.revenue), directCost: roundMoney(row.directCost), profit: roundMoney(row.profit),
    markupPercent: row.directCost > 0 ? roundMoney(row.profit / row.directCost * 100) : null,
    marginPercent: row.revenue > 0 ? roundMoney(row.profit / row.revenue * 100) : null,
  })).sort((a, b) => b.profit - a.profit);

  const alerts: Array<{ level: "INFO" | "WARNING" | "CRITICAL"; code: string; title: string; message: string; amount?: number; date?: string }> = [];
  if (firstGap) alerts.push({ level: "CRITICAL", code: "CASH_GAP", title: "Прогнозований касовий розрив", message: `Прогнозований залишок ${firstGap.closingCash.toFixed(0)} грн.`, amount: firstGap.closingCash, date: firstGap.date });
  else if (firstReserveWarning) alerts.push({ level: "WARNING", code: "CASH_RESERVE", title: "Залишок нижче резерву", message: `Прогнозований залишок знизиться нижче резерву ${settingsView.minimumCashReserve.toFixed(0)} грн.`, amount: firstReserveWarning.closingCash, date: firstReserveWarning.date });
  if (aging.receivables.overdue > 0) alerts.push({ level: aging.receivables.overdue > currentCash * 0.5 ? "CRITICAL" : "WARNING", code: "OVERDUE_AR", title: "Прострочена дебіторка", message: `Не отримано в строк ${aging.receivables.overdue.toFixed(0)} грн.`, amount: aging.receivables.overdue });
  if (aging.payables.overdue > 0) alerts.push({ level: "WARNING", code: "OVERDUE_AP", title: "Прострочена кредиторка", message: `Прострочено платежів на ${aging.payables.overdue.toFixed(0)} грн.`, amount: aging.payables.overdue });
  if (pnl.grossMarginPercent != null && pnl.revenue > 0 && pnl.grossMarginPercent < settingsView.warningGrossMarginPercent) alerts.push({ level: "WARNING", code: "LOW_MARGIN", title: "Низька валова маржа", message: `Маржа ${pnl.grossMarginPercent.toFixed(1)}%, поріг уваги ${settingsView.warningGrossMarginPercent.toFixed(1)}%.` });
  for (const item of planFact) {
    if (item.completionPercent != null && item.completionPercent >= 120 && ["OPEX", "COGS", "CATEGORY"].includes(item.metric)) alerts.push({ level: "CRITICAL", code: "BUDGET_120", title: `Перевищено бюджет: ${item.name}`, message: `Використано ${item.completionPercent.toFixed(0)}% бюджету.`, amount: item.variance });
    else if (item.completionPercent != null && item.completionPercent >= 80 && ["OPEX", "COGS", "CATEGORY"].includes(item.metric)) alerts.push({ level: "WARNING", code: "BUDGET_80", title: `Бюджет наближається до ліміту: ${item.name}`, message: `Використано ${item.completionPercent.toFixed(0)}% бюджету.` });
  }
  if (previousPnl.opex > 0 && pnl.opex > previousPnl.opex && changePercent(pnl.opex, previousPnl.opex)! > 20) {
    alerts.push({ level: "WARNING", code: "OPEX_GROWTH", title: "Операційні витрати зросли", message: `OPEX зріс на ${changePercent(pnl.opex, previousPnl.opex)!.toFixed(1)}% до попереднього аналогічного періоду.` });
  }
  alerts.sort((a, b) => ({ CRITICAL: 0, WARNING: 1, INFO: 2 }[a.level] - ({ CRITICAL: 0, WARNING: 1, INFO: 2 }[b.level])));

  const periodCashFlow = roundMoney(cashSection.inflow - cashSection.outflow);
  return {
    ok: true,
    currency,
    range: { from: scope.from.toISOString(), to: scope.to.toISOString(), timezone: "Europe/Kyiv" },
    settings: settingsView,
    kpi: {
      currentCash,
      revenue: pnl.revenue,
      grossProfit: pnl.grossProfit,
      netProfit: pnl.netProfit,
      cashFlow: periodCashFlow,
      grossMarginPercent: pnl.grossMarginPercent,
      receivables: aging.receivables.total,
      payables: aging.payables.total,
      overdueReceivables: aging.receivables.overdue,
      overduePayables: aging.payables.overdue,
    },
    comparison: {
      previousPeriod: { from: previous.from.toISOString(), to: previous.to.toISOString() },
      revenue: { previous: previousPnl.revenue, changePercent: changePercent(pnl.revenue, previousPnl.revenue) },
      grossProfit: { previous: previousPnl.grossProfit, changePercent: changePercent(pnl.grossProfit, previousPnl.grossProfit) },
      netProfit: { previous: previousPnl.netProfit, changePercent: changePercent(pnl.netProfit, previousPnl.netProfit) },
      opex: { previous: previousPnl.opex, changePercent: changePercent(pnl.opex, previousPnl.opex) },
    },
    pnl: {
      ...pnl,
      categories: Array.from(pnlCategories.values()).map((row) => ({ ...row, amount: roundMoney(row.amount) })).sort((a, b) => b.amount - a.amount),
      events: events.slice(0, 500).map((event) => ({ ...event, amount: decimalToNumber(event.amount) })),
    },
    cashFlow: {
      inflow: roundMoney(cashSection.inflow),
      outflow: roundMoney(cashSection.outflow),
      net: periodCashFlow,
      operating: roundMoney(cashSection.operating),
      investing: roundMoney(cashSection.investing),
      financing: roundMoney(cashSection.financing),
      internalTransfer: roundMoney(cashSection.internalTransfer),
      transactions: cashPeriod.map((tx) => ({ ...tx, amount: decimalToNumber(tx.amount) })),
    },
    accounts: accountRows,
    obligations: obligationRows,
    aging,
    categories,
    costCenters,
    budgets: planFact,
    recurring: recurring.map((row) => ({ ...row, amount: decimalToNumber(row.amount) })),
    calendar,
    forecast: {
      horizonDays: settingsView.forecastHorizonDays,
      minimumReserve: settingsView.minimumCashReserve,
      minimumForecastCash: roundMoney(minimumForecastCash),
      firstGap,
      firstReserveWarning,
      points: forecastPoints,
    },
    breakEven: {
      fixedCosts: roundMoney(fixedCosts),
      grossMarginPercent: pnl.grossMarginPercent,
      breakEvenRevenue,
      currentRevenue: pnl.revenue,
      remainingRevenue: breakEvenRemaining,
      remainingWorkingDays: workingDays,
      requiredRevenuePerDay,
    },
    profitability: {
      workOrders: workOrderProfitability,
      services,
      parts,
      mechanics,
      suppliers: supplierProfitability,
    },
    alerts: alerts.slice(0, 20),
  };
}

export async function createManualIncome(input: Record<string, unknown>, actor: FinanceActor) {
  const prisma = getPrisma();
  const amount = decimal(input.amount, "AMOUNT_REQUIRED", "Вкажіть суму надходження.");
  const currency = (text(input.currency, 3) || "UAH").toUpperCase();
  const moneyAccountId = text(input.moneyAccountId, 64);
  if (!moneyAccountId) throw new FinancialCenterV2Error("ACCOUNT_REQUIRED", "Виберіть рахунок для надходження.");
  const occurredAt = parseDate(input.occurredAt, "INVALID_DATE", "Некоректна дата надходження.", new Date());
  const categoryId = text(input.categoryId, 80);
  const locationId = text(input.locationId, 64);
  const costCenterId = text(input.costCenterId, 80);
  const description = text(input.description, 4000) || "Інше надходження";
  const recognizeRevenue = input.recognizeRevenue === true;
  const idempotencyKey = text(input.idempotencyKey, 96) || `income:${Date.now()}:${Math.random().toString(36).slice(2)}`;

  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `finance-income:${idempotencyKey}`);
    const existing = await tx.cashTransaction.findFirst({ where: { sourceEntity: "MANUAL_INCOME", sourceEntityId: idempotencyKey } });
    if (existing) return { cash: existing, reused: true };
    const account = await tx.moneyAccount.findUnique({ where: { id: moneyAccountId } });
    if (!account || !account.isActive) throw new FinancialCenterV2Error("ACCOUNT_NOT_FOUND", "Активний рахунок не знайдено.", 404);
    if (account.currency !== currency) throw new FinancialCenterV2Error("CURRENCY_MISMATCH", "Валюта рахунку не відповідає валюті операції.");
    const category = categoryId ? await tx.financialCategory.findUnique({ where: { id: categoryId } }) : null;
    if (categoryId && (!category || !category.isActive)) throw new FinancialCenterV2Error("CATEGORY_NOT_FOUND", "Категорію не знайдено.", 404);
    const cash = await tx.cashTransaction.create({
      data: {
        kind: "INFLOW", status: "POSTED", flowSection: category?.cashFlowSection || "OPERATING",
        amount, currency, occurredAt, toAccountId: moneyAccountId, categoryId, costCenterId, locationId,
        sourceEntity: "MANUAL_INCOME", sourceEntityId: idempotencyKey, description, createdById: actor.id, postedAt: occurredAt,
      },
    });
    const event = recognizeRevenue ? await tx.financialEvent.create({
      data: {
        status: "POSTED", pnlSection: category?.pnlSection === "OTHER_INCOME" ? "OTHER_INCOME" : "REVENUE",
        amount, currency, recognizedAt: occurredAt, categoryId, costCenterId, locationId,
        sourceEntity: "MANUAL_INCOME", sourceEntityId: `${idempotencyKey}:pnl`, description, createdById: actor.id, postedAt: occurredAt,
      },
    }) : null;
    await tx.auditEvent.create({ data: { actorId: actor.id, actorName: actor.name, entityType: "CashTransaction", entityId: cash.id, action: "MANUAL_INCOME_POSTED", after: toPrismaJson({ amount: amount.toString(), accountId: moneyAccountId, eventId: event?.id || null, idempotencyKey }) } });
    return { cash, event, reused: false };
  });
}

export async function createTransfer(input: Record<string, unknown>, actor: FinanceActor) {
  const prisma = getPrisma();
  const amount = decimal(input.amount, "AMOUNT_REQUIRED", "Вкажіть суму переказу.");
  const fromAccountId = text(input.fromAccountId, 64);
  const toAccountId = text(input.toAccountId, 64);
  if (!fromAccountId || !toAccountId) throw new FinancialCenterV2Error("ACCOUNTS_REQUIRED", "Виберіть рахунок списання і рахунок зарахування.");
  if (fromAccountId === toAccountId) throw new FinancialCenterV2Error("SAME_ACCOUNT", "Рахунки переказу повинні відрізнятися.");
  const occurredAt = parseDate(input.occurredAt, "INVALID_DATE", "Некоректна дата переказу.", new Date());
  const idempotencyKey = text(input.idempotencyKey, 96) || `transfer:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const description = text(input.description, 4000) || "Внутрішній переказ";

  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `finance-transfer:${idempotencyKey}`);
    const existing = await tx.cashTransaction.findFirst({ where: { sourceEntity: "INTERNAL_TRANSFER", sourceEntityId: idempotencyKey } });
    if (existing) return { transfer: existing, reused: true };
    const [fromAccount, toAccount] = await Promise.all([tx.moneyAccount.findUnique({ where: { id: fromAccountId } }), tx.moneyAccount.findUnique({ where: { id: toAccountId } })]);
    if (!fromAccount?.isActive || !toAccount?.isActive) throw new FinancialCenterV2Error("ACCOUNT_NOT_FOUND", "Один із рахунків не знайдено або деактивовано.", 404);
    if (fromAccount.currency !== toAccount.currency) throw new FinancialCenterV2Error("CURRENCY_MISMATCH", "Внутрішній переказ між різними валютами не підтримується.");
    const transfer = await tx.cashTransaction.create({
      data: {
        kind: "TRANSFER", status: "POSTED", flowSection: "INTERNAL_TRANSFER", amount, currency: fromAccount.currency,
        occurredAt, fromAccountId, toAccountId, locationId: fromAccount.locationId || toAccount.locationId,
        sourceEntity: "INTERNAL_TRANSFER", sourceEntityId: idempotencyKey, description, createdById: actor.id, postedAt: occurredAt,
      },
    });
    await tx.auditEvent.create({ data: { actorId: actor.id, actorName: actor.name, entityType: "CashTransaction", entityId: transfer.id, action: "INTERNAL_TRANSFER_POSTED", after: toPrismaJson({ amount: amount.toString(), fromAccountId, toAccountId, idempotencyKey }) } });
    return { transfer, reused: false };
  });
}

export async function saveBudget(input: Record<string, unknown>, actor: FinanceActor) {
  const prisma = getPrisma();
  const id = text(input.id, 96);
  const name = text(input.name, 160);
  if (!name) throw new FinancialCenterV2Error("NAME_REQUIRED", "Вкажіть назву бюджету.");
  const metric = (text(input.metric, 40) || "CATEGORY").toUpperCase() as BudgetMetric;
  if (!BUDGET_METRICS.includes(metric)) throw new FinancialCenterV2Error("INVALID_METRIC", "Непідтримуваний показник бюджету.");
  const amount = decimal(input.amount, "AMOUNT_REQUIRED", "Вкажіть бюджет.", true);
  const periodStart = parseDate(input.periodStart, "PERIOD_START_REQUIRED", "Вкажіть початок періоду.");
  const periodEnd = parseDate(input.periodEnd, "PERIOD_END_REQUIRED", "Вкажіть кінець періоду.");
  if (periodEnd <= periodStart) throw new FinancialCenterV2Error("INVALID_PERIOD", "Кінець періоду повинен бути пізніше початку.");
  const data = {
    name, metric, amount, currency: (text(input.currency, 3) || "UAH").toUpperCase(), periodStart, periodEnd,
    categoryId: text(input.categoryId, 80), costCenterId: text(input.costCenterId, 80), locationId: text(input.locationId, 64),
    status: text(input.status, 24) || "ACTIVE", notes: text(input.notes, 4000), createdById: actor.id,
  };
  const row = id ? await prisma.financialBudget.update({ where: { id }, data }) : await prisma.financialBudget.create({ data });
  await prisma.auditEvent.create({ data: { actorId: actor.id, actorName: actor.name, entityType: "FinancialBudget", entityId: row.id, action: id ? "BUDGET_UPDATED" : "BUDGET_CREATED", after: toPrismaJson({ metric, amount: amount.toString(), periodStart, periodEnd }) } });
  return row;
}

export async function saveRecurringRule(input: Record<string, unknown>, actor: FinanceActor) {
  const prisma = getPrisma();
  const id = text(input.id, 96);
  const name = text(input.name, 180);
  if (!name) throw new FinancialCenterV2Error("NAME_REQUIRED", "Вкажіть назву регулярної операції.");
  const amount = decimal(input.amount, "AMOUNT_REQUIRED", "Вкажіть суму регулярної операції.");
  const frequency = (text(input.frequency, 24) || "MONTHLY").toUpperCase();
  if (!["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"].includes(frequency)) throw new FinancialCenterV2Error("INVALID_FREQUENCY", "Некоректна періодичність.");
  const direction = (text(input.direction, 16) || "OUTFLOW").toUpperCase();
  if (!["INFLOW", "OUTFLOW"].includes(direction)) throw new FinancialCenterV2Error("INVALID_DIRECTION", "Некоректний напрям операції.");
  const startAt = parseDate(input.startAt, "START_REQUIRED", "Вкажіть дату початку.", new Date());
  const nextOccurrenceAt = parseDate(input.nextOccurrenceAt, "NEXT_DATE_REQUIRED", "Вкажіть наступну дату.", startAt);
  const endAt = input.endAt ? parseDate(input.endAt, "INVALID_END_DATE", "Некоректна дата завершення.") : null;
  const intervalCount = Math.max(1, Math.min(120, Number(input.intervalCount || 1)));
  const data = {
    name, direction, amount, currency: (text(input.currency, 3) || "UAH").toUpperCase(), frequency, intervalCount,
    dayOfMonth: input.dayOfMonth == null ? null : Math.max(1, Math.min(31, Number(input.dayOfMonth))),
    dayOfWeek: input.dayOfWeek == null ? null : Math.max(0, Math.min(6, Number(input.dayOfWeek))),
    startAt, endAt, nextOccurrenceAt, categoryId: text(input.categoryId, 80), costCenterId: text(input.costCenterId, 80), locationId: text(input.locationId, 64),
    counterpartyName: text(input.counterpartyName, 240), moneyAccountId: text(input.moneyAccountId, 64), description: text(input.description, 4000),
    isActive: input.isActive !== false, autoPost: input.autoPost === true, createdById: actor.id,
  };
  const row = id ? await prisma.recurringFinancialRule.update({ where: { id }, data }) : await prisma.recurringFinancialRule.create({ data });
  await prisma.auditEvent.create({ data: { actorId: actor.id, actorName: actor.name, entityType: "RecurringFinancialRule", entityId: row.id, action: id ? "RECURRING_RULE_UPDATED" : "RECURRING_RULE_CREATED", after: toPrismaJson({ name, amount: amount.toString(), frequency, direction, nextOccurrenceAt }) } });
  return row;
}

export async function saveForecastItem(input: Record<string, unknown>, actor: FinanceActor) {
  const prisma = getPrisma();
  const id = text(input.id, 96);
  const direction = (text(input.direction, 16) || "INFLOW").toUpperCase();
  if (!["INFLOW", "OUTFLOW"].includes(direction)) throw new FinancialCenterV2Error("INVALID_DIRECTION", "Некоректний напрям прогнозу.");
  const amount = decimal(input.amount, "AMOUNT_REQUIRED", "Вкажіть суму прогнозу.");
  const expectedAt = parseDate(input.expectedAt, "EXPECTED_DATE_REQUIRED", "Вкажіть очікувану дату.");
  const probability = Math.max(0, Math.min(100, Number(input.probability ?? 100)));
  const data = {
    direction, amount, expectedAt, probability, currency: (text(input.currency, 3) || "UAH").toUpperCase(),
    status: text(input.status, 24) || "PLANNED", categoryId: text(input.categoryId, 80), costCenterId: text(input.costCenterId, 80), locationId: text(input.locationId, 64),
    moneyAccountId: text(input.moneyAccountId, 64), counterpartyName: text(input.counterpartyName, 240), sourceEntity: text(input.sourceEntity, 40), sourceEntityId: text(input.sourceEntityId, 96),
    description: text(input.description, 4000), createdById: actor.id,
  };
  const row = id ? await prisma.financialForecastItem.update({ where: { id }, data }) : await prisma.financialForecastItem.create({ data });
  await prisma.auditEvent.create({ data: { actorId: actor.id, actorName: actor.name, entityType: "FinancialForecastItem", entityId: row.id, action: id ? "FORECAST_UPDATED" : "FORECAST_CREATED", after: toPrismaJson({ amount: amount.toString(), expectedAt, direction, probability }) } });
  return row;
}

export async function createFinancialCategory(input: Record<string, unknown>, actor: FinanceActor) {
  const prisma = getPrisma();
  const name = text(input.name, 180);
  if (!name) throw new FinancialCenterV2Error("NAME_REQUIRED", "Вкажіть назву категорії.");
  const rawCode = text(input.code, 80) || name;
  const code = rawCode.toUpperCase().replace(/[^A-ZА-ЯІЇЄ0-9]+/giu, "_").replace(/^_+|_+$/g, "").slice(0, 80) || `CUSTOM_${Date.now()}`;
  const pnlSectionRaw = text(input.pnlSection, 32)?.toUpperCase() || null;
  const pnlSections = ["REVENUE", "COGS", "OPEX", "OTHER_INCOME", "OTHER_EXPENSE", "TAX"];
  if (pnlSectionRaw && !pnlSections.includes(pnlSectionRaw)) throw new FinancialCenterV2Error("INVALID_PNL_SECTION", "Некоректна секція P&L.");
  const cashFlowRaw = text(input.cashFlowSection, 32)?.toUpperCase() || "OPERATING";
  const cashSections = ["OPERATING", "INVESTING", "FINANCING", "INTERNAL_TRANSFER"];
  if (!cashSections.includes(cashFlowRaw)) throw new FinancialCenterV2Error("INVALID_CASH_SECTION", "Некоректна секція Cash Flow.");
  const parentId = text(input.parentId, 96);
  if (parentId) {
    const parent = await prisma.financialCategory.findUnique({ where: { id: parentId } });
    if (!parent || !parent.isActive) throw new FinancialCenterV2Error("PARENT_NOT_FOUND", "Батьківську категорію не знайдено.", 404);
  }
  const existing = await prisma.financialCategory.findUnique({ where: { code } });
  if (existing) throw new FinancialCenterV2Error("CATEGORY_CODE_EXISTS", "Категорія з таким кодом уже існує.", 409);
  const row = await prisma.financialCategory.create({
    data: { code, name, pnlSection: pnlSectionRaw as never, cashFlowSection: cashFlowRaw as never, parentId, isSystem: false, isActive: true, sortOrder: Number(input.sortOrder || 500) },
  });
  await prisma.auditEvent.create({ data: { actorId: actor.id, actorName: actor.name, entityType: "FinancialCategory", entityId: row.id, action: "FINANCE_CATEGORY_CREATED", after: toPrismaJson({ code, name, pnlSection: pnlSectionRaw, cashFlowSection: cashFlowRaw, parentId }) } });
  return row;
}

export async function saveFinancialSettings(input: Record<string, unknown>, actor: FinanceActor) {
  const prisma = getPrisma();
  const locationId = text(input.locationId, 64);
  const scopeKey = locationId ? `LOCATION:${locationId}` : "GLOBAL";
  const minimumCashReserve = optionalDecimal(input.minimumCashReserve) ?? new Prisma.Decimal(0);
  const fixedMonthlyCosts = optionalDecimal(input.fixedMonthlyCosts) ?? new Prisma.Decimal(0);
  const targetGrossMarginPercent = optionalDecimal(input.targetGrossMarginPercent) ?? new Prisma.Decimal(40);
  const warningGrossMarginPercent = optionalDecimal(input.warningGrossMarginPercent) ?? new Prisma.Decimal(25);
  const forecastHorizonDays = Math.max(30, Math.min(365, Number(input.forecastHorizonDays || 90)));
  const row = await prisma.financialSettings.upsert({
    where: { scopeKey },
    update: { locationId, defaultCurrency: (text(input.defaultCurrency, 3) || "UAH").toUpperCase(), minimumCashReserve, fixedMonthlyCosts, targetGrossMarginPercent, warningGrossMarginPercent, forecastHorizonDays, updatedById: actor.id },
    create: { scopeKey, locationId, defaultCurrency: (text(input.defaultCurrency, 3) || "UAH").toUpperCase(), minimumCashReserve, fixedMonthlyCosts, targetGrossMarginPercent, warningGrossMarginPercent, forecastHorizonDays, updatedById: actor.id },
  });
  await prisma.auditEvent.create({ data: { actorId: actor.id, actorName: actor.name, entityType: "FinancialSettings", entityId: row.id, action: "FINANCE_SETTINGS_UPDATED", after: toPrismaJson({ scopeKey, minimumCashReserve: minimumCashReserve.toString(), fixedMonthlyCosts: fixedMonthlyCosts.toString(), targetGrossMarginPercent: targetGrossMarginPercent.toString(), warningGrossMarginPercent: warningGrossMarginPercent.toString(), forecastHorizonDays }) } });
  return row;
}

export async function addExpenseAttachment(input: Record<string, unknown>, actor: FinanceActor) {
  const prisma = getPrisma();
  const expenseDocumentId = text(input.expenseDocumentId, 96);
  const fileName = text(input.fileName, 240);
  const mimeType = text(input.mimeType, 120);
  const url = text(input.url, 4000);
  if (!expenseDocumentId || !fileName || !mimeType || !url) throw new FinancialCenterV2Error("ATTACHMENT_FIELDS_REQUIRED", "Для вкладення потрібні витрата, назва, MIME-тип і URL.");
  const expense = await prisma.expenseDocument.findUnique({ where: { id: expenseDocumentId }, select: { id: true } });
  if (!expense) throw new FinancialCenterV2Error("EXPENSE_NOT_FOUND", "Витрату не знайдено.", 404);
  const row = await prisma.expenseAttachment.create({ data: { expenseDocumentId, fileName, mimeType, url, sizeBytes: input.sizeBytes == null ? null : Math.max(0, Number(input.sizeBytes)), uploadedById: actor.id } });
  await prisma.auditEvent.create({ data: { actorId: actor.id, actorName: actor.name, entityType: "ExpenseDocument", entityId: expenseDocumentId, action: "EXPENSE_ATTACHMENT_ADDED", after: toPrismaJson({ attachmentId: row.id, fileName, mimeType }) } });
  return row;
}

export async function createCustomerAdvance(input: Record<string, unknown>, actor: FinanceActor) {
  const prisma = getPrisma();
  const clientId = text(input.clientId, 64);
  const moneyAccountId = text(input.moneyAccountId, 64);
  if (!clientId || !moneyAccountId) throw new FinancialCenterV2Error("ADVANCE_FIELDS_REQUIRED", "Для авансу потрібні клієнт і рахунок.");
  const amount = decimal(input.amount, "AMOUNT_REQUIRED", "Вкажіть суму авансу.");
  const receivedAt = parseDate(input.receivedAt, "INVALID_DATE", "Некоректна дата авансу.", new Date());
  const currency = (text(input.currency, 3) || "UAH").toUpperCase();
  const idempotencyKey = text(input.idempotencyKey, 96) || `advance:${clientId}:${Date.now()}`;
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `customer-advance:${idempotencyKey}`);
    const existingCash = await tx.cashTransaction.findFirst({ where: { sourceEntity: "CUSTOMER_ADVANCE", sourceEntityId: idempotencyKey } });
    if (existingCash) {
      const advance = await tx.customerAdvance.findUnique({ where: { cashTransactionId: existingCash.id } });
      return { cash: existingCash, advance, reused: true };
    }
    const account = await tx.moneyAccount.findUnique({ where: { id: moneyAccountId } });
    if (!account?.isActive) throw new FinancialCenterV2Error("ACCOUNT_NOT_FOUND", "Рахунок не знайдено.", 404);
    if (account.currency !== currency) throw new FinancialCenterV2Error("CURRENCY_MISMATCH", "Валюта рахунку не відповідає валюті авансу.");
    const cash = await tx.cashTransaction.create({
      data: { kind: "INFLOW", status: "POSTED", flowSection: "OPERATING", amount, currency, occurredAt: receivedAt, toAccountId: moneyAccountId, clientId, workOrderId: text(input.workOrderId, 64), locationId: text(input.locationId, 64), sourceEntity: "CUSTOMER_ADVANCE", sourceEntityId: idempotencyKey, description: text(input.description, 4000) || "Аванс клієнта", createdById: actor.id, postedAt: receivedAt },
    });
    const advance = await tx.customerAdvance.create({ data: { clientId, workOrderId: text(input.workOrderId, 64), amount, currency, receivedAt, moneyAccountId, locationId: text(input.locationId, 64), cashTransactionId: cash.id, description: text(input.description, 4000), createdById: actor.id } });
    await tx.auditEvent.create({ data: { actorId: actor.id, actorName: actor.name, entityType: "CustomerAdvance", entityId: advance.id, action: "CUSTOMER_ADVANCE_RECEIVED", after: toPrismaJson({ amount: amount.toString(), clientId, workOrderId: advance.workOrderId, cashTransactionId: cash.id }) } });
    return { cash, advance, reused: false };
  });
}
