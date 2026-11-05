import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext, hasPermission } from "@/src/security/access-context";
import { PERMISSIONS, type AccessScopeCode } from "@/src/security/permissions";
import { getFinancialCenterV2 } from "@/src/services/financial-center-v2.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const KYIV_TZ = "Europe/Kyiv";
const DAY_MS = 86_400_000;
const OWNER_PLAN_METRICS = new Set([
  "NET_INCOME",
  "SERVICE_REVENUE",
  "PARTS_MARGIN",
  "PAYROLL",
  "GROSS_INCOME",
  "TOTAL_EXPENSES",
  "CASH_BALANCE",
]);
const CLIENT_REVENUE_CODES = ["REV_LABOR", "REV_DIAGNOSTIC", "REV_DIAGNOSTICS", "REV_EXTERNAL", "REV_PARTS"];

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function numberOf(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
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
  return new Date(Date.UTC(year, month - 1, day, 0, -kyivOffsetMinutes(probe)));
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

function debtBreakdown(rows: Array<{
  status: string;
  outstanding: number;
  settledAmount: number;
  isOverdue: boolean;
}>) {
  let total = 0;
  let due = 0;
  let partial = 0;
  let overdue = 0;
  let dueCount = 0;
  let partialCount = 0;
  let overdueCount = 0;

  for (const row of rows) {
    const amount = Math.max(0, numberOf(row.outstanding));
    if (amount <= 0) continue;
    total += amount;
    if (row.isOverdue || row.status === "OVERDUE") {
      overdue += amount;
      overdueCount += 1;
    } else if (row.status === "PARTIALLY_PAID" || numberOf(row.settledAmount) > 0) {
      partial += amount;
      partialCount += 1;
    } else {
      due += amount;
      dueCount += 1;
    }
  }

  return {
    total: round(total),
    count: dueCount + partialCount + overdueCount,
    due: round(due),
    dueCount,
    partial: round(partial),
    partialCount,
    overdue: round(overdue),
    overdueCount,
  };
}

function visitKey(event: {
  workOrderId: string | null;
  sourceEntity: string | null;
  sourceEntityId: string | null;
}) {
  if (event.workOrderId) return `wo:${event.workOrderId}`;
  if (event.sourceEntity === "WALK_IN_DIAGNOSTIC" && event.sourceEntityId) {
    return `walkin:${event.sourceEntityId.replace(/:(revenue|receivable)$/, "")}`;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const context = await getAccessContext(request);
  if (context.enforcementMode === "ENFORCED" && context.provisioningState !== "ACTIVE") {
    return NextResponse.json(
      { ok: false, error: context.authenticated ? "Доступ до CRM не активований." : "Потрібна авторизація." },
      { status: context.authenticated ? 403 : 401 },
    );
  }
  if (
    context.enforcementMode === "ENFORCED"
    && (!hasPermission(context, PERMISSIONS.ANALYTICS_READ) || !hasPermission(context, PERMISSIONS.ANALYTICS_FINANCIAL_READ))
  ) {
    return NextResponse.json({ ok: false, error: "Немає доступу до фінансової аналітики." }, { status: 403 });
  }

  const today = kyivParts();
  const fallbackTo = kyivDateStartUtc(today.year, today.month, today.day + 1);
  const fallbackFrom = new Date(fallbackTo.getTime() - 30 * DAY_MS);
  const from = parseKyivDate(request.nextUrl.searchParams.get("from")) ?? fallbackFrom;
  const to = nextKyivDay(request.nextUrl.searchParams.get("to")) ?? fallbackTo;
  if (from >= to) return NextResponse.json({ ok: false, error: "INVALID_DATE_RANGE" }, { status: 400 });

  const analyticsScope = context.enforcementMode === "ENFORCED"
    ? (context.permissions[PERMISSIONS.ANALYTICS_READ] as AccessScopeCode | undefined)
    : "ALL";
  const allowedLocationIds = analyticsScope === "ALL" || context.enforcementMode !== "ENFORCED"
    ? null
    : context.locationIds;

  if (allowedLocationIds && allowedLocationIds.length === 0) {
    return NextResponse.json({ ok: true, available: false, reason: "NO_LOCATION_SCOPE" }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const data = await getFinancialCenterV2({
      from,
      to,
      currency: "UAH",
      allowedLocationIds,
    });
    const prisma = getPrisma();
    const locationWhere = allowedLocationIds?.length ? { locationId: { in: allowedLocationIds } } : {};

    const [clientRevenueEvents, cashInflows] = await Promise.all([
      prisma.financialEvent.findMany({
        where: {
          status: "POSTED",
          pnlSection: "REVENUE",
          recognizedAt: { gte: from, lt: to },
          ...locationWhere,
          OR: [
            { sourceEntity: "WALK_IN_DIAGNOSTIC" },
            { category: { is: { code: { in: CLIENT_REVENUE_CODES } } } },
          ],
        },
        select: {
          amount: true,
          recognizedAt: true,
          workOrderId: true,
          sourceEntity: true,
          sourceEntityId: true,
          category: { select: { code: true } },
        },
      }),
      prisma.cashTransaction.findMany({
        where: {
          status: "POSTED",
          kind: "INFLOW",
          flowSection: "OPERATING",
          occurredAt: { gte: from, lt: to },
          ...locationWhere,
        },
        select: { amount: true, occurredAt: true },
      }),
    ]);

    const visits = new Set<string>();
    for (const event of clientRevenueEvents) {
      const key = visitKey(event);
      if (key) visits.add(key);
    }

    const recognizedMap = new Map<string, number>();
    for (const event of clientRevenueEvents) {
      const key = dayKey(event.recognizedAt);
      recognizedMap.set(key, (recognizedMap.get(key) || 0) + numberOf(event.amount));
    }
    const cashMap = new Map<string, number>();
    for (const row of cashInflows) {
      const key = dayKey(row.occurredAt);
      cashMap.set(key, (cashMap.get(key) || 0) + numberOf(row.amount));
    }
    const trendDays = [...new Set([...recognizedMap.keys(), ...cashMap.keys()])].sort();

    const receivableRows = data.obligations.filter((row) => row.direction === "RECEIVABLE");
    const payableRows = data.obligations.filter((row) => row.direction === "PAYABLE");
    const receivables = debtBreakdown(receivableRows);
    const payables = debtBreakdown(payableRows);

    const owner = data.ownerSummary;
    const expectedGrossIncome = round(owner.serviceTurnover + owner.partsMargin);
    const expectedNetIncome = round(owner.grossIncome - owner.totalExpenses);
    const expectedPartsMargin = round(owner.partsRevenue - owner.partsCost);
    const expectedExpenses = round(
      owner.expenseBreakdown.payroll
      + owner.expenseBreakdown.otherDirect
      + owner.expenseBreakdown.otherOperating
      + owner.expenseBreakdown.otherExpense
      + owner.expenseBreakdown.tax,
    );
    const expectedCash = round(data.accounts.reduce((sum, account) => sum + numberOf(account.balance), 0));

    const checks = [
      { code: "GROSS_INCOME", label: "Валовий дохід = послуги + маржа деталей", actual: owner.grossIncome, expected: expectedGrossIncome },
      { code: "NET_INCOME", label: "Чистий дохід = валовий дохід − всі витрати", actual: owner.netIncome, expected: expectedNetIncome },
      { code: "PARTS_MARGIN", label: "Маржа деталей = продаж − собівартість", actual: owner.partsMargin, expected: expectedPartsMargin },
      { code: "TOTAL_EXPENSES", label: "Всі витрати = зарплата + інші витрати", actual: owner.totalExpenses, expected: expectedExpenses },
      { code: "CASH", label: "Гроші = сума залишків фінансових рахунків", actual: owner.cash, expected: expectedCash },
      { code: "RECEIVABLES", label: "Дебіторка = сума відкритих вимог", actual: data.kpi.receivables, expected: receivables.total },
      { code: "PAYABLES", label: "Кредиторка = сума відкритих зобов'язань", actual: data.kpi.payables, expected: payables.total },
    ].map((check) => ({ ...check, diff: round(check.actual - check.expected), ok: Math.abs(check.actual - check.expected) <= 0.01 }));

    const integrity = {
      ok: checks.every((check) => check.ok),
      issueCount: checks.filter((check) => !check.ok).length,
      checks,
    };

    const averageCheckRevenue = round(owner.serviceTurnover + owner.partsRevenue);
    const averageCheck = visits.size > 0 ? round(averageCheckRevenue / visits.size) : null;

    return NextResponse.json({
      ok: true,
      available: true,
      range: {
        from: dayKey(from),
        to: dayKey(new Date(to.getTime() - 1)),
        timezone: KYIV_TZ,
      },
      summary: {
        netIncome: owner.netIncome,
        serviceTurnover: owner.serviceTurnover,
        partsMargin: owner.partsMargin,
        payrollAccrued: owner.payrollAccrued,
        payrollDue: owner.payrollDue,
        grossIncome: owner.grossIncome,
        totalExpenses: owner.totalExpenses,
        cash: owner.cash,
        partsRevenue: owner.partsRevenue,
        partsCost: owner.partsCost,
        serviceBreakdown: owner.serviceBreakdown,
        expenseBreakdown: owner.expenseBreakdown,
      },
      cashFlow: {
        inflow: data.cashFlow.inflow,
        outflow: data.cashFlow.outflow,
        net: data.cashFlow.net,
      },
      receivables,
      payables,
      averageCheck: {
        value: averageCheck,
        recognizedRevenue: averageCheckRevenue,
        visits: visits.size,
      },
      plans: data.budgets
        .filter((row) => OWNER_PLAN_METRICS.has(row.metric))
        .map((row) => ({
          id: row.id,
          name: row.name,
          metric: row.metric,
          amount: row.amount,
          actual: row.actual,
          completionPercent: row.completionPercent,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
        })),
      trend: trendDays.map((date) => ({
        date,
        recognizedRevenue: round(recognizedMap.get(date) || 0),
        cashIn: round(cashMap.get(date) || 0),
      })),
      integrity,
      dataQuality: {
        score: integrity.ok ? data.financeCompleteness.score : Math.min(data.financeCompleteness.score, 85),
        status: integrity.ok ? data.financeCompleteness.status : "LOW",
        issues: [
          ...data.financeCompleteness.issues,
          ...checks.filter((check) => !check.ok).map((check) => ({
            code: `OWNER_RECONCILIATION_${check.code}`,
            level: "CRITICAL" as const,
            title: "Неузгоджена фінансова формула",
            message: `${check.label}: різниця ${check.diff.toFixed(2)} грн.`,
            count: 1,
          })),
        ],
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[owner-dashboard-finance]", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити фінансове ядро Пульта власника." }, { status: 500 });
  }
}
