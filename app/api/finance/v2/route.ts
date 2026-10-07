import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";
import {
  FinancialCenterV2Error,
  addExpenseAttachment,
  createFinancialCategory,
  createManualIncome,
  createTransfer,
  getFinancialCenterV2,
  saveBudget,
  saveFinancialSettings,
  saveForecastItem,
  saveRecurringRule,
  type FinanceActor,
} from "@/src/services/financial-center-v2.service";
import {
  closeFinanceCashDay,
  getFinancialCenterV3Control,
} from "@/src/services/financial-center-v3-control.service";
import {
  approvalRequirementForExpense,
  approveExpense,
  listExpenseAttachments,
  rejectExpense,
  requestExpenseApproval,
  reverseExpense,
} from "@/src/services/finance-expense-governance.service";
import { listApprovalRules, saveApprovalRule, setApprovalRuleActive } from "@/src/services/financial-approval-rules.service";
import { listCustomerAdvances } from "@/src/services/customer-advance.service";
import { applyCustomerAdvanceSettlement, receiveCustomerAdvance, refundCustomerAdvanceSettlement } from "@/src/services/finance-settlement.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KYIV_TZ = "Europe/Kyiv";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, max = 240) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
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
  return new Date(Date.UTC(year, month - 1, day, 0, -kyivOffsetMinutes(probe)));
}

function parseDay(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return kyivDateStartUtc(year, month, day);
}

function addKyivDay(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1, 12));
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: KYIV_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(next);
  return kyivDateStartUtc(Number(parts.find((item) => item.type === "year")?.value), Number(parts.find((item) => item.type === "month")?.value), Number(parts.find((item) => item.type === "day")?.value));
}

function currentMonthRange(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: KYIV_TZ, year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = Number(parts.find((item) => item.type === "year")?.value);
  const month = Number(parts.find((item) => item.type === "month")?.value);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return { from: kyivDateStartUtc(year, month, 1), to: kyivDateStartUtc(nextYear, nextMonth, 1) };
}

function actor(access: { context: { user?: { id?: string; employeeName?: string | null; name?: string | null; email?: string | null } | null } }): FinanceActor {
  return {
    id: access.context.user?.id || null,
    name: access.context.user?.employeeName || access.context.user?.name || access.context.user?.email || "CRM / Фінанси",
  };
}

function financePersona(roles: Array<{ code: string; isPrimary: boolean }>) {
  const codes = roles.map((role) => role.code.toUpperCase());
  const primary = roles.find((role) => role.isPrimary)?.code || roles[0]?.code || null;
  if (codes.some((code) => ["OWNER", "EXECUTIVE", "DIRECTOR", "ADMIN", "SUPER_ADMIN", "SYSTEM_ADMIN"].includes(code))) return { code: "OWNER", primaryRole: primary };
  if (codes.some((code) => ["CASHIER", "KASIR"].includes(code))) return { code: "CASHIER", primaryRole: primary };
  if (codes.some((code) => ["STATION_MANAGER", "ADMINISTRATOR", "SERVICE_MANAGER", "MASTER"].includes(code))) return { code: "STATION_MANAGER", primaryRole: primary };
  if (codes.some((code) => ["FINANCE", "ACCOUNTANT", "CHIEF_ACCOUNTANT", "FINANCIAL_MANAGER"].includes(code))) return { code: "FINANCE", primaryRole: primary };
  return { code: "STANDARD", primaryRole: primary };
}

function isPayrollFinanceSource(value: unknown) {
  const source = typeof value === "string" ? value.toUpperCase() : "";
  return source.includes("PAYROLL") || source.includes("SALARY");
}

function restrictedDebtView(obligations: any[]) {
  const visible = obligations.filter((row) => !isPayrollFinanceSource(row.sourceEntity));
  const empty = () => ({ total: 0, overdue: 0, buckets: { "0_7": 0, "8_14": 0, "15_30": 0, "31_60": 0, "60_PLUS": 0 } as Record<string, number> });
  const aging = { receivables: empty(), payables: empty() };
  for (const row of visible) {
    const target = row.direction === "RECEIVABLE" ? aging.receivables : aging.payables;
    const amount = Number(row.outstanding || 0);
    target.total += amount;
    if (row.isOverdue) target.overdue += amount;
    const days = Number(row.overdueDays || 0);
    const bucket = days <= 7 ? "0_7" : days <= 14 ? "8_14" : days <= 30 ? "15_30" : days <= 60 ? "31_60" : "60_PLUS";
    target.buckets[bucket] += amount;
  }
  return { visible, aging };
}

function redactFinanceForPersona(data: any, control: any, persona: string) {
  if (persona === "OWNER" || persona === "FINANCE") return { data, control };

  const { visible: obligations, aging } = restrictedDebtView(data.obligations || []);
  const debtKpi = {
    receivables: aging.receivables.total,
    payables: aging.payables.total,
    overdueReceivables: aging.receivables.overdue,
    overduePayables: aging.payables.overdue,
  };
  const payrollSafeTransactions = (data.cashFlow?.transactions || []).filter((row: any) => !isPayrollFinanceSource(row.sourceEntity));

  if (persona === "STATION_MANAGER") {
    return {
      data: {
        ...data,
        kpi: { ...data.kpi, grossProfit: 0, directCosts: 0, opex: 0, netProfit: 0, grossMarginPercent: null, ...debtKpi },
        comparison: {
          ...data.comparison,
          grossProfit: { previous: 0, changePercent: null },
          netProfit: { previous: 0, changePercent: null },
          opex: { previous: 0, changePercent: null },
        },
        pnl: {
          ...data.pnl,
          cogs: 0, grossProfit: 0, grossMarginPercent: null, opex: 0, operatingProfit: 0,
          otherIncome: 0, otherExpense: 0, tax: 0, netProfit: 0, netMarginPercent: null,
          categories: [],
          events: (data.pnl?.events || []).filter((row: any) => row.pnlSection === "REVENUE" && !isPayrollFinanceSource(row.sourceEntity)),
        },
        cashFlow: { ...data.cashFlow, transactions: payrollSafeTransactions },
        obligations,
        aging,
        budgets: [],
        recurring: [],
        calendar: [],
        breakEven: { ...data.breakEven, fixedCosts: 0, grossMarginPercent: null, breakEvenRevenue: null, remainingRevenue: null, requiredRevenuePerDay: null },
        profitability: {
          ...data.profitability,
          services: [],
          parts: [],
          mechanics: [],
          suppliers: [],
        },
        ownerSummary: undefined,
        financeCompleteness: {
          ...data.financeCompleteness,
          issues: [],
          checks: { missingLaborAccruals: 0, missingWalkInLabor: 0, missingPartCosts: 0, missingBaseAccrualEmployees: 0 },
        },
        alerts: [],
      },
      control: {
        ...control,
        reconciliation: { status: "OK", issueCount: 0, criticalCount: 0, warningCount: 0, issues: [] },
        margins: [],
        plan: { ...control.plan, metrics: [] },
        profitability: {
          ...control.profitability,
          lowMarginParts: [],
          lowMarginPartsCount: 0,
          topMechanic: null,
          topSupplier: null,
        },
      },
    };
  }

  return {
    data: {
      ...data,
      kpi: {
        ...data.kpi,
        revenue: 0, grossProfit: 0, directCosts: 0, opex: 0, netProfit: 0, grossMarginPercent: null,
        ...debtKpi,
      },
      comparison: {
        ...data.comparison,
        revenue: { previous: 0, changePercent: null },
        grossProfit: { previous: 0, changePercent: null },
        netProfit: { previous: 0, changePercent: null },
        opex: { previous: 0, changePercent: null },
      },
      pnl: {
        ...data.pnl,
        revenue: 0, cogs: 0, grossProfit: 0, grossMarginPercent: null, opex: 0, operatingProfit: 0,
        otherIncome: 0, otherExpense: 0, tax: 0, netProfit: 0, netMarginPercent: null,
        categories: [], events: [],
      },
      cashFlow: { ...data.cashFlow, transactions: payrollSafeTransactions },
      obligations,
      aging,
      budgets: [],
      recurring: [],
      calendar: [],
      forecast: {
        ...data.forecast,
        minimumReserve: 0,
        minimumForecastCash: data.kpi.currentCash,
        firstGap: null,
        firstReserveWarning: null,
        points: [],
      },
      breakEven: {
        ...data.breakEven,
        fixedCosts: 0, grossMarginPercent: null, breakEvenRevenue: null,
        currentRevenue: 0, remainingRevenue: null, requiredRevenuePerDay: null,
      },
      profitability: { workOrders: [], services: [], parts: [], mechanics: [], suppliers: [] },
      ownerSummary: undefined,
      financeCompleteness: {
        ...data.financeCompleteness,
        issues: [],
        checks: { missingLaborAccruals: 0, missingWalkInLabor: 0, missingPartCosts: 0, missingBaseAccrualEmployees: 0 },
      },
      alerts: [],
      settings: {
        ...data.settings,
        fixedMonthlyCosts: 0,
        targetGrossMarginPercent: 0,
        warningGrossMarginPercent: 0,
      },
    },
    control: {
      ...control,
      today: { ...control.today, revenue: 0, receivablesCreated: 0 },
      reconciliation: { status: "OK", issueCount: 0, criticalCount: 0, warningCount: 0, issues: [] },
      margins: [],
      plan: { ...control.plan, metrics: [] },
      forecast: {
        ...control.forecast,
        in7Days: data.kpi.currentCash,
        in30Days: data.kpi.currentCash,
        minimum: null,
        firstGap: null,
        firstReserveWarning: null,
        drivers: [],
      },
      profitability: {
        topWorkOrder: null, losingWorkOrders: [], losingCount: 0,
        lowMarginParts: [], lowMarginPartsCount: 0, topMechanic: null, topSupplier: null,
      },
    },
  };
}

function errorResponse(error: unknown) {
  if (error instanceof FinancialCenterV2Error) return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: error.status });
  console.error("[financial-center-v2]", error);
  return NextResponse.json({ ok: false, code: "FINANCE_V2_OPERATION_FAILED", error: "Не вдалося виконати фінансову операцію." }, { status: 500 });
}

async function targetLocationForAction(action: string, body: Record<string, unknown>) {
  const direct = text(body.locationId, 64);
  if (direct) return direct;
  const expenseId = text(body.expenseId, 96) || (action === "ADD_ATTACHMENT" ? text(body.expenseDocumentId, 96) : null);
  if (expenseId) {
    const expense = await getPrisma().expenseDocument.findUnique({ where: { id: expenseId }, select: { locationId: true } });
    return expense?.locationId || null;
  }
  const advanceId = text(body.advanceId, 96);
  if (advanceId) {
    const advance = await getPrisma().customerAdvance.findUnique({ where: { id: advanceId }, select: { locationId: true } });
    return advance?.locationId || null;
  }
  if (action === "CLOSE_CASH_DAY") {
    const moneyAccountId = text(body.moneyAccountId, 64);
    if (moneyAccountId) {
      const account = await getPrisma().moneyAccount.findUnique({ where: { id: moneyAccountId }, select: { locationId: true } });
      return account?.locationId || null;
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  const requestedLocationId = request.nextUrl.searchParams.get("locationId")?.trim() || null;
  const access = await authorizeScopedLocation(PERMISSIONS.FINANCE_READ, request, requestedLocationId);
  if (!access.ok) return access.response;
  const defaults = currentMonthRange();
  const from = parseDay(request.nextUrl.searchParams.get("from")) || defaults.from;
  const to = addKyivDay(request.nextUrl.searchParams.get("to")) || defaults.to;
  if (from >= to) return NextResponse.json({ ok: false, code: "INVALID_DATE_RANGE", error: "Некоректний фінансовий період." }, { status: 400 });

  try {
    const view = request.nextUrl.searchParams.get("view") || "dashboard";
    if (view === "expense-attachments") {
      const expenseId = request.nextUrl.searchParams.get("expenseId")?.trim();
      if (!expenseId) return NextResponse.json({ ok: false, code: "EXPENSE_ID_REQUIRED", error: "Вкажіть витрату." }, { status: 400 });
      const expense = await getPrisma().expenseDocument.findUnique({ where: { id: expenseId }, select: { locationId: true } });
      if (!expense) return NextResponse.json({ ok: false, code: "EXPENSE_NOT_FOUND", error: "Витрату не знайдено." }, { status: 404 });
      if (access.allowedLocationIds && expense.locationId && !access.allowedLocationIds.includes(expense.locationId)) return NextResponse.json({ ok: false, code: "LOCATION_FORBIDDEN", error: "Немає доступу до цієї витрати." }, { status: 403 });
      return NextResponse.json({ ok: true, attachments: await listExpenseAttachments(expenseId) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (view === "expense-approval") {
      const expenseId = request.nextUrl.searchParams.get("expenseId")?.trim();
      if (!expenseId) return NextResponse.json({ ok: false, code: "EXPENSE_ID_REQUIRED", error: "Вкажіть витрату." }, { status: 400 });
      const result = await approvalRequirementForExpense(expenseId);
      if (access.allowedLocationIds && result.expense.locationId && !access.allowedLocationIds.includes(result.expense.locationId)) return NextResponse.json({ ok: false, code: "LOCATION_FORBIDDEN", error: "Немає доступу до цієї витрати." }, { status: 403 });
      return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
    }
    if (view === "approval-rules") {
      const rules = await listApprovalRules(requestedLocationId, access.grantedScope === "LOCATION" ? access.allowedLocationIds : null);
      return NextResponse.json({ ok: true, rules: rules.map((row) => ({ ...row, minAmount: Number(row.minAmount), maxAmount: row.maxAmount == null ? null : Number(row.maxAmount) })) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (view === "customer-advances") {
      const advances = await listCustomerAdvances(requestedLocationId, access.grantedScope === "LOCATION" ? access.allowedLocationIds : null);
      return NextResponse.json({ ok: true, advances: advances.map((row) => ({ ...row, amount: Number(row.amount), appliedAmount: Number(row.appliedAmount), remainingAmount: Math.max(0, Number(row.amount) - Number(row.appliedAmount)) })) }, { headers: { "Cache-Control": "no-store" } });
    }

    const scope = {
      from,
      to,
      currency: request.nextUrl.searchParams.get("currency") || "UAH",
      locationId: requestedLocationId,
      allowedLocationIds: access.grantedScope === "LOCATION" && !requestedLocationId ? access.allowedLocationIds : null,
    };
    const data = await getFinancialCenterV2(scope);
    const control = await getFinancialCenterV3Control(scope, data);
    const persona = financePersona(access.context.roles);
    const visible = redactFinanceForPersona(data, control, persona.code);
    return NextResponse.json({
      ...visible.data,
      control: visible.control,
      viewer: {
        roles: access.context.roles.map((role) => ({ code: role.code, name: role.name, isPrimary: role.isPrimary })),
        primaryRole: persona.primaryRole,
        persona: persona.code,
        userName: access.context.user?.employeeName || access.context.user?.name || null,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const body = asRecord(await request.json().catch(() => null));
  if (!body) return NextResponse.json({ ok: false, code: "INVALID_JSON_BODY", error: "Очікується JSON-об’єкт." }, { status: 400 });
  const action = (text(body.action, 64) || "").toUpperCase();
  if (!action) return NextResponse.json({ ok: false, code: "ACTION_REQUIRED", error: "Не вказана фінансова дія." }, { status: 400 });
  const requestedLocationId = await targetLocationForAction(action, body);
  const access = await authorizeScopedLocation(PERMISSIONS.FINANCE_WRITE, request, requestedLocationId);
  if (!access.ok) return access.response;
  const identity = actor(access);

  try {
    let result: unknown;
    switch (action) {
      case "CREATE_INCOME":
        result = await createManualIncome({ ...body, locationId: requestedLocationId }, identity);
        break;
      case "TRANSFER": {
        if (access.allowedLocationIds) {
          const fromAccountId = text(body.fromAccountId, 64);
          const toAccountId = text(body.toAccountId, 64);
          const accounts = await getPrisma().moneyAccount.findMany({ where: { id: { in: [fromAccountId, toAccountId].filter(Boolean) as string[] } }, select: { id: true, locationId: true } });
          if (accounts.some((account) => account.locationId && !access.allowedLocationIds!.includes(account.locationId))) return NextResponse.json({ ok: false, code: "LOCATION_FORBIDDEN", error: "Немає доступу до одного з рахунків." }, { status: 403 });
        }
        result = await createTransfer(body, identity);
        break;
      }
      case "SAVE_BUDGET":
        result = await saveBudget({ ...body, locationId: requestedLocationId }, identity);
        break;
      case "SAVE_RECURRING":
        result = await saveRecurringRule({ ...body, locationId: requestedLocationId }, identity);
        break;
      case "SAVE_FORECAST":
        result = await saveForecastItem({ ...body, locationId: requestedLocationId }, identity);
        break;
      case "CREATE_CATEGORY":
        result = await createFinancialCategory(body, identity);
        break;
      case "SAVE_SETTINGS":
        result = await saveFinancialSettings({ ...body, locationId: requestedLocationId }, identity);
        break;
      case "CLOSE_CASH_DAY": {
        const moneyAccountId = text(body.moneyAccountId, 64);
        if (!moneyAccountId) throw new FinancialCenterV2Error("ACCOUNT_REQUIRED", "Оберіть касу.");
        if (access.allowedLocationIds) {
          const account = await getPrisma().moneyAccount.findUnique({ where: { id: moneyAccountId }, select: { locationId: true } });
          if (!account?.locationId || !access.allowedLocationIds.includes(account.locationId)) {
            return NextResponse.json({ ok: false, code: "LOCATION_FORBIDDEN", error: "Немає доступу до цієї каси." }, { status: 403 });
          }
        }
        result = await closeFinanceCashDay({ ...body, locationId: requestedLocationId }, identity);
        break;
      }
      case "SAVE_APPROVAL_RULE":
        result = await saveApprovalRule({ ...body, locationId: requestedLocationId }, identity);
        break;
      case "SET_APPROVAL_RULE_ACTIVE": {
        const ruleId = text(body.ruleId, 96);
        if (!ruleId) throw new FinancialCenterV2Error("RULE_ID_REQUIRED", "Вкажіть правило погодження.");
        result = await setApprovalRuleActive(ruleId, body.isActive !== false, identity);
        break;
      }
      case "ADD_ATTACHMENT":
        result = await addExpenseAttachment(body, identity);
        break;
      case "CREATE_CUSTOMER_ADVANCE":
        result = await receiveCustomerAdvance({ ...body, locationId: requestedLocationId } as any, identity);
        break;
      case "APPLY_CUSTOMER_ADVANCE": {
        const advanceId = text(body.advanceId, 96);
        const workOrderId = text(body.workOrderId, 64);
        if (!advanceId || !workOrderId) throw new FinancialCenterV2Error("ADVANCE_FIELDS_REQUIRED", "Вкажіть аванс і замовлення.");
        result = await applyCustomerAdvanceSettlement(advanceId, workOrderId, body.amount, body.idempotencyKey, identity);
        break;
      }
      case "REFUND_CUSTOMER_ADVANCE": {
        const advanceId = text(body.advanceId, 96);
        if (!advanceId) throw new FinancialCenterV2Error("ADVANCE_ID_REQUIRED", "Вкажіть аванс.");
        result = await refundCustomerAdvanceSettlement(advanceId, identity);
        break;
      }
      case "REQUEST_EXPENSE_APPROVAL": {
        const expenseId = text(body.expenseId, 96);
        if (!expenseId) throw new FinancialCenterV2Error("EXPENSE_ID_REQUIRED", "Вкажіть витрату.");
        result = await requestExpenseApproval(expenseId, identity);
        break;
      }
      case "APPROVE_EXPENSE": {
        const expenseId = text(body.expenseId, 96);
        if (!expenseId) throw new FinancialCenterV2Error("EXPENSE_ID_REQUIRED", "Вкажіть витрату.");
        result = await approveExpense(expenseId, identity);
        break;
      }
      case "REJECT_EXPENSE": {
        const expenseId = text(body.expenseId, 96);
        if (!expenseId) throw new FinancialCenterV2Error("EXPENSE_ID_REQUIRED", "Вкажіть витрату.");
        result = await rejectExpense(expenseId, body.reason, identity);
        break;
      }
      case "REVERSE_EXPENSE": {
        const expenseId = text(body.expenseId, 96);
        if (!expenseId) throw new FinancialCenterV2Error("EXPENSE_ID_REQUIRED", "Вкажіть витрату.");
        result = await reverseExpense(expenseId, body.reason, identity);
        break;
      }
      default:
        return NextResponse.json({ ok: false, code: "UNKNOWN_ACTION", error: "Невідома фінансова дія." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
