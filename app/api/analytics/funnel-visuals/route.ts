import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const KYIV_TZ = "Europe/Kyiv";
const ARRIVED_STATUSES = new Set([
  "ARRIVED", "DIAGNOSTICS", "WAITING_PARTS_SELECTION", "WAITING_CALCULATION", "WAITING_APPROVAL",
  "WAITING_PARTS", "READY_FOR_REPAIR", "IN_REPAIR", "WAITING_QC", "WAITING_PAYMENT", "READY_FOR_PICKUP",
  "COMPLETED", "WARRANTY", "PAUSED",
]);

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
function addUtcDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 86_400_000);
}

export async function GET(request: NextRequest) {
  try {
    const requestedLocationId = request.nextUrl.searchParams.get("locationId")?.trim() || null;
    const access = await authorizeScopedLocation(PERMISSIONS.ANALYTICS_READ, request, requestedLocationId);
    if (!access.ok) return access.response;

    const defaults = currentMonthRange();
    const from = parseKyivDate(request.nextUrl.searchParams.get("from")) ?? defaults.from;
    const to = addKyivDay(request.nextUrl.searchParams.get("to")) ?? defaults.to;
    if (from >= to) return NextResponse.json({ ok: false, error: "INVALID_DATE_RANGE" }, { status: 400 });

    const prisma = getPrisma();
    const effectiveLocationIds = requestedLocationId
      ? [requestedLocationId]
      : access.allowedLocationIds;

    if (effectiveLocationIds && effectiveLocationIds.length === 0) {
      return NextResponse.json({ ok: true, timeline: [], totals: { scheduled: 0, arrived: 0, completed: 0 } }, { headers: { "Cache-Control": "no-store" } });
    }

    const rows = await prisma.serviceAppointment.findMany({
      where: {
        ...(effectiveLocationIds ? { locationId: { in: effectiveLocationIds } } : {}),
        plannedStartAt: { gte: from, lt: to },
        NOT: { id: { startsWith: "demo_" } },
        status: { notIn: ["CANCELLED", "RESERVE"] },
      },
      select: {
        plannedStartAt: true,
        actualArrivalAt: true,
        actualEndAt: true,
        status: true,
      },
      orderBy: { plannedStartAt: "asc" },
    });

    const map = new Map<string, { scheduled: number; arrived: number; completed: number }>();
    for (let cursor = from; cursor < to; cursor = addUtcDays(cursor, 1)) {
      map.set(dayKey(cursor), { scheduled: 0, arrived: 0, completed: 0 });
    }

    for (const row of rows) {
      const key = dayKey(row.plannedStartAt);
      const current = map.get(key) || { scheduled: 0, arrived: 0, completed: 0 };
      current.scheduled += 1;
      if (row.actualArrivalAt || ARRIVED_STATUSES.has(row.status)) current.arrived += 1;
      if (row.actualEndAt || row.status === "COMPLETED") current.completed += 1;
      map.set(key, current);
    }

    const timeline = [...map.entries()].map(([date, value]) => ({ date, ...value }));
    const totals = timeline.reduce((acc, row) => ({
      scheduled: acc.scheduled + row.scheduled,
      arrived: acc.arrived + row.arrived,
      completed: acc.completed + row.completed,
    }), { scheduled: 0, arrived: 0, completed: 0 });

    return NextResponse.json({
      ok: true,
      range: { from: dayKey(from), to: dayKey(new Date(to.getTime() - 1)), timezone: KYIV_TZ },
      timeline,
      totals,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[analytics/funnel-visuals] GET failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити графіки воронки." }, { status: 500 });
  }
}
