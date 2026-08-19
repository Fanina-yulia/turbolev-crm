import { NextRequest, NextResponse } from "next/server";
import { FinancialObligationDirection, FinancialPnlSection } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { decimalToNumber, outstandingAmount, roundMoney } from "@/src/domain/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KYIV_TZ = "Europe/Kyiv";
const NON_DEMO_WORK_ORDER = { OR: [{ workOrderId: null }, { NOT: { workOrderId: { startsWith: "demo_" } } }] };

function kyivOffsetMinutes(date: Date) {
  const value = new Intl.DateTimeFormat("en-US", { timeZone: KYIV_TZ, timeZoneName: "shortOffset", hour: "2-digit" }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value;
  const match = value?.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 180;
  const minutes = Number(match[2]) * 60 + Number(match[3] || 0);
  return match[1] === "+" ? minutes : -minutes;
}
function startUtc(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day, 12));
  return new Date(Date.UTC(year, month - 1, day, 0, -kyivOffsetMinutes(probe)));
}
function endUtc(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day + 1, 12));
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: KYIV_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(probe);
  const y = Number(parts.find((part) => part.type === "year")?.value), m = Number(parts.find((part) => part.type === "month")?.value), d = Number(parts.find((part) => part.type === "day")?.value);
  return new Date(Date.UTC(y, m - 1, d, 0, -kyivOffsetMinutes(new Date(Date.UTC(y, m - 1, d, 12)))));
}
function workOrderLabel(number: number | undefined) { return number ? `ЗН-${String(number).padStart(6, "0")}` : null; }

export async function GET(request: NextRequest) {
  const prisma = getPrisma();
  const metric = request.nextUrl.searchParams.get("metric") || "revenue";
  const currency = (request.nextUrl.searchParams.get("currency") || "UAH").toUpperCase().slice(0, 3);
  const from = startUtc(request.nextUrl.searchParams.get("from"));
  const to = endUtc(request.nextUrl.searchParams.get("to"));
  const locationId = request.nextUrl.searchParams.get("locationId")?.trim() || null;
  if (!from || !to || from >= to) return NextResponse.json({ ok: false, error: "INVALID_DATE_RANGE" }, { status: 400 });
  const locationWhere = locationId ? { locationId } : {};

  if (["revenue", "grossProfit", "netProfit"].includes(metric)) {
    const pnlSections: FinancialPnlSection[] = metric === "revenue"
      ? [FinancialPnlSection.REVENUE]
      : metric === "grossProfit"
        ? [FinancialPnlSection.REVENUE, FinancialPnlSection.COGS]
        : [FinancialPnlSection.REVENUE, FinancialPnlSection.COGS, FinancialPnlSection.OPEX, FinancialPnlSection.OTHER_INCOME, FinancialPnlSection.OTHER_EXPENSE, FinancialPnlSection.TAX];
    const events = await prisma.financialEvent.findMany({
      where: { status: "POSTED", currency, pnlSection: { in: pnlSections }, recognizedAt: { gte: from, lt: to }, ...locationWhere, ...NON_DEMO_WORK_ORDER },
      select: { id: true, pnlSection: true, amount: true, recognizedAt: true, description: true, workOrderId: true },
      orderBy: [{ recognizedAt: "desc" }, { createdAt: "desc" }], take: 100,
    });
    const ids = events.map((row) => row.workOrderId).filter(Boolean) as string[];
    const numbers = ids.length ? await prisma.workOrderNumber.findMany({ where: { workOrderId: { in: ids } } }) : [];
    const byWo = new Map(numbers.map((row) => [row.workOrderId, row.number]));
    return NextResponse.json({ ok: true, metric, rows: events.map((row) => ({ id: row.id, type: row.pnlSection, date: row.recognizedAt, amount: roundMoney(decimalToNumber(row.amount)), description: row.description || row.pnlSection, workOrderId: row.workOrderId, workOrderLabel: row.workOrderId ? workOrderLabel(byWo.get(row.workOrderId)) : null })) });
  }

  if (metric === "currentCash") {
    const accounts = await prisma.moneyAccount.findMany({ where: { isActive: true, currency, ...(locationId ? { locationId } : {}), NOT: { id: { startsWith: "demo_" } } }, select: { id: true, name: true, openingBalance: true } });
    const rows = await Promise.all(accounts.map(async (account) => {
      const [incoming, outgoing] = await Promise.all([
        prisma.cashTransaction.aggregate({ where: { status: "POSTED", currency, toAccountId: account.id, ...NON_DEMO_WORK_ORDER }, _sum: { amount: true } }),
        prisma.cashTransaction.aggregate({ where: { status: "POSTED", currency, fromAccountId: account.id, ...NON_DEMO_WORK_ORDER }, _sum: { amount: true } }),
      ]);
      const balance = decimalToNumber(account.openingBalance) + decimalToNumber(incoming._sum.amount) - decimalToNumber(outgoing._sum.amount);
      return { id: account.id, type: "ACCOUNT", date: null, amount: roundMoney(balance), description: account.name, workOrderId: null, workOrderLabel: null };
    }));
    return NextResponse.json({ ok: true, metric, rows });
  }

  const direction = metric === "payables" || metric === "overduePayables" ? FinancialObligationDirection.PAYABLE : FinancialObligationDirection.RECEIVABLE;
  const overdueOnly = metric === "overdueReceivables" || metric === "overduePayables";
  const obligations = await prisma.financialObligation.findMany({
    where: { status: { in: ["OPEN", "PARTIALLY_PAID", "OVERDUE"] }, currency, direction, ...locationWhere, ...NON_DEMO_WORK_ORDER },
    select: { id: true, amount: true, settledAmount: true, issuedAt: true, dueAt: true, status: true, description: true, counterpartyName: true, workOrderId: true },
    orderBy: [{ dueAt: "asc" }, { issuedAt: "desc" }], take: 100,
  });
  const now = new Date();
  const filtered = obligations.filter((row) => !overdueOnly || row.status === "OVERDUE" || Boolean(row.dueAt && row.dueAt < now));
  const ids = filtered.map((row) => row.workOrderId).filter(Boolean) as string[];
  const numbers = ids.length ? await prisma.workOrderNumber.findMany({ where: { workOrderId: { in: ids } } }) : [];
  const byWo = new Map(numbers.map((row) => [row.workOrderId, row.number]));
  return NextResponse.json({ ok: true, metric, rows: filtered.map((row) => ({ id: row.id, type: row.status, date: row.dueAt || row.issuedAt, amount: roundMoney(outstandingAmount(row.amount, row.settledAmount)), description: row.counterpartyName || row.description || (direction === FinancialObligationDirection.RECEIVABLE ? "Дебіторська заборгованість" : "Кредиторська заборгованість"), workOrderId: row.workOrderId, workOrderLabel: row.workOrderId ? workOrderLabel(byWo.get(row.workOrderId)) : null })) });
}
