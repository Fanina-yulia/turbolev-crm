import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";
import {
  FinancialCenterV2Error,
  addExpenseAttachment,
  createCustomerAdvance,
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
  approvalRequirementForExpense,
  approveExpense,
  listExpenseAttachments,
  rejectExpense,
  requestExpenseApproval,
  reverseExpense,
} from "@/src/services/finance-expense-governance.service";
import { listApprovalRules, saveApprovalRule, setApprovalRuleActive } from "@/src/services/financial-approval-rules.service";
import { applyCustomerAdvance, listCustomerAdvances, refundCustomerAdvance } from "@/src/services/customer-advance.service";

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

    const data = await getFinancialCenterV2({
      from,
      to,
      currency: request.nextUrl.searchParams.get("currency") || "UAH",
      locationId: requestedLocationId,
      allowedLocationIds: access.grantedScope === "LOCATION" && !requestedLocationId ? access.allowedLocationIds : null,
    });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
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
        result = await createCustomerAdvance({ ...body, locationId: requestedLocationId }, identity);
        break;
      case "APPLY_CUSTOMER_ADVANCE": {
        const advanceId = text(body.advanceId, 96);
        const workOrderId = text(body.workOrderId, 64);
        if (!advanceId || !workOrderId) throw new FinancialCenterV2Error("ADVANCE_FIELDS_REQUIRED", "Вкажіть аванс і замовлення.");
        result = await applyCustomerAdvance(advanceId, workOrderId, body.amount, identity);
        break;
      }
      case "REFUND_CUSTOMER_ADVANCE": {
        const advanceId = text(body.advanceId, 96);
        if (!advanceId) throw new FinancialCenterV2Error("ADVANCE_ID_REQUIRED", "Вкажіть аванс.");
        result = await refundCustomerAdvance(advanceId, identity);
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
