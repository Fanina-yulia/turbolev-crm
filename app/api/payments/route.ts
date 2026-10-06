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
const WALK_IN_FINANCE_SOURCE = "WALK_IN_DIAGNOSTIC";
const WALK_IN_PAYMENT_SOURCE = "WALK_IN_DIAGNOSTIC_PAYMENT";
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

function dayKey(date: Date) {
  const parts = kyivParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function parseDay(value: string | null) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return kyivDateStartUtc(Number(match[1]), Number(match[2]), Number(match[3]));
}

function addLocalDays(start: Date, days: number) {
  const parts = kyivParts(new Date(start.getTime() + days * 86_400_000 + 43_200_000));
  return kyivDateStartUtc(parts.year, parts.month, parts.day);
}

function dateRange(request: NextRequest) {
  const now = new Date();
  const todayParts = kyivParts(now);
  const today = kyivDateStartUtc(todayParts.year, todayParts.month, todayParts.day);
  const defaultFrom = addLocalDays(today, -29);
  let from = parseDay(request.nextUrl.searchParams.get("from")) || defaultFrom;
  const inclusiveTo = parseDay(request.nextUrl.searchParams.get("to")) || today;
  let to = addLocalDays(inclusiveTo, 1);
  if (to <= from) {
    const swap = from;
    from = inclusiveTo;
    to = addLocalDays(swap, 1);
  }
  return { from, to, fromKey: dayKey(from), toKey: dayKey(addLocalDays(to, -1)) };
}

function paymentStatus(total: number, paid: number, outstanding: number) {
  if (outstanding <= 0.009 && total > 0) return "PAID" as const;
  if (paid > 0.009 && outstanding > 0.009) return "PARTIAL" as const;
  return "DUE" as const;
}

export async function GET(request: NextRequest) {
  const requestedLocationId = request.nextUrl.searchParams.get("locationId")?.trim() || null;
  const access = await authorizeScopedLocation(PERMISSIONS.PAYMENTS_READ, request, requestedLocationId);
  if (!access.ok) return access.response;

  const prisma = getPrisma();
  const q = (request.nextUrl.searchParams.get("q") || "").trim().slice(0, 120);
  const requestedWorkOrderId = request.nextUrl.searchParams.get("workOrderId")?.trim() || null;
  const scopedLocation = access.locationWhere;
  const range = dateRange(request);

  try {
    let searchedWorkOrderIds: string[] = [];
    if (q && !requestedWorkOrderId) {
      const parsedNumber = parseWorkOrderNumber(q);
      const exactNumber = parsedNumber == null
        ? null
        : await prisma.workOrderNumber.findUnique({ where: { number: parsedNumber }, select: { workOrderId: true } });
      const phoneNeedle = q.replace(/\D+/g, "");
      const matches = await prisma.workOrder.findMany({
        where: {
          OR: [
            ...(exactNumber ? [{ id: exactNumber.workOrderId }] : []),
            { client: { is: { name: { contains: q, mode: "insensitive" } } } },
            ...(phoneNeedle ? [{ client: { is: { phone: { contains: phoneNeedle } } } }] : []),
            { vehicle: { is: { plateNumber: { contains: q, mode: "insensitive" } } } },
            { vehicle: { is: { vin: { contains: q, mode: "insensitive" } } } },
          ],
        },
        select: { id: true },
        take: 160,
      });
      searchedWorkOrderIds = Array.from(new Set(matches.map((row) => row.id)));
    }

    const baseWhere = {
      direction: "RECEIVABLE" as const,
      status: { not: "CANCELLED" as const },
      ...scopedLocation,
    };

    const [baseObligations, searchObligations] = await Promise.all([
      prisma.financialObligation.findMany({
        where: {
          ...baseWhere,
          ...(requestedWorkOrderId
            ? { workOrderId: requestedWorkOrderId }
            : {
                AND: [
                  {
                    OR: [
                      { workOrderId: { not: null } },
                      { sourceEntity: WALK_IN_FINANCE_SOURCE },
                    ],
                  },
                  {
                    OR: [
                      { status: { in: [...OPEN_STATUSES] } },
                      { status: "PAID", settledAt: { gte: range.from, lt: range.to } },
                    ],
                  },
                ],
              }),
        },
        orderBy: [{ dueAt: "asc" }, { updatedAt: "desc" }],
        take: 600,
      }),
      q && searchedWorkOrderIds.length
        ? prisma.financialObligation.findMany({
            where: {
              ...baseWhere,
              workOrderId: { in: searchedWorkOrderIds },
            },
            orderBy: { updatedAt: "desc" },
            take: 240,
          })
        : Promise.resolve([]),
    ]);

    const obligationMap = new Map([...baseObligations, ...searchObligations].map((row) => [row.id, row]));
    const obligations = Array.from(obligationMap.values());
    const baseIds = new Set(baseObligations.map((row) => row.id));
    const workOrderIds = Array.from(new Set(obligations.map((row) => row.workOrderId).filter((id): id is string => Boolean(id))));
    const diagnosticIds = Array.from(new Set(obligations
      .filter((row) => !row.workOrderId && row.sourceEntity === WALK_IN_FINANCE_SOURCE)
      .map((row) => row.sourceEntityId?.replace(/:receivable$/, "") || "")
      .filter(Boolean)));

    const allowedLocationWhere = access.grantedScope === "LOCATION"
      ? { id: { in: access.allowedLocationIds || [] } }
      : {};

    const [workOrders, numberRows, diagnostics, paymentRows, todayPayments, accounts, locations] = await Promise.all([
      workOrderIds.length
        ? prisma.workOrder.findMany({
            where: { id: { in: workOrderIds } },
            select: {
              id: true,
              status: true,
              client: { select: { id: true, name: true, phone: true } },
              vehicle: { select: { id: true, plateNumber: true, vin: true, brand: true, model: true, year: true } },
            },
          })
        : Promise.resolve([]),
      workOrderIds.length
        ? prisma.workOrderNumber.findMany({
            where: { workOrderId: { in: workOrderIds } },
            select: { workOrderId: true, number: true },
          })
        : Promise.resolve([]),
      diagnosticIds.length
        ? prisma.diagnosticRequest.findMany({
            where: { id: { in: diagnosticIds } },
            select: {
              id: true,
              client: { select: { id: true, name: true, phone: true } },
              vehicle: { select: { id: true, plateNumber: true, vin: true, brand: true, model: true, year: true } },
            },
          })
        : Promise.resolve([]),
      obligations.length
        ? prisma.cashTransaction.findMany({
            where: {
              status: "POSTED",
              sourceEntity: { in: [SOURCE_PAYMENT, WALK_IN_PAYMENT_SOURCE] },
              obligationId: { in: obligations.map((row) => row.id) },
              ...scopedLocation,
            },
            orderBy: { occurredAt: "desc" },
            take: 1800,
            select: {
              id: true,
              workOrderId: true,
              obligationId: true,
              amount: true,
              occurredAt: true,
              toAccountId: true,
              sourceEntityId: true,
              description: true,
              toAccount: { select: { id: true, name: true, type: true } },
            },
          })
        : Promise.resolve([]),
      prisma.cashTransaction.findMany({
        where: {
          status: "POSTED",
          OR: [
            { sourceEntity: SOURCE_PAYMENT },
            { sourceEntity: WALK_IN_PAYMENT_SOURCE },
          ],
          occurredAt: {
            gte: kyivDateStartUtc(kyivParts().year, kyivParts().month, kyivParts().day),
            lt: addLocalDays(kyivDateStartUtc(kyivParts().year, kyivParts().month, kyivParts().day), 1),
          },
          ...scopedLocation,
        },
        select: { workOrderId: true, amount: true },
      }),
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
      prisma.serviceLocation.findMany({
        where: { isActive: true, ...allowedLocationWhere },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true },
      }),
    ]);

    const workOrderMap = new Map(workOrders.map((row) => [row.id, row]));
    const diagnosticMap = new Map(diagnostics.map((row) => [row.id, row]));
    const numbers = new Map(numberRows.map((row) => [row.workOrderId, row.number]));
    const historyByObligation = new Map<string, Array<{
      id: string;
      amount: number;
      occurredAt: Date;
      accountId: string | null;
      accountName: string | null;
      accountType: string | null;
      description: string | null;
    }>>();

    for (const payment of paymentRows) {
      if (!payment.obligationId) continue;
      const history = historyByObligation.get(payment.obligationId) || [];
      if (history.length < 12) {
        history.push({
          id: payment.id,
          amount: decimal(payment.amount),
          occurredAt: payment.occurredAt,
          accountId: payment.toAccountId,
          accountName: payment.toAccount?.name || null,
          accountType: payment.toAccount?.type || null,
          description: payment.description,
        });
        historyByObligation.set(payment.obligationId, history);
      }
    }

    const now = new Date();
    const builtRows = obligations.flatMap((obligation): any[] => {
      const total = decimal(obligation.amount);
      const paid = decimal(obligation.settledAmount);
      const outstanding = Math.max(0, Math.round((total - paid) * 100) / 100);
      const status = paymentStatus(total, paid, outstanding);
      const overdue = outstanding > 0 && (obligation.status === "OVERDUE" || Boolean(obligation.dueAt && obligation.dueAt < now));
      const history = historyByObligation.get(obligation.id) || [];
      const latest = history[0] || null;

      if (obligation.workOrderId) {
        const workOrderId = obligation.workOrderId;
        const workOrder = workOrderMap.get(workOrderId);
        if (!workOrder) return [];
        return [{
          rowKind: "WORK_ORDER" as const,
          obligationId: obligation.id,
          workOrderId,
          diagnosticRequestId: null,
          workOrderNumber: numbers.get(workOrderId) ?? null,
          workOrderLabel: formatWorkOrderNumber(numbers.get(workOrderId)),
          workOrderStatus: workOrder.status,
          workOrderStatusLabel: getWorkflowStatusLabel("WORK_ORDER", workOrder.status),
          paymentStatus: status,
          currency: obligation.currency,
          total,
          paid,
          outstanding,
          issuedAt: obligation.issuedAt,
          dueAt: obligation.dueAt,
          settledAt: obligation.settledAt,
          locationId: obligation.locationId,
          overdue,
          lastPaymentAt: latest?.occurredAt ?? null,
          lastPaymentAmount: latest?.amount ?? 0,
          client: workOrder.client,
          vehicle: workOrder.vehicle,
          history,
          _base: baseIds.has(obligation.id),
        }];
      }

      if (obligation.sourceEntity !== WALK_IN_FINANCE_SOURCE) return [];
      const diagnosticRequestId = obligation.sourceEntityId?.replace(/:receivable$/, "") || "";
      const diagnostic = diagnosticMap.get(diagnosticRequestId);
      if (!diagnostic) return [];
      return [{
        rowKind: "DIAGNOSTIC" as const,
        obligationId: obligation.id,
        workOrderId: null,
        diagnosticRequestId,
        workOrderNumber: null,
        workOrderLabel: "Діагностика",
        workOrderStatus: "DIAGNOSTIC",
        workOrderStatusLabel: "Окрема діагностика",
        paymentStatus: status,
        currency: obligation.currency,
        total,
        paid,
        outstanding,
        issuedAt: obligation.issuedAt,
        dueAt: obligation.dueAt,
        settledAt: obligation.settledAt,
        locationId: obligation.locationId,
        overdue,
        lastPaymentAt: latest?.occurredAt ?? null,
        lastPaymentAmount: latest?.amount ?? 0,
        client: diagnostic.client,
        vehicle: diagnostic.vehicle,
        history,
        _base: baseIds.has(obligation.id),
      }];
    });

    const metricRows = builtRows.filter((row) => row._base);
    const paidTodayTotal = todayPayments.reduce((sum, row) => sum + decimal(row.amount), 0);
    const counts = {
      all: metricRows.length,
      paid: metricRows.filter((row) => row.paymentStatus === "PAID").length,
      partial: metricRows.filter((row) => row.paymentStatus === "PARTIAL").length,
      due: metricRows.filter((row) => row.paymentStatus === "DUE").length,
      overdue: metricRows.filter((row) => row.overdue).length,
    };
    const kpis = {
      toReceive: metricRows.reduce((sum, row) => sum + row.outstanding, 0),
      paidToday: paidTodayTotal,
      partialCount: counts.partial,
      partialOutstanding: metricRows.filter((row) => row.paymentStatus === "PARTIAL").reduce((sum, row) => sum + row.outstanding, 0),
      dueCount: counts.due,
      dueOutstanding: metricRows.filter((row) => row.paymentStatus === "DUE").reduce((sum, row) => sum + row.outstanding, 0),
      overdueCount: counts.overdue,
      overdueOutstanding: metricRows.filter((row) => row.overdue).reduce((sum, row) => sum + row.outstanding, 0),
    };

    const normalizedNeedle = q.toLocaleLowerCase("uk-UA");
    const phoneNeedle = q.replace(/\D+/g, "");
    const rows = builtRows
      .filter((row) => {
        if (requestedWorkOrderId) return row.workOrderId === requestedWorkOrderId;
        if (!q) return row._base;
        const haystack = [
          row.workOrderLabel,
          row.workOrderNumber == null ? "" : String(row.workOrderNumber),
          row.client.name || "",
          row.client.phone,
          row.vehicle.plateNumber || "",
          row.vehicle.vin || "",
          row.vehicle.brand || "",
          row.vehicle.model || "",
          row.vehicle.year || "",
        ].join(" ").toLocaleLowerCase("uk-UA");
        const phone = row.client.phone.replace(/\D+/g, "");
        return haystack.includes(normalizedNeedle) || Boolean(phoneNeedle && phone.includes(phoneNeedle));
      })
      .sort((a, b) => {
        const rank = (row: typeof a) => row.overdue ? 0 : row.paymentStatus === "DUE" ? 1 : row.paymentStatus === "PARTIAL" ? 2 : 3;
        const diff = rank(a) - rank(b);
        if (diff) return diff;
        return new Date(b.lastPaymentAt || b.issuedAt).getTime() - new Date(a.lastPaymentAt || a.issuedAt).getTime();
      })
      .map(({ _base, ...row }) => row);

    return NextResponse.json({
      ok: true,
      timezone: KYIV_TZ,
      range: { from: range.fromKey, to: range.toKey },
      accounts,
      locations,
      rows,
      counts,
      kpis,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/payments failed", { message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити реєстр оплат." }, { status: 500 });
  }
}
