import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext, hasPermission } from "@/src/security/access-context";
import { PERMISSIONS, type AccessScopeCode } from "@/src/security/permissions";
import { getOwnerAnalyticsEconomics } from "@/src/services/owner-analytics-economics.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const KYIV_TZ = "Europe/Kyiv";

function kyivParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: KYIV_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value),
  };
}
function kyivOffsetMinutes(date: Date) {
  const value = new Intl.DateTimeFormat("en-US", { timeZone: KYIV_TZ, timeZoneName: "shortOffset", hour: "2-digit" })
    .formatToParts(date).find((part) => part.type === "timeZoneName")?.value;
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
  return { from: kyivDateStartUtc(now.year, now.month, 1), to: kyivDateStartUtc(nextYear, nextMonth, 1) };
}
function dayKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: KYIV_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
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
    const canFinancial = context.enforcementMode !== "ENFORCED" || hasPermission(context, PERMISSIONS.ANALYTICS_FINANCIAL_READ);
    if (!canFinancial) {
      return NextResponse.json({ ok: true, permitted: false, economics: null }, { headers: { "Cache-Control": "no-store" } });
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
      return NextResponse.json({
        ok: true,
        permitted: true,
        emptyScope: true,
        range: { from: dayKey(from), to: dayKey(new Date(to.getTime() - 1)), timezone: KYIV_TZ },
        economics: { workOrders: [], clientLtv: [], cohort: { servedClients: 0, lifetimeOrders: 0, lifetimeRevenue: 0, lifetimeGrossProfit: 0 } },
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const economics = await getOwnerAnalyticsEconomics({ from, to, effectiveLocationIds });
    return NextResponse.json({
      ok: true,
      permitted: true,
      range: { from: dayKey(from), to: dayKey(new Date(to.getTime() - 1)), timezone: KYIV_TZ },
      economics,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("GET /api/analytics/owner-economics failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити економіку власника." }, { status: 500 });
  }
}
