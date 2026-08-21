import { NextRequest, NextResponse } from "next/server";
import { formatWorkOrderNumber, parseWorkOrderNumber } from "@/src/domain/work-order-number";
import { getWorkflowStatusLabel } from "@/src/domain/workflow";
import { getPrisma } from "@/src/lib/prisma";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const KYIV_TZ = "Europe/Kyiv";
const SOURCE_PAYMENT = "WORK_ORDER_PAYMENT";
const OPEN_STATUSES = ["OPEN", "PARTIALLY_PAID", "OVERDUE"] as const;

function decimal(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
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

function todayRange(now = new Date()) {
  const parts = kyivParts(now);
  const from = kyivDateStartUtc(parts.year, parts.month, parts.day);
  const nextProbe = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1, 12));
  const next = kyivParts(nextProbe);
  return { from, to: kyivDateStartUtc(next.year, next.month, next.day) };
}

export async function GET(request: NextRequest) {
  const requestedLocationId = request.nextUrl.searchParams.get("locationId")?.trim() || null;
  const access = await authorizeScopedLocation(PERMISSIONS.PAYMENTS_READ, request, requestedLocationId);
  if (!access.ok) return access.response;

  const prisma = getPrisma();
  const q = (request.nextUrl.searchParams.get("q") || "").trim().slice(0, 120);
  const scopedLocation = access.locationWhere;
  const { from, to } = todayRange();

  try {
    let searchedWorkOrderIds: string[] | null = null;
    if (q) {
      const parsedNumber = parseWorkOrderNumber(q);
      const exactNumber = parsedNumber == null
        ? null
        : await prisma.workOrderNumber.findUnique({ where: { number: parsedNumber }, select: { workOrderId: true } });
      const matches = await prisma.workOrder.findMany({
        where: {
          OR: [
            ...(exactNumber ? [{ id: exactNumber.workOrderId }] : []),
            { client: { is: { name: { contains: q, mode: "insensitive" } } } },
            { client: { is: { phone: { contains: q.replace(/\D+/g, "") || q } } } },
            { vehicle: { is: { plateNumber: { contains: q, mode: "insensitive" } } } },
            { vehicle: { is: { vin: { contains: q, mode: "insensitive" } } } },
          ],
        },
        select: { id: true },
        take: 120,
      });
      searchedWorkOrderIds = Array.from(new Set(matches.map((row) => row.id)));
      if (!searchedWorkOrderIds.length) {
        return NextResponse.json({ ok: true, timezone: KYIV_TZ, accounts: [], rows: [], counts: { due: 0, partial: 0, paidToday: 0, debt: 0 } }, { headers: { "Cache-Control": "no-store" } });
      }
    }

    const todayGroups = await prisma.cashTransaction.groupBy({
      by: ["workOrderId"],
      where: {
        status: "POSTED",
        sourceEntity: SOURCE_PAYMENT,
        occurredAt: { gte: from, lt: to },
        workOrderId: { not: null },
        ...scopedLocation,
        ...(searchedWorkOrderIds ? { workOrderId: { in: searchedWorkOrderIds } } : {}),
      },
      _sum: { amount: true },
      _max: { occurredAt: true },
    });
    const todayPaid = new Map(todayGroups.filter((row) => row.workOrderId).map((row) => [row.workOrderId as string, {
      amount: decimal(row._sum.amount),
      at: row._max.occurredAt,
    }]));

    const obligations = await prisma.financialObligation.findMany({
      where: {
        direction: "RECEIVABLE",
        workOrderId: { not: null },
        ...scopedLocation,
        ...(searchedWorkOrderIds ? { workOrderId: { in: searchedWorkOrderIds } } : {}),
        OR: [
          { status: { in: [...OPEN_STATUSES] } },
          ...(todayPaid.size ? [{ workOrderId: { in: Array.from(todayPaid.keys()) } }] : []),
        ],
      },
      orderBy: [{ dueAt: "asc" }, { updatedAt: "desc" }],
      take: 300,
      select: {
        id: true,
        status: true,
        amount: true,
        settledAmount: true,
        currency: true,
        issuedAt: true,
        dueAt: true,
        settledAt: true,
        workOrderId: true,
        clientId: true,
        locationId: true,
        counterpartyName: true,
        updatedAt: true,
      },
    });

    const workOrderIds = obligations.map((row) => row.workOrderId).filter((id): id is string => Boolean(id));
    const [workOrders, numberRows, latestPayments, accounts] = await Promise.all([
      workOrderIds.length ? prisma.workOrder.findMany({
        where: { id: { in: workOrderIds } },
        select: {
          id: true,
          status: true,
          updatedAt: true,
          client: { select: { id: true, name: true, phone: true } },
          vehicle: { select: { id: true, plateNumber: true, vin: true, brand: true, model: true, year: true } },
        },
      }) : Promise.resolve([]),
      workOrderIds.length ? prisma.workOrderNumber.findMany({ where: { workOrderId: { in: workOrderIds } }, select: { workOrderId: true, number: true } }) : Promise.resolve([]),
      workOrderIds.length ? prisma.cashTransaction.findMany({
        where: { status: "POSTED", sourceEntity: SOURCE_PAYMENT, workOrderId: { in: workOrderIds }, ...scopedLocation },
        orderBy: { occurredAt: "desc" },
        take: 600,
        select: { id: true, workOrderId: true, amount: true, occurredAt: true, toAccountId: true },
      }) : Promise.resolve([]),
      prisma.moneyAccount.findMany({
        where: {
          isActive: true,
          currency: "UAH",
          ...(access.grantedScope === "LOCATION"
            ? { OR: [{ locationId: null }, { locationId: { in: access.allowedLocationIds || [] } }] }
            : {}),
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, type: true, currency: true, locationId: true },
      }),
    ]);

    const wo = new Map(workOrders.map((row) => [row.id, row]));
    const numbers = new Map(numberRows.map((row) => [row.workOrderId, row.number]));
    const lastPayment = new Map<string, (typeof latestPayments)[number]>();
    for (const payment of latestPayments) {
      if (payment.workOrderId && !lastPayment.has(payment.workOrderId)) lastPayment.set(payment.workOrderId, payment);
    }

    const now = new Date();
    const rows = obligations.flatMap((obligation) => {
      const workOrderId = obligation.workOrderId;
      if (!workOrderId) return [];
      const workOrder = wo.get(workOrderId);
      if (!workOrder) return [];
      const total = decimal(obligation.amount);
      const paid = decimal(obligation.settledAmount);
      const outstanding = Math.max(0, Math.round((total - paid) * 100) / 100);
      const overdue = outstanding > 0 && (obligation.status === "OVERDUE" || Boolean(obligation.dueAt && obligation.dueAt < now));
      const today = todayPaid.get(workOrderId);
      const latest = lastPayment.get(workOrderId);
      return [{
        obligationId: obligation.id,
        workOrderId,
        workOrderNumber: numbers.get(workOrderId) ?? null,
        workOrderLabel: formatWorkOrderNumber(numbers.get(workOrderId)),
        workOrderStatus: workOrder.status,
        workOrderStatusLabel: getWorkflowStatusLabel("WORK_ORDER", workOrder.status),
        currency: obligation.currency,
        total,
        paid,
        outstanding,
        issuedAt: obligation.issuedAt,
        dueAt: obligation.dueAt,
        overdue,
        todayPaid: today?.amount ?? 0,
        lastPaymentAt: latest?.occurredAt ?? null,
        lastPaymentAmount: latest ? decimal(latest.amount) : 0,
        lastPaymentAccountId: latest?.toAccountId ?? null,
        client: workOrder.client,
        vehicle: workOrder.vehicle,
        flags: {
          due: outstanding > 0 && paid <= 0 && !overdue,
          partial: outstanding > 0 && paid > 0 && !overdue,
          debt: overdue,
          paidToday: (today?.amount ?? 0) > 0,
        },
      }];
    });

    const counts = {
      due: rows.filter((row) => row.flags.due).length,
      partial: rows.filter((row) => row.flags.partial).length,
      paidToday: rows.filter((row) => row.flags.paidToday).length,
      debt: rows.filter((row) => row.flags.debt).length,
    };

    return NextResponse.json({ ok: true, timezone: KYIV_TZ, accounts, rows, counts }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/payments failed", { message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити касову чергу." }, { status: 500 });
  }
}
