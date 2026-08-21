import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext, hasPermission } from "@/src/security/access-context";
import { PERMISSIONS, type AccessScopeCode, type PermissionCode } from "@/src/security/permissions";
import { buildAttentionCenter, type AttentionCenterResult, type AttentionSignal } from "@/src/services/attention-center.service";
import { createManualTask, listTasksForUser } from "@/src/services/tasks.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MINUTE_MS = 60_000;
const KYIV_TZ = "Europe/Kyiv";
const WALK_IN_PAYMENT_SOURCE = "WALK_IN_DIAGNOSTIC_PAYMENT";

function authorizeTasks(context: Awaited<ReturnType<typeof getAccessContext>>) {
  if (context.provisioningState !== "ACTIVE" || !context.user) return { ok: false as const, status: 401 };
  if (context.enforcementMode === "ENFORCED" && !hasPermission(context, PERMISSIONS.OVERVIEW_READ)) return { ok: false as const, status: 403 };
  return { ok: true as const, userId: context.user.id };
}

function can(context: Awaited<ReturnType<typeof getAccessContext>>, permission: PermissionCode) {
  return context.enforcementMode !== "ENFORCED" || hasPermission(context, permission);
}

function locationIdsFor(context: Awaited<ReturnType<typeof getAccessContext>>, permission: PermissionCode): string[] | null {
  if (context.enforcementMode !== "ENFORCED") return null;
  const scope = context.permissions[permission] as AccessScopeCode | undefined;
  if (scope === "ALL") return null;
  return context.locationIds;
}

function hasNetworkPayrollAccess(context: Awaited<ReturnType<typeof getAccessContext>>) {
  if (context.enforcementMode !== "ENFORCED") return true;
  const candidates: PermissionCode[] = [PERMISSIONS.PAYROLL_ALL_READ, PERMISSIONS.PAYROLL_WRITE, PERMISSIONS.PAYROLL_CLOSE];
  return candidates.some((permission) => hasPermission(context, permission) && context.permissions[permission] === "ALL");
}

function walkInDiagnosticId(comment: string | null) {
  return comment?.match(/WALK_IN_DIAGNOSTIC:([^\s]+)/)?.[1] || null;
}

function sameKyivDay(a: Date, b: Date) {
  const format = (value: Date) => new Intl.DateTimeFormat("en-CA", {
    timeZone: KYIV_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
  return format(a) === format(b);
}

function attentionLevelRank(level: AttentionSignal["level"]) {
  return level === "CRITICAL" ? 0 : level === "HIGH" ? 1 : level === "MEDIUM" ? 2 : 3;
}

function attentionBucketRank(bucket: AttentionSignal["bucket"]) {
  return bucket === "ACTION" ? 0 : bucket === "WAITING" ? 1 : 2;
}

function refreshAttentionSummary(attention: AttentionCenterResult, additions: AttentionSignal[]): AttentionCenterResult {
  if (!additions.length) return attention;
  const signals = [...attention.signals, ...additions].sort((a, b) => {
    const level = attentionLevelRank(a.level) - attentionLevelRank(b.level);
    if (level) return level;
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
    const bucket = attentionBucketRank(a.bucket) - attentionBucketRank(b.bucket);
    if (bucket) return bucket;
    return new Date(a.dueAt || a.occurredAt).getTime() - new Date(b.dueAt || b.occurredAt).getTime();
  });
  const categories = { ...attention.categories };
  for (const item of additions) categories[item.category] = (categories[item.category] || 0) + 1;
  return {
    ...attention,
    signals,
    categories,
    summary: {
      total: signals.length,
      critical: signals.filter((item) => item.level === "CRITICAL").length,
      overdue: signals.filter((item) => item.isOverdue).length,
      action: signals.filter((item) => item.bucket === "ACTION").length,
      waiting: signals.filter((item) => item.bucket === "WAITING").length,
      today: signals.filter((item) => item.isToday).length,
    },
  };
}

async function appendWalkInAttention(attention: AttentionCenterResult, plannerLocationIds: string[] | null, canSeeAmounts: boolean) {
  const prisma = getPrisma();
  const now = new Date();
  const appointments = await prisma.serviceAppointment.findMany({
    where: {
      source: "WALK_IN",
      status: "WAITING_PAYMENT",
      NOT: { id: { startsWith: "demo_" } },
      ...(plannerLocationIds ? { locationId: { in: plannerLocationIds } } : {}),
    },
    select: {
      id: true,
      clientId: true,
      vehicleId: true,
      customerName: true,
      vehicleLabel: true,
      plateNumber: true,
      problem: true,
      comment: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "asc" },
    take: 100,
  });
  if (!appointments.length) return attention;

  const diagnosticIds = appointments.map((row) => walkInDiagnosticId(row.comment)).filter((id): id is string => Boolean(id));
  const paymentRows = diagnosticIds.length
    ? await prisma.cashTransaction.findMany({
        where: {
          sourceEntity: WALK_IN_PAYMENT_SOURCE,
          sourceEntityId: { in: diagnosticIds.map((id) => `${id}:payment`) },
          status: "POSTED",
        },
        select: { sourceEntityId: true, amount: true, currency: true, occurredAt: true },
      })
    : [];
  const payments = new Map(paymentRows.map((row) => [row.sourceEntityId.replace(/:payment$/, ""), row]));

  const additions: AttentionSignal[] = appointments.map((row) => {
    const diagnosticId = walkInDiagnosticId(row.comment);
    const payment = diagnosticId ? payments.get(diagnosticId) : null;
    const anchor = payment?.occurredAt || row.updatedAt;
    const dueAt = new Date(anchor.getTime() + (payment ? 15 : 60) * MINUTE_MS);
    const overdueMinutes = dueAt < now ? Math.max(1, Math.floor((now.getTime() - dueAt.getTime()) / MINUTE_MS)) : 0;
    const ageMinutes = Math.max(0, Math.floor((now.getTime() - anchor.getTime()) / MINUTE_MS));
    const label = row.plateNumber || row.vehicleLabel || row.customerName || "Авто";
    const level: AttentionSignal["level"] = payment
      ? ageMinutes >= 120 ? "CRITICAL" : ageMinutes >= 30 ? "HIGH" : "MEDIUM"
      : ageMinutes >= 240 ? "CRITICAL" : ageMinutes >= 60 ? "HIGH" : "MEDIUM";

    return {
      id: `walk-in:${row.id}:${payment ? "route" : "payment"}`,
      sourceType: payment ? "WALK_IN_ROUTE" : "WALK_IN_PAYMENT",
      sourceId: row.id,
      taskId: null,
      title: payment ? `${label}: оплату отримано — потрібен наступний крок` : `${label}: позапланова діагностика очікує оплату`,
      description: row.problem || null,
      reason: payment
        ? "Діагностику оплачено, але візит ще не завершено і авто не передано на розрахунок ремонту."
        : "Позапланову діагностику завершено, але оплата ще не зафіксована.",
      category: payment ? "SERVICE" : "DIAGNOSTICS",
      level,
      bucket: payment ? "ACTION" : "WAITING",
      dueAt: dueAt.toISOString(),
      occurredAt: anchor.toISOString(),
      isOverdue: overdueMinutes > 0,
      overdueMinutes,
      isToday: sameKyivDay(dueAt, now),
      autoGenerated: true,
      amount: payment && canSeeAmounts ? Number(payment.amount) : null,
      currency: payment && canSeeAmounts ? payment.currency : null,
      counterparty: row.customerName || null,
      action: row.vehicleId
        ? { label: payment ? "Обрати наступний крок" : "Закрити оплату", section: "Діагностика", params: { vehicleId: row.vehicleId } }
        : { label: "Відкрити запис", section: "Планувальник", params: { appointmentId: row.id } },
      metadata: {
        walkIn: true,
        diagnosticId,
        appointmentId: row.id,
        clientId: row.clientId,
        vehicleId: row.vehicleId,
        paid: Boolean(payment),
      },
    };
  });

  return refreshAttentionSummary(attention, additions);
}

export async function GET(request: NextRequest) {
  try {
    const context = await getAccessContext(request);
    const auth = authorizeTasks(context);
    if (!auth.ok) return NextResponse.json({ ok: false, error: "Access denied" }, { status: auth.status });

    const tasks = await listTasksForUser(auth.userId);
    const plannerLocationIds = locationIdsFor(context, PERMISSIONS.PLANNER_READ);
    const canFinance = can(context, PERMISSIONS.FINANCE_READ);
    const baseAttention = await buildAttentionCenter({
      userId: auth.userId,
      tasks,
      canCommunications: can(context, PERMISSIONS.COMMUNICATIONS_READ),
      canPlanner: can(context, PERMISSIONS.PLANNER_READ),
      canProcurement: can(context, PERMISSIONS.PROCUREMENT_READ),
      canFinance,
      canPayrollNetwork: hasNetworkPayrollAccess(context),
      plannerLocationIds,
      procurementLocationIds: locationIdsFor(context, PERMISSIONS.PROCUREMENT_READ),
      financeLocationIds: locationIdsFor(context, PERMISSIONS.FINANCE_READ),
    });
    const attention = can(context, PERMISSIONS.PLANNER_READ)
      ? await appendWalkInAttention(baseAttention, plannerLocationIds, canFinance)
      : baseAttention;

    return NextResponse.json({
      ok: true,
      tasks,
      attention,
      serverTime: new Date().toISOString(),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("GET /api/tasks failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити центр уваги" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await getAccessContext(request);
    const auth = authorizeTasks(context);
    if (!auth.ok) return NextResponse.json({ ok: false, error: "Access denied" }, { status: auth.status });
    const body = await request.json() as Record<string, unknown>;
    const task = await createManualTask(auth.userId, body);
    return NextResponse.json({ ok: true, task }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (message === "TITLE_REQUIRED" || message === "INVALID_DATE") return NextResponse.json({ ok: false, error: message }, { status: 422 });
    console.error("POST /api/tasks failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося створити задачу" }, { status: 500 });
  }
}