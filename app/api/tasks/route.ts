import { NextRequest, NextResponse } from "next/server";
import { getAccessContext, hasPermission } from "@/src/security/access-context";
import { PERMISSIONS, type AccessScopeCode, type PermissionCode } from "@/src/security/permissions";
import { supplementAttentionCenter } from "@/src/services/attention-center-supplement.service";
import { appendWalkInAttention } from "@/src/services/attention-center-walk-in.service";
import { buildAttentionCenter } from "@/src/services/attention-center.service";
import { createManualTask, listTasksForUser } from "@/src/services/tasks.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET(request: NextRequest) {
  try {
    const context = await getAccessContext(request);
    const auth = authorizeTasks(context);
    if (!auth.ok) return NextResponse.json({ ok: false, error: "Access denied" }, { status: auth.status });

    const tasks = await listTasksForUser(auth.userId);
    const canPlanner = can(context, PERMISSIONS.PLANNER_READ);
    const canFinance = can(context, PERMISSIONS.FINANCE_READ);
    const plannerLocationIds = locationIdsFor(context, PERMISSIONS.PLANNER_READ);
    const canPayrollNetwork = hasNetworkPayrollAccess(context);
    const baseAttention = await buildAttentionCenter({
      userId: auth.userId,
      tasks,
      canCommunications: can(context, PERMISSIONS.COMMUNICATIONS_READ),
      canPlanner,
      canProcurement: can(context, PERMISSIONS.PROCUREMENT_READ),
      canFinance,
      canPayrollNetwork,
      plannerLocationIds,
      procurementLocationIds: locationIdsFor(context, PERMISSIONS.PROCUREMENT_READ),
      financeLocationIds: locationIdsFor(context, PERMISSIONS.FINANCE_READ),
    });
    const supplementedAttention = await supplementAttentionCenter(baseAttention, {
      canPlanner,
      plannerLocationIds,
      canPayrollNetwork,
    });
    const attention = canPlanner
      ? await appendWalkInAttention(supplementedAttention, { plannerLocationIds, canSeeAmounts: canFinance })
      : supplementedAttention;

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
