import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext, hasPermission } from "@/src/security/access-context";
import { PERMISSIONS, type AccessScopeCode } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const KYIV_TZ = "Europe/Kyiv";
const ISSUE_STATES = ["ATTENTION", "DEFECT"] as const;

function numberOf(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function round(value: number, digits = 1) {
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
function minutesBetween(start: Date | null, end: Date | null) {
  if (!start || !end) return null;
  return Math.max(0, end.getTime() - start.getTime()) / 60_000;
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

    const canDiagnostics = context.enforcementMode !== "ENFORCED" || hasPermission(context, PERMISSIONS.DIAGNOSTICS_READ);
    if (!canDiagnostics) {
      return NextResponse.json({ ok: true, permitted: false, diagnostics: null }, { headers: { "Cache-Control": "no-store" } });
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
      return NextResponse.json({ ok: true, permitted: true, emptyScope: true, diagnostics: null }, { headers: { "Cache-Control": "no-store" } });
    }

    let scopedDiagnosticIds: string[] | null = null;
    if (effectiveLocationIds) {
      const assignments = await prisma.diagnosticAssignment.findMany({
        where: { locationId: { in: effectiveLocationIds } },
        select: { diagnosticRequestId: true },
      });
      scopedDiagnosticIds = Array.from(new Set(assignments.map((row) => row.diagnosticRequestId)));
      if (!scopedDiagnosticIds.length) {
        return NextResponse.json({
          ok: true,
          permitted: true,
          range: { from: dayKey(from), to: dayKey(new Date(to.getTime() - 1)), timezone: KYIV_TZ },
          diagnostics: {
            created: 0,
            confirmed: 0,
            completed: 0,
            convertedToWorkOrder: 0,
            conversionPct: 0,
            averageInspectionMinutes: 0,
            checks: { checked: 0, ok: 0, attention: 0, defect: 0, critical: 0 },
            topIssues: [],
            topSuggestedParts: [],
            topSuggestedWorks: [],
            daily: [],
          },
        }, { headers: { "Cache-Control": "no-store" } });
      }
    }

    const diagnosticScopeWhere = scopedDiagnosticIds ? { id: { in: scopedDiagnosticIds } } : {};
    const createdDiagnostics = await prisma.diagnosticRequest.findMany({
      where: {
        ...diagnosticScopeWhere,
        createdAt: { gte: from, lt: to },
        status: { not: "CANCELLED" },
        NOT: { id: { startsWith: "demo_" } },
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
        confirmedAt: true,
        workOrder: { select: { id: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const inspectionWhere = scopedDiagnosticIds
      ? {
          diagnosticRequestId: { in: scopedDiagnosticIds },
          OR: [
            { createdAt: { gte: from, lt: to } },
            { startedAt: { gte: from, lt: to } },
            { completedAt: { gte: from, lt: to } },
          ],
        }
      : {
          OR: [
            { createdAt: { gte: from, lt: to } },
            { startedAt: { gte: from, lt: to } },
            { completedAt: { gte: from, lt: to } },
          ],
        };

    const inspections = await prisma.diagnosticInspection.findMany({
      where: inspectionWhere,
      select: { id: true, diagnosticRequestId: true, status: true, startedAt: true, completedAt: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const inspectionIds = inspections.map((row) => row.id);

    const checks = inspectionIds.length
      ? await prisma.diagnosticCheck.findMany({
          where: { inspectionId: { in: inspectionIds }, state: { not: "NOT_CHECKED" } },
          select: { id: true, inspectionId: true, templateItemId: true, state: true, checkedAt: true },
        })
      : [];
    const checkIds = checks.map((row) => row.id);
    const templateItemIds = Array.from(new Set(checks.map((row) => row.templateItemId)));

    const [templateItems, findings] = await Promise.all([
      templateItemIds.length
        ? prisma.diagnosticTemplateItem.findMany({
            where: { id: { in: templateItemIds } },
            select: { id: true, name: true, suggestedPartName: true, suggestedWorkName: true },
          })
        : Promise.resolve([]),
      checkIds.length
        ? prisma.diagnosticFinding.findMany({
            where: { checkId: { in: checkIds } },
            select: {
              checkId: true,
              urgency: true,
              action: true,
              findingText: true,
              suggestedPartName: true,
              suggestedWorkName: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const itemById = new Map(templateItems.map((row) => [row.id, row]));
    const findingByCheck = new Map(findings.map((row) => [row.checkId, row]));
    const issueMap = new Map<string, { name: string; attention: number; defect: number; total: number }>();
    const partMap = new Map<string, number>();
    const workMap = new Map<string, number>();

    for (const check of checks) {
      if (!ISSUE_STATES.includes(check.state as (typeof ISSUE_STATES)[number])) continue;
      const item = itemById.get(check.templateItemId);
      const finding = findingByCheck.get(check.id);
      const name = item?.name || finding?.findingText || "Інше зауваження";
      const current = issueMap.get(name) || { name, attention: 0, defect: 0, total: 0 };
      current.total += 1;
      if (check.state === "ATTENTION") current.attention += 1;
      if (check.state === "DEFECT") current.defect += 1;
      issueMap.set(name, current);

      const partName = finding?.suggestedPartName || item?.suggestedPartName;
      if (partName) partMap.set(partName, (partMap.get(partName) || 0) + 1);
      const workName = finding?.suggestedWorkName || item?.suggestedWorkName;
      if (workName) workMap.set(workName, (workMap.get(workName) || 0) + 1);
    }

    const completedInspections = inspections.filter((row) => Boolean(row.completedAt));
    const inspectionDurations = completedInspections
      .map((row) => minutesBetween(row.startedAt || row.createdAt, row.completedAt))
      .filter((value): value is number => value != null);
    const averageInspectionMinutes = inspectionDurations.length
      ? round(inspectionDurations.reduce((sum, value) => sum + value, 0) / inspectionDurations.length, 0)
      : 0;

    const confirmed = createdDiagnostics.filter((row) => Boolean(row.confirmedAt) || row.status === "CONFIRMED").length;
    const convertedToWorkOrder = createdDiagnostics.filter((row) => Boolean(row.workOrder)).length;
    const completedDiagnosticIds = new Set(completedInspections.map((row) => row.diagnosticRequestId));
    const critical = findings.filter((row) => row.urgency === "CRITICAL").length;

    const dailyMap = new Map<string, { created: number; completed: number; issues: number }>();
    for (const row of createdDiagnostics) {
      const key = dayKey(row.createdAt);
      const current = dailyMap.get(key) || { created: 0, completed: 0, issues: 0 };
      current.created += 1;
      dailyMap.set(key, current);
    }
    for (const inspection of completedInspections) {
      if (!inspection.completedAt) continue;
      const key = dayKey(inspection.completedAt);
      const current = dailyMap.get(key) || { created: 0, completed: 0, issues: 0 };
      current.completed += 1;
      dailyMap.set(key, current);
    }
    const inspectionById = new Map(inspections.map((row) => [row.id, row]));
    for (const check of checks) {
      if (!ISSUE_STATES.includes(check.state as (typeof ISSUE_STATES)[number])) continue;
      const inspection = inspectionById.get(check.inspectionId);
      const stamp = check.checkedAt || inspection?.completedAt || inspection?.startedAt || inspection?.createdAt;
      if (!stamp) continue;
      const key = dayKey(stamp);
      const current = dailyMap.get(key) || { created: 0, completed: 0, issues: 0 };
      current.issues += 1;
      dailyMap.set(key, current);
    }

    return NextResponse.json({
      ok: true,
      permitted: true,
      range: { from: dayKey(from), to: dayKey(new Date(to.getTime() - 1)), timezone: KYIV_TZ },
      diagnostics: {
        created: createdDiagnostics.length,
        confirmed,
        completed: completedDiagnosticIds.size,
        convertedToWorkOrder,
        conversionPct: pct(convertedToWorkOrder, createdDiagnostics.length),
        averageInspectionMinutes,
        checks: {
          checked: checks.length,
          ok: checks.filter((row) => row.state === "OK").length,
          attention: checks.filter((row) => row.state === "ATTENTION").length,
          defect: checks.filter((row) => row.state === "DEFECT").length,
          critical,
        },
        topIssues: [...issueMap.values()].sort((a, b) => b.total - a.total || b.defect - a.defect).slice(0, 12),
        topSuggestedParts: [...partMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 10),
        topSuggestedWorks: [...workMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 10),
        daily: [...dailyMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, ...value })),
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/analytics/diagnostics failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити аналітику діагностики." }, { status: 500 });
  }
}
