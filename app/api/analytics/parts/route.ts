import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext, hasPermission } from "@/src/security/access-context";
import { PERMISSIONS, type AccessScopeCode } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const KYIV_TZ = "Europe/Kyiv";
const TERMINAL_STATUSES = new Set(["INSTALLED", "RETURNED", "CANCELLED"]);

function numberOf(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function round(value: number, digits = 2) {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}
function pct(part: number, total: number) {
  return total > 0 ? round((part / total) * 100, 1) : 0;
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
function hoursBetween(start: Date | null, end: Date | null) {
  if (!start || !end) return null;
  return Math.max(0, end.getTime() - start.getTime()) / 3_600_000;
}
function emptyAnalytics(financial: boolean) {
  return {
    requests: 0,
    items: 0,
    requestedQty: 0,
    receivedQty: 0,
    installedQty: 0,
    pendingRequiredQty: 0,
    overdueEtaItems: 0,
    averageSupplyHours: 0,
    purchaseValue: financial ? 0 : null,
    installedRevenue: financial ? 0 : null,
    installedProfit: financial ? 0 : null,
    installedMarginPct: financial ? 0 : null,
    statusBreakdown: [],
    topItems: [],
    suppliers: [],
    stockLedgerAvailable: false,
  };
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

    const canParts = context.enforcementMode !== "ENFORCED"
      || hasPermission(context, PERMISSIONS.PROCUREMENT_READ)
      || hasPermission(context, PERMISSIONS.PARTS_READ);
    const canFinancial = context.enforcementMode !== "ENFORCED" || hasPermission(context, PERMISSIONS.ANALYTICS_FINANCIAL_READ);
    if (!canParts) {
      return NextResponse.json({ ok: true, permitted: false, financial: canFinancial, parts: null }, { headers: { "Cache-Control": "no-store" } });
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
      return NextResponse.json({ ok: true, permitted: true, financial: canFinancial, emptyScope: true, parts: emptyAnalytics(canFinancial) }, { headers: { "Cache-Control": "no-store" } });
    }

    let scopedWorkOrderIds: string[] | null = null;
    if (effectiveLocationIds) {
      const rows = await prisma.serviceAppointment.findMany({
        where: {
          locationId: { in: effectiveLocationIds },
          workOrderId: { not: null },
          NOT: { id: { startsWith: "demo_" } },
        },
        select: { workOrderId: true },
        distinct: ["workOrderId"],
      });
      scopedWorkOrderIds = rows.map((row) => row.workOrderId).filter((id): id is string => Boolean(id));
      if (!scopedWorkOrderIds.length) {
        return NextResponse.json({
          ok: true,
          permitted: true,
          financial: canFinancial,
          range: { from: dayKey(from), to: dayKey(new Date(to.getTime() - 1)), timezone: KYIV_TZ },
          parts: emptyAnalytics(canFinancial),
        }, { headers: { "Cache-Control": "no-store" } });
      }
    }

    const periodTouch = [
      { createdAt: { gte: from, lt: to } },
      { selectedAt: { gte: from, lt: to } },
      { approvedAt: { gte: from, lt: to } },
      { orderedAt: { gte: from, lt: to } },
      { receivedAt: { gte: from, lt: to } },
      { installedAt: { gte: from, lt: to } },
    ];

    const requests = await prisma.partsRequest.findMany({
      where: {
        ...(scopedWorkOrderIds ? { workOrderId: { in: scopedWorkOrderIds } } : {}),
        OR: periodTouch,
        NOT: { workOrderId: { startsWith: "demo_" } },
      },
      include: { items: true },
      orderBy: { updatedAt: "desc" },
      take: 1000,
    });

    const supplierIds = Array.from(new Set(requests.flatMap((row) => row.items.map((item) => item.supplierId).filter((id): id is string => Boolean(id)))));
    const suppliers = supplierIds.length
      ? await prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true, code: true } })
      : [];
    const supplierById = new Map(suppliers.map((row) => [row.id, row]));

    let requestedQty = 0;
    let receivedQty = 0;
    let installedQty = 0;
    let pendingRequiredQty = 0;
    let overdueEtaItems = 0;
    let purchaseValue = 0;
    let installedRevenue = 0;
    let installedCost = 0;
    const supplyHours: number[] = [];
    const itemMap = new Map<string, {
      name: string;
      article: string | null;
      brand: string | null;
      requestedQty: number;
      receivedQty: number;
      installedQty: number;
      revenue: number;
      profit: number;
    }>();
    const supplierMap = new Map<string, {
      supplierId: string;
      name: string;
      requests: Set<string>;
      items: number;
      requestedQty: number;
      receivedQty: number;
      purchaseValue: number;
    }>();
    const now = new Date();

    for (const requestRow of requests) {
      const supplied = hoursBetween(requestRow.orderedAt, requestRow.receivedAt);
      if (supplied != null) supplyHours.push(supplied);
      for (const item of requestRow.items) {
        const quantity = numberOf(item.quantity);
        const received = numberOf(item.receivedQuantity);
        const installed = numberOf(item.installedQuantity);
        const purchasePrice = numberOf(item.purchasePrice);
        const sellPrice = numberOf(item.sellPrice);
        requestedQty += quantity;
        receivedQty += received;
        installedQty += installed;
        purchaseValue += purchasePrice * received;
        installedRevenue += sellPrice * installed;
        installedCost += purchasePrice * installed;
        if (item.requiredForRepair && !TERMINAL_STATUSES.has(requestRow.status)) {
          pendingRequiredQty += Math.max(0, quantity - received);
        }
        if (item.etaAt && item.etaAt < now && received < quantity && !TERMINAL_STATUSES.has(requestRow.status)) {
          overdueEtaItems += 1;
        }

        const itemKey = [item.article || "", item.brand || "", item.description].join("|").toLocaleLowerCase("uk-UA");
        const itemName = [item.brand, item.description].filter(Boolean).join(" · ") || item.description;
        const currentItem = itemMap.get(itemKey) || {
          name: itemName,
          article: item.article,
          brand: item.brand,
          requestedQty: 0,
          receivedQty: 0,
          installedQty: 0,
          revenue: 0,
          profit: 0,
        };
        currentItem.requestedQty += quantity;
        currentItem.receivedQty += received;
        currentItem.installedQty += installed;
        currentItem.revenue += sellPrice * installed;
        currentItem.profit += (sellPrice - purchasePrice) * installed;
        itemMap.set(itemKey, currentItem);

        if (item.supplierId) {
          const supplier = supplierById.get(item.supplierId);
          const currentSupplier = supplierMap.get(item.supplierId) || {
            supplierId: item.supplierId,
            name: supplier?.name || "Постачальник",
            requests: new Set<string>(),
            items: 0,
            requestedQty: 0,
            receivedQty: 0,
            purchaseValue: 0,
          };
          currentSupplier.requests.add(requestRow.id);
          currentSupplier.items += 1;
          currentSupplier.requestedQty += quantity;
          currentSupplier.receivedQty += received;
          currentSupplier.purchaseValue += purchasePrice * received;
          supplierMap.set(item.supplierId, currentSupplier);
        }
      }
    }

    const installedProfit = installedRevenue - installedCost;
    const statusLabels: Record<string, string> = {
      NEW: "Нові",
      SELECTING: "Підбір",
      SELECTED: "Підібрано",
      WAITING_APPROVAL: "Погодження",
      APPROVED: "Погоджено",
      ORDER_REQUIRED: "Треба замовити",
      ORDERED: "Замовлено",
      PARTIALLY_RECEIVED: "Частково отримано",
      RECEIVED: "Отримано",
      INSTALLED: "Встановлено",
      RETURNED: "Повернення",
      CANCELLED: "Скасовано",
    };
    const statusCount = new Map<string, number>();
    for (const row of requests) statusCount.set(row.status, (statusCount.get(row.status) || 0) + 1);

    return NextResponse.json({
      ok: true,
      permitted: true,
      financial: canFinancial,
      range: { from: dayKey(from), to: dayKey(new Date(to.getTime() - 1)), timezone: KYIV_TZ },
      parts: {
        requests: requests.length,
        items: requests.reduce((sum, row) => sum + row.items.length, 0),
        requestedQty: round(requestedQty, 2),
        receivedQty: round(receivedQty, 2),
        installedQty: round(installedQty, 2),
        pendingRequiredQty: round(pendingRequiredQty, 2),
        overdueEtaItems,
        averageSupplyHours: supplyHours.length ? round(supplyHours.reduce((sum, value) => sum + value, 0) / supplyHours.length, 1) : 0,
        purchaseValue: canFinancial ? round(purchaseValue) : null,
        installedRevenue: canFinancial ? round(installedRevenue) : null,
        installedProfit: canFinancial ? round(installedProfit) : null,
        installedMarginPct: canFinancial ? pct(installedProfit, installedRevenue) : null,
        statusBreakdown: [...statusCount.entries()].map(([status, count]) => ({ status, label: statusLabels[status] || status, count })).sort((a, b) => b.count - a.count),
        topItems: [...itemMap.values()]
          .sort((a, b) => b.installedQty - a.installedQty || b.receivedQty - a.receivedQty || b.requestedQty - a.requestedQty)
          .slice(0, 20)
          .map((row) => ({
            ...row,
            requestedQty: round(row.requestedQty, 2),
            receivedQty: round(row.receivedQty, 2),
            installedQty: round(row.installedQty, 2),
            revenue: canFinancial ? round(row.revenue) : null,
            profit: canFinancial ? round(row.profit) : null,
          })),
        suppliers: [...supplierMap.values()]
          .map((row) => ({
            supplierId: row.supplierId,
            name: row.name,
            requests: row.requests.size,
            items: row.items,
            requestedQty: round(row.requestedQty, 2),
            receivedQty: round(row.receivedQty, 2),
            fulfillmentPct: pct(row.receivedQty, row.requestedQty),
            purchaseValue: canFinancial ? round(row.purchaseValue) : null,
          }))
          .sort((a, b) => (b.purchaseValue || b.receivedQty) - (a.purchaseValue || a.receivedQty)),
        stockLedgerAvailable: false,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/analytics/parts failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити аналітику запчастин." }, { status: 500 });
  }
}
