import "server-only";

import { Prisma } from "@/src/generated/prisma/client";
import { acquireTransactionAdvisoryLock } from "@/src/lib/advisory-lock";
import { decimalToNumber, roundMoney } from "@/src/domain/finance";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { zonedDateKey, zonedDayRange } from "@/src/lib/zoned-time";
import {
  FinancialCenterV2Error,
  type FinanceActor,
  type FinancialCenterScope,
} from "@/src/services/financial-center-v2.service";

const KYIV_TZ = "Europe/Kyiv";
const DAY_MS = 86_400_000;

type BaseBudget = {
  metric: string;
  amount: number;
  actual: number;
  completionPercent: number | null;
};

type BaseView = {
  kpi: {
    currentCash: number;
    revenue: number;
    grossProfit: number;
    netProfit: number;
    cashFlow: number;
    grossMarginPercent: number | null;
    receivables: number;
    payables: number;
    overdueReceivables: number;
    overduePayables: number;
  };
  pnl: {
    revenue: number;
    cogs: number;
    grossProfit: number;
    opex: number;
    netProfit: number;
    grossMarginPercent: number | null;
    events: Array<{
      id: string;
      pnlSection: string;
      amount: number;
      recognizedAt: Date | string;
      workOrderId: string | null;
      sourceEntity?: string | null;
      sourceEntityId?: string | null;
      description?: string | null;
    }>;
  };
  cashFlow: {
    inflow: number;
    outflow: number;
    net: number;
  };
  comparison: {
    revenue: { previous: number };
    opex: { previous: number };
  };
  settings: {
    fixedMonthlyCosts: number;
    targetGrossMarginPercent: number;
    warningGrossMarginPercent: number;
  };
  budgets: BaseBudget[];
  breakEven: {
    breakEvenRevenue: number | null;
  };
  accounts: Array<{
    id: string;
    name: string;
    type: string;
    locationId: string | null;
    openingBalance: number;
    balance: number;
  }>;
  calendar: Array<{
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
  }>;
  forecast: {
    points: Array<{
      date: string;
      inflow: number;
      outflow: number;
      net: number;
      closingCash: number;
      belowReserve: boolean;
    }>;
    minimumForecastCash: number;
    firstGap: { date: string; closingCash: number } | null;
    firstReserveWarning: { date: string; closingCash: number } | null;
  };
  profitability: {
    workOrders: Array<{
      workOrderId: string;
      client: string | null;
      vehicle: string | null;
      plateNumber: string | null;
      revenue: number;
      directCost: number;
      grossProfit: number;
      marginPercent: number | null;
      laborRevenue: number;
      partsRevenue: number;
      partsCost: number;
      laborCost: number;
    }>;
    parts: Array<{
      name: string;
      brand: string | null;
      article: string | null;
      supplierId: string | null;
      quantity: number;
      revenue: number;
      directCost: number;
      profit: number;
      marginPercent: number | null;
    }>;
    mechanics: Array<{
      mechanicId: string;
      name: string;
      position: string | null;
      revenue: number;
      directCost: number;
      profit: number;
      marginPercent: number | null;
    }>;
    suppliers: Array<{
      supplierId: string;
      name: string;
      revenue: number;
      directCost: number;
      profit: number;
      marginPercent: number | null;
    }>;
  };
};

function locationWhere(scope: FinancialCenterScope) {
  if (scope.locationId) return { locationId: scope.locationId };
  if (scope.allowedLocationIds?.length) return { locationId: { in: scope.allowedLocationIds } };
  return {};
}

function locationSql(scope: FinancialCenterScope, alias: string) {
  if (scope.locationId) return Prisma.sql`AND ${Prisma.raw(alias)}."locationId" = ${scope.locationId}`;
  if (scope.allowedLocationIds?.length) {
    return Prisma.sql`AND ${Prisma.raw(alias)}."locationId" IN (${Prisma.join(scope.allowedLocationIds)})`;
  }
  return Prisma.empty;
}

function asMoney(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? roundMoney(parsed) : 0;
}

function marginRow(label: string, revenue: number, directCost: number, warning: number, target: number, costTracked = true) {
  const grossProfit = roundMoney(revenue - directCost);
  const marginPercent = revenue > 0 && costTracked ? roundMoney((grossProfit / revenue) * 100) : null;
  return {
    label,
    revenue: roundMoney(revenue),
    directCost: roundMoney(directCost),
    grossProfit,
    marginPercent,
    costTracked,
    state: marginPercent == null ? "UNKNOWN" : marginPercent < warning ? "LOW" : marginPercent < target ? "WATCH" : "GOOD",
  };
}

function planMetric(args: {
  metric: string;
  label: string;
  actual: number;
  explicit: BaseBudget | undefined;
  automatic: number;
  elapsedShare: number;
}) {
  const plan = args.explicit ? args.explicit.amount : args.automatic;
  const source = args.explicit ? "BUDGET" : plan > 0 ? "AUTO" : "NONE";
  const completionPercent = plan > 0 ? roundMoney((args.actual / plan) * 100) : null;
  const paceForecast = args.elapsedShare > 0 ? roundMoney(args.actual / args.elapsedShare) : args.actual;
  const projectedCompletionPercent = plan > 0 ? roundMoney((paceForecast / plan) * 100) : null;
  return {
    metric: args.metric,
    label: args.label,
    source,
    plan: roundMoney(plan),
    actual: roundMoney(args.actual),
    variance: roundMoney(args.actual - plan),
    completionPercent,
    paceForecast,
    projectedCompletionPercent,
  };
}

function dayPoint(points: BaseView["forecast"]["points"], days: number) {
  if (!points.length) return null;
  const target = new Date();
  target.setUTCDate(target.getUTCDate() + days);
  const key = target.toISOString().slice(0, 10);
  return points.find((point) => point.date >= key) || points[points.length - 1] || null;
}

async function reconciliation(scope: FinancialCenterScope) {
  const prisma = getPrisma();
  const currency = (scope.currency || "UAH").toUpperCase();
  const obligationLocation = locationSql(scope, "fo");
  const cashLocation = locationSql(scope, "ct");
  const eventLocation = locationSql(scope, "fe");

  const inconsistent = await prisma.$queryRaw<Array<{
    id: string;
    direction: string;
    status: string;
    amount: Prisma.Decimal;
    settledAmount: Prisma.Decimal;
  }>>(Prisma.sql`
    SELECT fo."id", fo."direction"::text AS direction, fo."status"::text AS status,
           fo."amount", fo."settledAmount"
      FROM "FinancialObligation" fo
     WHERE fo."currency" = ${currency}
       AND fo."status"::text <> 'CANCELLED'
       ${obligationLocation}
       AND (
         (fo."status"::text = 'PAID' AND fo."settledAmount" < fo."amount")
         OR (fo."status"::text IN ('OPEN','PARTIALLY_PAID','OVERDUE') AND fo."amount" > 0 AND fo."settledAmount" >= fo."amount")
         OR fo."settledAmount" > fo."amount"
       )
     ORDER BY fo."updatedAt" DESC
     LIMIT 50
  `);

  const walkInPaymentWithoutRevenue = await prisma.$queryRaw<Array<{ id: string; amount: Prisma.Decimal; sourceEntityId: string | null }>>(Prisma.sql`
    SELECT ct."id", ct."amount", ct."sourceEntityId"
      FROM "CashTransaction" ct
     WHERE ct."status"::text = 'POSTED'
       AND ct."sourceEntity" = 'WALK_IN_DIAGNOSTIC_PAYMENT'
       ${cashLocation}
       AND NOT EXISTS (
         SELECT 1
           FROM "FinancialEvent" fe
          WHERE fe."status"::text = 'POSTED'
            AND fe."sourceEntity" = 'WALK_IN_DIAGNOSTIC'
            AND fe."sourceEntityId" = replace(ct."sourceEntityId", ':payment', ':revenue')
       )
     ORDER BY ct."occurredAt" DESC
     LIMIT 50
  `);

  const walkInRevenueWithoutReceivable = await prisma.$queryRaw<Array<{ id: string; amount: Prisma.Decimal; sourceEntityId: string | null }>>(Prisma.sql`
    SELECT fe."id", fe."amount", fe."sourceEntityId"
      FROM "FinancialEvent" fe
     WHERE fe."status"::text = 'POSTED'
       AND fe."sourceEntity" = 'WALK_IN_DIAGNOSTIC'
       ${eventLocation}
       AND NOT EXISTS (
         SELECT 1
           FROM "FinancialObligation" fo
          WHERE fo."direction"::text = 'RECEIVABLE'
            AND fo."status"::text <> 'CANCELLED'
            AND fo."sourceEntity" = 'WALK_IN_DIAGNOSTIC'
            AND fo."sourceEntityId" = replace(fe."sourceEntityId", ':revenue', ':receivable')
       )
     ORDER BY fe."recognizedAt" DESC
     LIMIT 50
  `);

  const walkInPaidWithoutPayment = await prisma.$queryRaw<Array<{ id: string; amount: Prisma.Decimal; sourceEntityId: string | null }>>(Prisma.sql`
    SELECT fo."id", fo."amount", fo."sourceEntityId"
      FROM "FinancialObligation" fo
     WHERE fo."direction"::text = 'RECEIVABLE'
       AND fo."status"::text = 'PAID'
       AND fo."sourceEntity" = 'WALK_IN_DIAGNOSTIC'
       ${obligationLocation}
       AND NOT EXISTS (
         SELECT 1
           FROM "CashTransaction" ct
          WHERE ct."status"::text = 'POSTED'
            AND ct."sourceEntity" = 'WALK_IN_DIAGNOSTIC_PAYMENT'
            AND ct."sourceEntityId" = replace(fo."sourceEntityId", ':receivable', ':payment')
       )
     ORDER BY fo."updatedAt" DESC
     LIMIT 50
  `);

  const issues: Array<{
    code: string;
    level: "WARNING" | "CRITICAL";
    title: string;
    message: string;
    count: number;
    amount: number;
    samples: string[];
  }> = [];

  if (inconsistent.length) {
    issues.push({
      code: "OBLIGATION_STATE_MISMATCH",
      level: "CRITICAL",
      title: "Статус боргу не відповідає сумі",
      message: "Є зобов'язання, де статус PAID/OPEN/PARTIALLY_PAID не відповідає amount та settledAmount.",
      count: inconsistent.length,
      amount: roundMoney(inconsistent.reduce((sum, row) => sum + Math.abs(decimalToNumber(row.amount) - decimalToNumber(row.settledAmount)), 0)),
      samples: inconsistent.slice(0, 10).map((row) => row.id),
    });
  }
  if (walkInPaymentWithoutRevenue.length) {
    issues.push({
      code: "WALKIN_PAYMENT_WITHOUT_REVENUE",
      level: "CRITICAL",
      title: "Оплата WALK-IN без виручки",
      message: "Гроші отримані, але corresponding P&L revenue event не знайдено.",
      count: walkInPaymentWithoutRevenue.length,
      amount: roundMoney(walkInPaymentWithoutRevenue.reduce((sum, row) => sum + decimalToNumber(row.amount), 0)),
      samples: walkInPaymentWithoutRevenue.slice(0, 10).map((row) => row.sourceEntityId || row.id),
    });
  }
  if (walkInRevenueWithoutReceivable.length) {
    issues.push({
      code: "WALKIN_REVENUE_WITHOUT_RECEIVABLE",
      level: "WARNING",
      title: "Виручка WALK-IN без дебіторки",
      message: "Послугу визнано у P&L, але фактичне зобов'язання клієнта не знайдено.",
      count: walkInRevenueWithoutReceivable.length,
      amount: roundMoney(walkInRevenueWithoutReceivable.reduce((sum, row) => sum + decimalToNumber(row.amount), 0)),
      samples: walkInRevenueWithoutReceivable.slice(0, 10).map((row) => row.sourceEntityId || row.id),
    });
  }
  if (walkInPaidWithoutPayment.length) {
    issues.push({
      code: "WALKIN_PAID_WITHOUT_CASH",
      level: "CRITICAL",
      title: "WALK-IN позначений оплаченим без руху грошей",
      message: "Receivable має статус PAID, але POSTED CashTransaction не знайдено.",
      count: walkInPaidWithoutPayment.length,
      amount: roundMoney(walkInPaidWithoutPayment.reduce((sum, row) => sum + decimalToNumber(row.amount), 0)),
      samples: walkInPaidWithoutPayment.slice(0, 10).map((row) => row.sourceEntityId || row.id),
    });
  }

  const criticalCount = issues.filter((item) => item.level === "CRITICAL").reduce((sum, item) => sum + item.count, 0);
  const warningCount = issues.filter((item) => item.level === "WARNING").reduce((sum, item) => sum + item.count, 0);
  return {
    status: criticalCount > 0 ? "CRITICAL" as const : warningCount > 0 ? "WARNING" as const : "OK" as const,
    issueCount: criticalCount + warningCount,
    criticalCount,
    warningCount,
    issues,
  };
}

async function today(scope: FinancialCenterScope) {
  const prisma = getPrisma();
  const day = zonedDateKey(new Date(), KYIV_TZ);
  const range = zonedDayRange(day, KYIV_TZ);
  const currency = (scope.currency || "UAH").toUpperCase();
  const location = locationWhere(scope);

  const [events, cash, obligations] = await Promise.all([
    prisma.financialEvent.findMany({
      where: { status: "POSTED", currency, recognizedAt: { gte: range.from, lt: range.to }, ...location },
      select: { pnlSection: true, amount: true },
    }),
    prisma.cashTransaction.findMany({
      where: { status: "POSTED", currency, occurredAt: { gte: range.from, lt: range.to }, ...location },
      select: { kind: true, amount: true, obligation: { select: { direction: true } } },
    }),
    prisma.financialObligation.findMany({
      where: { currency, issuedAt: { gte: range.from, lt: range.to }, direction: "RECEIVABLE", status: { not: "CANCELLED" }, ...location },
      select: { amount: true, settledAmount: true },
    }),
  ]);

  const revenue = roundMoney(events.filter((row) => row.pnlSection === "REVENUE").reduce((sum, row) => sum + decimalToNumber(row.amount), 0));
  const cashIn = roundMoney(cash.filter((row) => row.kind === "INFLOW").reduce((sum, row) => sum + decimalToNumber(row.amount), 0));
  const cashOut = roundMoney(cash.filter((row) => row.kind === "OUTFLOW").reduce((sum, row) => sum + decimalToNumber(row.amount), 0));
  const receivablesCreated = roundMoney(obligations.reduce((sum, row) => sum + decimalToNumber(row.amount), 0));
  const receivablesCollected = roundMoney(cash
    .filter((row) => row.kind === "INFLOW" && row.obligation?.direction === "RECEIVABLE")
    .reduce((sum, row) => sum + decimalToNumber(row.amount), 0));

  return {
    date: day,
    revenue,
    cashIn,
    cashOut,
    netCashFlow: roundMoney(cashIn - cashOut),
    receivablesCreated,
    receivablesCollected,
  };
}

async function cashCloseState(scope: FinancialCenterScope, base: BaseView) {
  const prisma = getPrisma();
  const cashAccounts = base.accounts.filter((account) => account.type === "CASH");
  const ids = cashAccounts.map((account) => account.id);
  const businessDate = new Date(`${zonedDateKey(new Date(), KYIV_TZ)}T00:00:00.000Z`);
  const todayRows = ids.length ? await prisma.financialCashClose.findMany({
    where: { moneyAccountId: { in: ids }, businessDate },
    orderBy: { closedAt: "desc" },
  }) : [];
  const history = ids.length ? await prisma.financialCashClose.findMany({
    where: { moneyAccountId: { in: ids } },
    orderBy: [{ businessDate: "desc" }, { closedAt: "desc" }],
    take: 20,
  }) : [];
  const accountById = new Map(cashAccounts.map((account) => [account.id, account]));
  return {
    businessDate: zonedDateKey(new Date(), KYIV_TZ),
    accounts: cashAccounts.map((account) => {
      const close = todayRows.find((row) => row.moneyAccountId === account.id) || null;
      return {
        ...account,
        close: close ? {
          id: close.id,
          systemAmount: decimalToNumber(close.systemAmount),
          countedAmount: decimalToNumber(close.countedAmount),
          difference: decimalToNumber(close.difference),
          note: close.note,
          closedAt: close.closedAt.toISOString(),
        } : null,
      };
    }),
    recent: history.map((row) => ({
      id: row.id,
      businessDate: row.businessDate.toISOString().slice(0, 10),
      moneyAccountId: row.moneyAccountId,
      accountName: accountById.get(row.moneyAccountId)?.name || row.moneyAccountId,
      systemAmount: decimalToNumber(row.systemAmount),
      countedAmount: decimalToNumber(row.countedAmount),
      difference: decimalToNumber(row.difference),
      note: row.note,
      closedAt: row.closedAt.toISOString(),
    })),
  };
}

async function capacityState(scope: FinancialCenterScope) {
  const prisma = getPrisma();
  const posts = await prisma.servicePost.findMany({
    where: { isActive: true, ...locationWhere(scope) },
    select: {
      id: true,
      name: true,
      locationId: true,
      sortOrder: true,
      location: { select: { name: true, openMinute: true, closeMinute: true } },
    },
    orderBy: [{ locationId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });
  const view = posts.map((post) => ({
    id: post.id,
    name: post.name,
    locationId: post.locationId,
    locationName: post.location.name,
    dailyMinutes: Math.max(0, post.location.closeMinute - post.location.openMinute),
  }));
  return {
    activePosts: view.length,
    totalDailyMinutes: view.reduce((sum, post) => sum + post.dailyMinutes, 0),
    posts: view,
  };
}

export async function getFinancialCenterV3Control(scope: FinancialCenterScope, base: BaseView) {
  const [todayView, reconciliationView, cashClose, capacity] = await Promise.all([
    today(scope),
    reconciliation(scope),
    cashCloseState(scope, base),
    capacityState(scope),
  ]);

  const warning = base.settings.warningGrossMarginPercent;
  const target = base.settings.targetGrossMarginPercent;
  const laborRevenue = base.profitability.workOrders.reduce((sum, row) => sum + row.laborRevenue, 0);
  const laborCost = base.profitability.workOrders.reduce((sum, row) => sum + row.laborCost, 0);
  const partsRevenue = base.profitability.workOrders.reduce((sum, row) => sum + row.partsRevenue, 0);
  const partsCost = base.profitability.workOrders.reduce((sum, row) => sum + row.partsCost, 0);
  const diagnosticRevenue = base.pnl.events
    .filter((row) => row.pnlSection === "REVENUE" && row.sourceEntity === "WALK_IN_DIAGNOSTIC")
    .reduce((sum, row) => sum + row.amount, 0);

  const margins = [
    marginRow("Роботи", laborRevenue, laborCost, warning, target),
    marginRow("Запчастини", partsRevenue, partsCost, warning, target),
    marginRow("Діагностика", diagnosticRevenue, 0, warning, target, false),
    marginRow("Загалом", base.pnl.revenue, base.pnl.cogs, warning, target),
  ];

  const periodMs = Math.max(DAY_MS, scope.to.getTime() - scope.from.getTime());
  const elapsedMs = Math.min(periodMs, Math.max(0, Date.now() - scope.from.getTime()));
  const elapsedShare = Math.max(1 / Math.max(1, periodMs / DAY_MS), Math.min(1, elapsedMs / periodMs));
  const explicit = new Map(base.budgets.map((row) => [row.metric, row]));
  const periodDays = Math.max(1, periodMs / DAY_MS);
  const fixedCostPlan = base.settings.fixedMonthlyCosts > 0
    ? roundMoney(base.settings.fixedMonthlyCosts * periodDays / 30.44)
    : base.comparison.opex.previous;
  const revenueAuto = Math.max(base.comparison.revenue.previous || 0, base.breakEven.breakEvenRevenue || 0);
  const grossProfitAuto = roundMoney(revenueAuto * base.settings.targetGrossMarginPercent / 100);
  const cashFlowAuto = roundMoney(grossProfitAuto - fixedCostPlan);
  const plan = [
    planMetric({ metric: "REVENUE", label: "Виручка", actual: base.pnl.revenue, explicit: explicit.get("REVENUE"), automatic: revenueAuto, elapsedShare }),
    planMetric({ metric: "GROSS_PROFIT", label: "Валовий прибуток", actual: base.pnl.grossProfit, explicit: explicit.get("GROSS_PROFIT"), automatic: grossProfitAuto, elapsedShare }),
    planMetric({ metric: "OPEX", label: "Операційні витрати", actual: base.pnl.opex, explicit: explicit.get("OPEX"), automatic: fixedCostPlan, elapsedShare }),
    planMetric({ metric: "CASH_FLOW", label: "Рух грошей", actual: base.cashFlow.net, explicit: explicit.get("CASH_FLOW"), automatic: cashFlowAuto, elapsedShare }),
  ];

  const minPoint = base.forecast.points.reduce<(typeof base.forecast.points)[number] | null>((min, point) => !min || point.closingCash < min.closingCash ? point : min, null);
  const minDrivers = minPoint
    ? base.calendar.filter((item) => item.expectedAt.slice(0, 10) === minPoint.date)
        .sort((a, b) => b.weightedAmount - a.weightedAmount)
        .slice(0, 3)
    : [];
  const in7 = dayPoint(base.forecast.points, 7);
  const in30 = dayPoint(base.forecast.points, 30);

  const workOrdersByProfit = [...base.profitability.workOrders].sort((a, b) => b.grossProfit - a.grossProfit);
  const losingOrders = base.profitability.workOrders.filter((row) => row.grossProfit < 0).sort((a, b) => a.grossProfit - b.grossProfit);
  const lowMarginParts = base.profitability.parts.filter((row) => row.marginPercent != null && row.marginPercent < warning).sort((a, b) => (a.marginPercent || 0) - (b.marginPercent || 0));
  const topMechanic = [...base.profitability.mechanics].sort((a, b) => b.profit - a.profit)[0] || null;
  const topSupplier = [...base.profitability.suppliers].filter((row) => row.revenue > 0).sort((a, b) => (b.marginPercent || -Infinity) - (a.marginPercent || -Infinity))[0] || null;

  return {
    today: todayView,
    reconciliation: reconciliationView,
    margins,
    plan: {
      elapsedPercent: roundMoney(elapsedShare * 100),
      metrics: plan,
    },
    forecast: {
      currentCash: base.kpi.currentCash,
      in7Days: in7?.closingCash ?? base.kpi.currentCash,
      in30Days: in30?.closingCash ?? in7?.closingCash ?? base.kpi.currentCash,
      minimum: minPoint ? { date: minPoint.date, closingCash: minPoint.closingCash } : null,
      firstGap: base.forecast.firstGap,
      firstReserveWarning: base.forecast.firstReserveWarning,
      drivers: minDrivers,
    },
    profitability: {
      topWorkOrder: workOrdersByProfit[0] || null,
      losingWorkOrders: losingOrders.slice(0, 20),
      losingCount: losingOrders.length,
      lowMarginParts: lowMarginParts.slice(0, 20),
      lowMarginPartsCount: lowMarginParts.length,
      topMechanic,
      topSupplier,
    },
    capacity,
    cashClose,
  };
}

export async function closeFinanceCashDay(
  input: Record<string, unknown>,
  actor: FinanceActor,
) {
  const prisma = getPrisma();
  const moneyAccountId = typeof input.moneyAccountId === "string" ? input.moneyAccountId.trim().slice(0, 64) : "";
  if (!moneyAccountId) throw new FinancialCenterV2Error("ACCOUNT_REQUIRED", "Оберіть касу.", 400);

  const rawCounted = typeof input.countedAmount === "string" ? input.countedAmount.replace(",", ".") : input.countedAmount;
  let countedAmount: Prisma.Decimal;
  try {
    countedAmount = new Prisma.Decimal(String(rawCounted)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  } catch {
    throw new FinancialCenterV2Error("COUNTED_AMOUNT_INVALID", "Вкажіть фактичну суму в касі.", 400);
  }
  if (!countedAmount.isFinite() || countedAmount.lessThan(0)) {
    throw new FinancialCenterV2Error("COUNTED_AMOUNT_INVALID", "Фактична сума не може бути від'ємною.", 400);
  }

  const businessDateKey = typeof input.businessDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.businessDate)
    ? input.businessDate
    : zonedDateKey(new Date(), KYIV_TZ);
  const businessDate = new Date(`${businessDateKey}T00:00:00.000Z`);
  const businessRange = zonedDayRange(businessDateKey, KYIV_TZ);
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 4000) : null;

  return prisma.$transaction(async (tx) => {
    await acquireTransactionAdvisoryLock(tx, `finance-cash-close:${moneyAccountId}:${businessDateKey}`);
    const account = await tx.moneyAccount.findUnique({ where: { id: moneyAccountId } });
    if (!account || !account.isActive) throw new FinancialCenterV2Error("ACCOUNT_NOT_FOUND", "Активну касу не знайдено.", 404);
    if (account.type !== "CASH") throw new FinancialCenterV2Error("CASH_ACCOUNT_REQUIRED", "Закриття дня доступне тільки для каси.", 409);

    const rows = await tx.$queryRaw<Array<{ balance: Prisma.Decimal }>>(Prisma.sql`
      SELECT (
        ma."openingBalance"
        + COALESCE(SUM(
          CASE
            WHEN ct."kind"::text = 'INFLOW' AND ct."toAccountId" = ma."id" THEN ct."amount"
            WHEN ct."kind"::text = 'OUTFLOW' AND ct."fromAccountId" = ma."id" THEN -ct."amount"
            WHEN ct."kind"::text = 'TRANSFER' AND ct."toAccountId" = ma."id" THEN ct."amount"
            WHEN ct."kind"::text = 'TRANSFER' AND ct."fromAccountId" = ma."id" THEN -ct."amount"
            ELSE 0
          END
        ), 0)
      )::numeric(14,2) AS balance
      FROM "MoneyAccount" ma
      LEFT JOIN "CashTransaction" ct
        ON ct."status"::text = 'POSTED'
       AND ct."occurredAt" < ${businessRange.to}
       AND (ct."fromAccountId" = ma."id" OR ct."toAccountId" = ma."id")
      WHERE ma."id" = ${moneyAccountId}
      GROUP BY ma."id", ma."openingBalance"
    `);
    const systemAmount = rows[0]?.balance || new Prisma.Decimal(account.openingBalance);
    const difference = countedAmount.minus(systemAmount).toDecimalPlaces(2);
    if (!difference.isZero() && !note) {
      throw new FinancialCenterV2Error("CASH_CLOSE_REASON_REQUIRED", "Вкажіть причину розбіжності між системною та фактичною касою.", 400);
    }

    const existing = await tx.financialCashClose.findFirst({ where: { moneyAccountId, businessDate } });
    const close = existing
      ? await tx.financialCashClose.update({
          where: { id: existing.id },
          data: {
            locationId: account.locationId,
            currency: account.currency,
            systemAmount,
            countedAmount,
            difference,
            note,
            closedById: actor.id,
            closedAt: new Date(),
          },
        })
      : await tx.financialCashClose.create({
          data: {
            businessDate,
            moneyAccountId,
            locationId: account.locationId,
            currency: account.currency,
            systemAmount,
            countedAmount,
            difference,
            note,
            closedById: actor.id,
            closedAt: new Date(),
          },
        });

    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        actorName: actor.name,
        entityType: "FinancialCashClose",
        entityId: close.id,
        action: existing ? "FINANCE_CASH_DAY_RECLOSED" : "FINANCE_CASH_DAY_CLOSED",
        before: existing ? toPrismaJson({
          systemAmount: existing.systemAmount.toString(),
          countedAmount: existing.countedAmount.toString(),
          difference: existing.difference.toString(),
        }) : undefined,
        after: toPrismaJson({
          businessDate: businessDateKey,
          moneyAccountId,
          systemAmount: systemAmount.toString(),
          countedAmount: countedAmount.toString(),
          difference: difference.toString(),
          note,
        }),
      },
    });

    return {
      id: close.id,
      businessDate: businessDateKey,
      moneyAccountId,
      systemAmount: decimalToNumber(systemAmount),
      countedAmount: decimalToNumber(countedAmount),
      difference: decimalToNumber(difference),
      closedAt: close.closedAt.toISOString(),
    };
  });
}
