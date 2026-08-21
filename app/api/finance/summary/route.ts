import { NextRequest, NextResponse } from "next/server";
import { calculatePnl, decimalToNumber, outstandingAmount, roundMoney } from "@/src/domain/finance";
import { getPrisma } from "@/src/lib/prisma";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KYIV_TZ = "Europe/Kyiv";
const NON_DEMO_WORK_ORDER = { OR: [{ workOrderId: null }, { NOT: { workOrderId: { startsWith: "demo_" } } }] };

function kyivParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: KYIV_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return { year: Number(parts.find((part) => part.type === "year")?.value), month: Number(parts.find((part) => part.type === "month")?.value), day: Number(parts.find((part) => part.type === "day")?.value) };
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
function currentKyivMonthRange(now = new Date()) {
  const { year, month } = kyivParts(now);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return { from: kyivDateStartUtc(year, month, 1), to: kyivDateStartUtc(nextYear, nextMonth, 1) };
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

export async function GET(request: NextRequest) {
  const defaults = currentKyivMonthRange();
  const currency = (request.nextUrl.searchParams.get("currency") || "UAH").toUpperCase().slice(0, 3);
  const from = parseKyivDate(request.nextUrl.searchParams.get("from")) ?? defaults.from;
  const to = addKyivDay(request.nextUrl.searchParams.get("to")) ?? defaults.to;
  const locationId = request.nextUrl.searchParams.get("locationId")?.trim() || null;
  if (from >= to) return NextResponse.json({ ok: false, error: "INVALID_DATE_RANGE" }, { status: 400 });

  const access = await authorizeScopedLocation(PERMISSIONS.FINANCE_READ, request, locationId);
  if (!access.ok) return access.response;

  const prisma = getPrisma();
  const locationWhere = access.locationWhere;
  const costCenterScopeWhere = access.allowedLocationIds
    ? { locationId: { in: access.allowedLocationIds } }
    : {};

  const [pnlGroups, cashPeriodGroups, cashAllTimeGroups, accounts, obligations, eventCount, cashCount, costCenters] = await Promise.all([
    prisma.financialEvent.groupBy({ by: ["pnlSection"], where: { status: "POSTED", currency, recognizedAt: { gte: from, lt: to }, ...locationWhere, ...NON_DEMO_WORK_ORDER }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.cashTransaction.groupBy({ by: ["kind", "flowSection"], where: { status: "POSTED", currency, occurredAt: { gte: from, lt: to }, ...locationWhere, ...NON_DEMO_WORK_ORDER }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.cashTransaction.groupBy({ by: ["kind"], where: { status: "POSTED", currency, ...locationWhere, ...NON_DEMO_WORK_ORDER }, _sum: { amount: true } }),
    prisma.moneyAccount.findMany({ where: { isActive: true, currency, ...locationWhere, NOT: { id: { startsWith: "demo_" } } }, select: { id: true, name: true, type: true, openingBalance: true, locationId: true, sortOrder: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.financialObligation.findMany({ where: { status: { in: ["OPEN", "PARTIALLY_PAID", "OVERDUE"] }, currency, ...locationWhere, ...NON_DEMO_WORK_ORDER }, select: { direction: true, amount: true, settledAmount: true, dueAt: true, status: true } }),
    prisma.financialEvent.count({ where: { status: "POSTED", currency, recognizedAt: { gte: from, lt: to }, ...locationWhere, ...NON_DEMO_WORK_ORDER } }),
    prisma.cashTransaction.count({ where: { status: "POSTED", currency, occurredAt: { gte: from, lt: to }, ...locationWhere, ...NON_DEMO_WORK_ORDER } }),
    prisma.costCenter.findMany({ where: { isActive: true, locationId: { not: null }, ...costCenterScopeWhere }, select: { locationId: true, name: true, sortOrder: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);

  const pnlBySection = Object.fromEntries(pnlGroups.map((row) => [row.pnlSection, decimalToNumber(row._sum.amount)]));
  const pnl = calculatePnl({ revenue: pnlBySection.REVENUE || 0, cogs: pnlBySection.COGS || 0, opex: pnlBySection.OPEX || 0, otherIncome: pnlBySection.OTHER_INCOME || 0, otherExpense: pnlBySection.OTHER_EXPENSE || 0, tax: pnlBySection.TAX || 0 });
  const cashPeriod = cashPeriodGroups.reduce((acc, row) => {
    const amount = decimalToNumber(row._sum.amount);
    if (row.kind === "INFLOW") acc.inflow += amount;
    if (row.kind === "OUTFLOW") acc.outflow += amount;
    if (row.flowSection === "OPERATING") acc.operating += row.kind === "INFLOW" ? amount : row.kind === "OUTFLOW" ? -amount : 0;
    if (row.flowSection === "INVESTING") acc.investing += row.kind === "INFLOW" ? amount : row.kind === "OUTFLOW" ? -amount : 0;
    if (row.flowSection === "FINANCING") acc.financing += row.kind === "INFLOW" ? amount : row.kind === "OUTFLOW" ? -amount : 0;
    return acc;
  }, { inflow: 0, outflow: 0, operating: 0, investing: 0, financing: 0 });
  const cashAll = Object.fromEntries(cashAllTimeGroups.map((row) => [row.kind, decimalToNumber(row._sum.amount)]));
  const openingCash = accounts.reduce((sum, account) => sum + decimalToNumber(account.openingBalance), 0);
  const currentCash = openingCash + (cashAll.INFLOW || 0) - (cashAll.OUTFLOW || 0);
  let receivables = 0, payables = 0, overdueReceivables = 0, overduePayables = 0;
  const now = new Date();
  for (const obligation of obligations) {
    const outstanding = outstandingAmount(obligation.amount, obligation.settledAmount);
    const overdue = obligation.status === "OVERDUE" || Boolean(obligation.dueAt && obligation.dueAt < now);
    if (obligation.direction === "RECEIVABLE") { receivables += outstanding; if (overdue) overdueReceivables += outstanding; }
    else { payables += outstanding; if (overdue) overduePayables += outstanding; }
  }
  const hasFinancialData = eventCount > 0 || cashCount > 0 || obligations.length > 0 || accounts.length > 0;
  const locations = [...new Map(costCenters.filter((row) => row.locationId).map((row) => [row.locationId as string, { id: row.locationId as string, name: row.name }])).values()];

  return NextResponse.json({
    ok: true, currency, range: { from, to, timezone: KYIV_TZ }, selectedLocationId: locationId, locations, hasFinancialData,
    pnl: { revenue: roundMoney(pnl.revenue), cogs: roundMoney(pnl.cogs), grossProfit: roundMoney(pnl.grossProfit), grossMarginPercent: pnl.grossMarginPercent, opex: roundMoney(pnl.opex), operatingProfit: roundMoney(pnl.operatingProfit), otherIncome: roundMoney(pnl.otherIncome), otherExpense: roundMoney(pnl.otherExpense), tax: roundMoney(pnl.tax), netProfit: roundMoney(pnl.netProfit), netMarginPercent: pnl.netMarginPercent },
    cashFlow: { inflow: roundMoney(cashPeriod.inflow), outflow: roundMoney(cashPeriod.outflow), net: roundMoney(cashPeriod.inflow - cashPeriod.outflow), operating: roundMoney(cashPeriod.operating), investing: roundMoney(cashPeriod.investing), financing: roundMoney(cashPeriod.financing), currentCash: roundMoney(currentCash) },
    workingCapital: { receivables: roundMoney(receivables), payables: roundMoney(payables), overdueReceivables: roundMoney(overdueReceivables), overduePayables: roundMoney(overduePayables) },
    accounts: accounts.map((account) => ({ id: account.id, name: account.name, type: account.type, openingBalance: decimalToNumber(account.openingBalance), locationId: account.locationId })),
    counts: { postedEvents: eventCount, postedCashTransactions: cashCount, openObligations: obligations.length, activeMoneyAccounts: accounts.length },
  }, { headers: { "Cache-Control": "no-store" } });
}
