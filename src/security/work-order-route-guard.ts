import "server-only";

import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import type { AccessContext } from "@/src/security/access-context";
import { PERMISSIONS, type AccessScopeCode } from "@/src/security/permissions";
import { canAccessWorkOrder } from "@/src/security/work-order-scope";

export type WorkOrderGuardOk = {
  ok: true;
  context: AccessContext;
  grantedScope: AccessScopeCode | null;
  /** Server-derived executor identity. Never taken from the request body. */
  actorName: string;
};
export type WorkOrderGuardDenied = { ok: false; response: Response };

export function sessionActorName(context: AccessContext) {
  return (context.user?.employeeName || context.user?.name || "CRM").trim().slice(0, 160);
}

/**
 * 401 — no session; 403 — missing permission/scope; 404 — work order outside the
 * caller's station/assignment (same non-disclosing semantics as /api/work-orders/[id]).
 */
export async function guardWorkOrder(
  request: Request,
  workOrderId: string,
  permission: string,
  minimumScope: AccessScopeCode,
): Promise<WorkOrderGuardOk | WorkOrderGuardDenied> {
  const access = await authorize(permission, { strict: true, request, minimumScope });
  if (!access.allowed) return { ok: false, response: access.response! };
  if (!(await canAccessWorkOrder(access.context, access.grantedScope, workOrderId))) {
    return { ok: false, response: NextResponse.json({ ok: false, error: "Замовлення-наряд не знайдено." }, { status: 404 }) };
  }
  return { ok: true, context: access.context, grantedScope: access.grantedScope, actorName: sessionActorName(access.context) };
}

/**
 * Executors of the repair = active mechanics (and their users) on the work order's
 * appointments. QC approver must not be one of them.
 */
export async function getWorkOrderExecutorUserIds(workOrderId: string): Promise<string[]> {
  const prisma = getPrisma();
  const [appointments, lines] = await Promise.all([
    prisma.serviceAppointment.findMany({ where: { workOrderId, mechanicId: { not: null } }, select: { mechanicId: true } }),
    prisma.workOrderLine.findMany({ where: { workOrderId, mechanicId: { not: null } }, select: { mechanicId: true } }),
  ]);
  const mechanicIds = [...new Set([...appointments, ...lines].map((row) => row.mechanicId).filter((value): value is string => Boolean(value)))];
  if (!mechanicIds.length) return [];
  const mechanics = await prisma.serviceMechanic.findMany({ where: { id: { in: mechanicIds } }, select: { userId: true } });
  return [...new Set(mechanics.map((row) => row.userId).filter((value): value is string => Boolean(value)))];
}

export async function isWorkOrderExecutor(context: AccessContext, workOrderId: string) {
  const userId = context.user?.id;
  if (!userId) return false;
  return (await getWorkOrderExecutorUserIds(workOrderId)).includes(userId);
}

/**
 * Final QC decision gate (PASS / FAIL / move to pickup or rework).
 * Requires WORK_ORDERS.QC_APPROVE (LOCATION) and that the caller is not an executor of the work order.
 * Returns a denial Response, or null when the caller may take the decision.
 */
export async function requireQcApproval(request: Request, context: AccessContext, workOrderId: string): Promise<Response | null> {
  const approve = await authorize(PERMISSIONS.WORK_ORDERS_QC_APPROVE, { strict: true, request, minimumScope: "LOCATION" });
  if (!approve.allowed) return approve.response!;
  if (await isWorkOrderExecutor(context, workOrderId)) {
    return NextResponse.json(
      { ok: false, error: "QC_APPROVER_IS_EXECUTOR", message: "Остаточне погодження QC не може виконувати виконавець ремонту." },
      { status: 403 },
    );
  }
  return null;
}
