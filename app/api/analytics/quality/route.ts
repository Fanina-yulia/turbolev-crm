import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext, hasPermission } from "@/src/security/access-context";
import { PERMISSIONS, type AccessScopeCode } from "@/src/security/permissions";
import { getQualityAnalytics } from "@/src/services/quality-analytics.service";

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
  const total = Number(match[2]) * 60 + Number(match[3] || 0);
  return match[1] === "+" ? total : -total;
}

function kyivDateStartUtc(year: number, month: number, day: number) {
  const probe = new Date(Date.UTC(year, month - 1, day, 12));
  return new Date(Date.UTC(year, month - 1, day, 0, -kyivOffsetMinutes(probe)));
}

function parseKyivDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  return year && month && day ? kyivDateStartUtc(year, month, day) : null;
}

function addKyivDay(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1, 12));
  const parts = kyivParts(next);
  return kyivDateStartUtc(parts.year, parts.month, parts.day);
}

function defaults() {
  const now = kyivParts();
  const nextYear = now.month === 12 ? now.year + 1 : now.year;
  const nextMonth = now.month === 12 ? 1 : now.month + 1;
  return { from: kyivDateStartUtc(now.year, now.month, 1), to: kyivDateStartUtc(nextYear, nextMonth, 1) };
}

function dayKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: KYIV_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function permissionScope(context: Awaited<ReturnType<typeof getAccessContext>>, permission: string) {
  return context.permissions[permission as keyof typeof context.permissions] as AccessScopeCode | undefined;
}

export async function GET(request: NextRequest) {
  const context = await getAccessContext(request);
  if (context.enforcementMode === "ENFORCED" && context.provisioningState !== "ACTIVE") {
    return NextResponse.json({ ok: false, error: context.authenticated ? "Доступ до CRM не активований." : "Потрібна авторизація." }, { status: context.authenticated ? 403 : 401 });
  }
  if (context.enforcementMode === "ENFORCED" && !hasPermission(context, PERMISSIONS.ANALYTICS_READ)) {
    return NextResponse.json({ ok: false, error: "Немає доступу до аналітики." }, { status: 403 });
  }
  const permitted = context.enforcementMode !== "ENFORCED"
    || (hasPermission(context, PERMISSIONS.QC_READ) && hasPermission(context, PERMISSIONS.WARRANTY_READ));
  if (!permitted) {
    return NextResponse.json({ ok: true, permitted: false, quality: null }, { headers: { "Cache-Control": "no-store" } });
  }

  const range = defaults();
  const from = parseKyivDate(request.nextUrl.searchParams.get("from")) ?? range.from;
  const to = addKyivDay(request.nextUrl.searchParams.get("to")) ?? range.to;
  if (from >= to) return NextResponse.json({ ok: false, error: "INVALID_DATE_RANGE" }, { status: 400 });

  try {
    const analyticsScope = context.enforcementMode === "ENFORCED" ? permissionScope(context, PERMISSIONS.ANALYTICS_READ) : "ALL";
    const qcScope = context.enforcementMode === "ENFORCED" ? permissionScope(context, PERMISSIONS.QC_READ) : "ALL";
    const warrantyScope = context.enforcementMode === "ENFORCED" ? permissionScope(context, PERMISSIONS.WARRANTY_READ) : "ALL";
    const unrestricted = analyticsScope === "ALL" && qcScope === "ALL" && warrantyScope === "ALL";

    const prisma = getPrisma();
    const locations = await prisma.serviceLocation.findMany({
      where: { isActive: true }, select: { id: true, name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    const allowedLocations = unrestricted || context.enforcementMode !== "ENFORCED"
      ? locations
      : locations.filter((location) => context.locationIds.includes(location.id));
    const requestedLocationId = request.nextUrl.searchParams.get("locationId")?.trim() || null;
    const selectedLocationId = requestedLocationId && allowedLocations.some((row) => row.id === requestedLocationId) ? requestedLocationId : null;
    const effectiveLocationIds = selectedLocationId ? [selectedLocationId] : unrestricted || context.enforcementMode !== "ENFORCED" ? null : allowedLocations.map((row) => row.id);

    if (effectiveLocationIds && effectiveLocationIds.length === 0) {
      return NextResponse.json({ ok: true, permitted: true, emptyScope: true, quality: null }, { headers: { "Cache-Control": "no-store" } });
    }

    const quality = await getQualityAnalytics({ from, to, locationIds: effectiveLocationIds });
    return NextResponse.json({
      ok: true,
      permitted: true,
      canWriteWarrantyCost: context.enforcementMode !== "ENFORCED" || hasPermission(context, PERMISSIONS.WARRANTY_WRITE),
      range: { from: dayKey(from), to: dayKey(new Date(to.getTime() - 1)), timezone: KYIV_TZ },
      scope: { selectedLocationId, locationIds: effectiveLocationIds },
      quality,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[analytics/quality] failed", { message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "Не вдалося побудувати аналітику якості." }, { status: 500 });
  }
}
