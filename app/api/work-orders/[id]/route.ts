import { NextResponse } from "next/server";
import { VehicleIssueStatus } from "@/src/generated/prisma/client";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { canAccessWorkOrder } from "@/src/security/work-order-scope";
import {
  getWorkOrder,
  transitionWorkOrder,
  WorkOrderNotFoundError,
  WorkOrderTransitionError,
} from "@/src/services/work-orders.service";
import { markWorkOrderIssues } from "@/src/services/vehicle-issues.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };

function issueStatusForWorkOrder(status: string): VehicleIssueStatus | null {
  if (status === "WAITING_APPROVAL") return VehicleIssueStatus.WAITING_CUSTOMER;
  if (status === "WAITING_PARTS") return VehicleIssueStatus.WAITING_PARTS;
  if (status === "READY_FOR_REPAIR") return VehicleIssueStatus.READY_FOR_REPAIR;
  if (status === "IN_REPAIR") return VehicleIssueStatus.IN_REPAIR;
  return null;
}

export async function GET(request: Request, context: RouteContext) {
  const access = await authorize(PERMISSIONS.WORK_ORDERS_READ, { strict: true, request, minimumScope: "ASSIGNED" });
  if (!access.allowed) return access.response!;

  const { id } = await context.params;
  try {
    if (!(await canAccessWorkOrder(access.context, access.grantedScope, id))) {
      return NextResponse.json({ ok: false, error: "Замовлення-наряд не знайдено." }, { status: 404 });
    }
    const workOrder = await getWorkOrder(id);
    if (!workOrder) return NextResponse.json({ ok: false, error: "Замовлення-наряд не знайдено." }, { status: 404 });
    return NextResponse.json({ ok: true, workOrder }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/work-orders/[id] failed", { id, message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити замовлення-наряд." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const access = await authorize(PERMISSIONS.WORK_ORDERS_WRITE, { strict: true, request, minimumScope: "LOCATION" });
  if (!access.allowed) return access.response!;

  const { id } = await context.params;
  try {
    if (!(await canAccessWorkOrder(access.context, access.grantedScope, id))) {
      return NextResponse.json({ ok: false, error: "Замовлення-наряд не знайдено." }, { status: 404 });
    }
    const body = await request.json() as Record<string, unknown>;
    const status = typeof body.status === "string" ? body.status : "";
    if (!status.trim()) return NextResponse.json({ ok: false, error: "Передайте новий статус." }, { status: 400 });
    const actorName = (access.context.user?.employeeName || access.context.user?.name || "CRM").trim().slice(0, 160);
    const workOrder = await transitionWorkOrder(id, status, actorName);

    let issueSyncWarning: string | null = null;
    const issueStatus = issueStatusForWorkOrder(workOrder.status);
    if (issueStatus) {
      try {
        await markWorkOrderIssues(id, issueStatus);
      } catch (issueError) {
        issueSyncWarning = issueError instanceof Error ? issueError.message : "Не вдалося синхронізувати стан автомобіля.";
        console.error("Vehicle issue work-order sync failed", { workOrderId: id, status: workOrder.status, issueError });
      }
    }

    return NextResponse.json({ ok: true, workOrder, issueSyncWarning });
  } catch (error) {
    if (error instanceof WorkOrderNotFoundError) {
      return NextResponse.json({ ok: false, error: "Замовлення-наряд не знайдено." }, { status: 404 });
    }
    if (error instanceof WorkOrderTransitionError) {
      return NextResponse.json({
        ok: false,
        error: error.unsupportedActions.length
          ? "Перехід потребує автоматичної дії, для якої ще немає фактичної сутності в CRM."
          : error.decision.code === "GATES_NOT_SATISFIED"
            ? "Перехід заблоковано Hard Gate."
            : "Такий перехід статусу не дозволений.",
        code: error.unsupportedActions.length ? "ACTIONS_NOT_IMPLEMENTED" : error.decision.code,
        workflowDecision: error.decision,
        unsupportedActions: error.unsupportedActions,
      }, { status: 409 });
    }
    console.error("PATCH /api/work-orders/[id] failed", { id, message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "Не вдалося змінити статус замовлення-наряду." }, { status: 500 });
  }
}
