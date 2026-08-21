import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext, hasPermission } from "@/src/security/access-context";
import { PERMISSIONS, type AccessScopeCode } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const KYIV_TZ = "Europe/Kyiv";
const PAYMENT_SOURCE = "WALK_IN_DIAGNOSTIC_PAYMENT";
const REPAIR_AUDIT_ACTION = "WALK_IN_SENT_TO_REPAIR_FLOW";

function round(value: number, digits = 1) {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}
function pct(part: number, total: number) { return total > 0 ? round((part / total) * 100) : 0; }
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
  const parts = kyivParts(new Date(Date.UTC(year, month - 1, day + 1, 12)));
  return kyivDateStartUtc(parts.year, parts.month, parts.day);
}
function currentMonthRange() {
  const now = kyivParts();
  return {
    from: kyivDateStartUtc(now.year, now.month, 1),
    to: kyivDateStartUtc(now.month === 12 ? now.year + 1 : now.year, now.month === 12 ? 1 : now.month + 1, 1),
  };
}
function dayKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: KYIV_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function diagnosticIdFromComment(comment: string | null) { return comment?.match(/WALK_IN_DIAGNOSTIC:([^\s]+)/)?.[1] || null; }

export async function GET(request: NextRequest) {
  const context = await getAccessContext(request);
  if (context.enforcementMode === "ENFORCED" && context.provisioningState !== "ACTIVE") {
    return NextResponse.json({ ok: false, error: context.authenticated ? "Доступ до CRM не активований." : "Потрібна авторизація." }, { status: context.authenticated ? 403 : 401 });
  }
  if (context.enforcementMode === "ENFORCED" && !hasPermission(context, PERMISSIONS.ANALYTICS_READ)) {
    return NextResponse.json({ ok: false, error: "Немає доступу до аналітики." }, { status: 403 });
  }

  const defaults = currentMonthRange();
  const from = parseKyivDate(request.nextUrl.searchParams.get("from")) ?? defaults.from;
  const to = addKyivDay(request.nextUrl.searchParams.get("to")) ?? defaults.to;
  if (from >= to) return NextResponse.json({ ok: false, error: "INVALID_DATE_RANGE" }, { status: 400 });

  const analyticsScope = context.enforcementMode === "ENFORCED" ? (context.permissions[PERMISSIONS.ANALYTICS_READ] as AccessScopeCode | undefined) : "ALL";
  const canFinancial = context.enforcementMode !== "ENFORCED" || hasPermission(context, PERMISSIONS.ANALYTICS_FINANCIAL_READ);
  const prisma = getPrisma();
  const locations = await prisma.serviceLocation.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const allowedLocations = analyticsScope === "ALL" || context.enforcementMode !== "ENFORCED" ? locations : locations.filter((location) => context.locationIds.includes(location.id));
  const requestedLocationId = request.nextUrl.searchParams.get("locationId")?.trim() || null;
  const selectedLocationId = requestedLocationId && allowedLocations.some((location) => location.id === requestedLocationId) ? requestedLocationId : null;
  const effectiveLocationIds = selectedLocationId ? [selectedLocationId] : analyticsScope === "ALL" || context.enforcementMode !== "ENFORCED" ? null : allowedLocations.map((location) => location.id);

  if (effectiveLocationIds && effectiveLocationIds.length === 0) {
    return NextResponse.json({ ok: true, permitted: true, financial: canFinancial, emptyScope: true, range: { from: dayKey(from), to: dayKey(new Date(to.getTime() - 1)), timezone: KYIV_TZ }, walkIn: null }, { headers: { "Cache-Control": "no-store" } });
  }

  const appointments = await prisma.serviceAppointment.findMany({
    where: { source: "WALK_IN", plannedStartAt: { gte: from, lt: to }, NOT: { id: { startsWith: "demo_" } }, ...(effectiveLocationIds ? { locationId: { in: effectiveLocationIds } } : {}) },
    select: { id: true, status: true, locationId: true, customerName: true, vehicleLabel: true, plateNumber: true, comment: true, plannedStartAt: true, actualStartAt: true, actualEndAt: true },
    orderBy: { plannedStartAt: "asc" },
    take: 2000,
  });
  const diagnosticIds = appointments.map((row) => diagnosticIdFromComment(row.comment)).filter((id): id is string => Boolean(id));
  const [payments, repairAudits] = await Promise.all([
    diagnosticIds.length ? prisma.cashTransaction.findMany({ where: { sourceEntity: PAYMENT_SOURCE, sourceEntityId: { in: diagnosticIds.map((id) => `${id}:payment`) }, status: "POSTED" }, select: { sourceEntityId: true, amount: true, currency: true, occurredAt: true } }) : Promise.resolve([]),
    diagnosticIds.length ? prisma.auditEvent.findMany({ where: { action: REPAIR_AUDIT_ACTION, entityType: "DiagnosticRequest", entityId: { in: diagnosticIds } }, select: { entityId: true }, distinct: ["entityId"] }) : Promise.resolve([]),
  ]);

  const repairIds = new Set(repairAudits.flatMap((row) => row.entityId ? [row.entityId] : []));
  const paidIds = new Set(payments.flatMap((row) => row.sourceEntityId ? [row.sourceEntityId.replace(/:payment$/, "")] : []));
  const diagnosticsReached = appointments.filter((row) => Boolean(row.actualStartAt) || Boolean(diagnosticIdFromComment(row.comment))).length;
  const completed = appointments.filter((row) => row.status === "COMPLETED" || Boolean(row.actualEndAt)).length;
  const sentToRepair = diagnosticIds.filter((id) => repairIds.has(id)).length;
  const diagnosticOnly = appointments.filter((row) => {
    const id = diagnosticIdFromComment(row.comment);
    return (row.status === "COMPLETED" || Boolean(row.actualEndAt)) && (!id || !repairIds.has(id));
  }).length;
  const paid = diagnosticIds.filter((id) => paidIds.has(id)).length;
  const awaitingPayment = appointments.filter((row) => { const id = diagnosticIdFromComment(row.comment); return row.status === "WAITING_PAYMENT" && (!id || !paidIds.has(id)); }).length;
  const awaitingRoute = appointments.filter((row) => { const id = diagnosticIdFromComment(row.comment); return row.status === "WAITING_PAYMENT" && Boolean(id && paidIds.has(id)); }).length;
  const diagnosticRevenue = payments.reduce((sum, row) => sum + Number(row.amount), 0);

  const dailyMap = new Map<string, { visits: number; diagnostics: number; paid: number; sentToRepair: number; completed: number }>();
  const byDiagnostic = new Map<string, typeof appointments[number]>();
  for (const appointment of appointments) {
    const key = dayKey(appointment.plannedStartAt);
    const row = dailyMap.get(key) || { visits: 0, diagnostics: 0, paid: 0, sentToRepair: 0, completed: 0 };
    row.visits += 1;
    if (appointment.actualStartAt || diagnosticIdFromComment(appointment.comment)) row.diagnostics += 1;
    if (appointment.status === "COMPLETED" || appointment.actualEndAt) row.completed += 1;
    const id = diagnosticIdFromComment(appointment.comment);
    if (id) byDiagnostic.set(id, appointment);
    dailyMap.set(key, row);
  }
  for (const id of paidIds) { const appointment = byDiagnostic.get(id); const row = appointment ? dailyMap.get(dayKey(appointment.plannedStartAt)) : null; if (row) row.paid += 1; }
  for (const id of repairIds) { const appointment = byDiagnostic.get(id); const row = appointment ? dailyMap.get(dayKey(appointment.plannedStartAt)) : null; if (row) row.sentToRepair += 1; }

  return NextResponse.json({
    ok: true,
    permitted: true,
    financial: canFinancial,
    range: { from: dayKey(from), to: dayKey(new Date(to.getTime() - 1)), timezone: KYIV_TZ },
    scope: { analyticsScope, selectedLocationId, locationIds: effectiveLocationIds },
    walkIn: {
      visits: appointments.length,
      diagnosticsReached,
      paid,
      diagnosticOnly,
      sentToRepair,
      completed,
      awaitingPayment,
      awaitingRoute,
      visitToDiagnosticsPct: pct(diagnosticsReached, appointments.length),
      diagnosticToPaidPct: pct(paid, diagnosticsReached),
      diagnosticToRepairPct: pct(sentToRepair, diagnosticsReached),
      visitToCompletedPct: pct(completed, appointments.length),
      diagnosticRevenue: canFinancial ? round(diagnosticRevenue, 2) : null,
      averageDiagnosticCheck: canFinancial ? (payments.length ? round(diagnosticRevenue / payments.length, 2) : 0) : null,
      currency: canFinancial ? payments[0]?.currency || "UAH" : null,
      daily: [...dailyMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, row]) => ({ date, ...row })),
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
