import { NextResponse } from "next/server";
import {
  cancelWorkOrderLine,
  updateWorkOrderLine,
  WorkOrderLineError,
} from "@/src/services/work-order-lines.service";
import { reconcileWorkOrderIssueLinks } from "@/src/services/vehicle-issues.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function actor(body: Record<string, unknown>) {
  return typeof body.actorName === "string" && body.actorName.trim()
    ? body.actorName.trim().slice(0, 120)
    : "CRM / Сервіс-менеджер";
}

function errorResponse(error: unknown) {
  if (error instanceof WorkOrderLineError) {
    const status = ["WORK_ORDER_NOT_FOUND", "LINE_NOT_FOUND"].includes(error.code)
      ? 404
      : ["ACTUAL_ALREADY_LOCKED", "INVALID_STATUS_TRANSITION", "COMPLETED_LINE_PLANNED_LOCKED"].includes(error.code)
        ? 409
        : 400;
    return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status });
  }
  console.error("[work-order-line]", error);
  return NextResponse.json({ ok: false, code: "INTERNAL_ERROR", error: "WorkOrder line operation failed" }, { status: 500 });
}

async function reconcileIssues(workOrderId: string) {
  try {
    return { issueSync: await reconcileWorkOrderIssueLinks(workOrderId), issueSyncWarning: null as string | null };
  } catch (error) {
    const issueSyncWarning = error instanceof Error ? error.message : "Не вдалося синхронізувати проблеми автомобіля.";
    console.error("Vehicle issue line reconciliation failed", { workOrderId, error });
    return { issueSync: null, issueSyncWarning };
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string; lineId: string }> }) {
  const { id, lineId } = await context.params;
  try {
    const body = asRecord(await request.json().catch(() => null));
    if (!body) {
      return NextResponse.json({ ok: false, code: "INVALID_JSON_BODY", error: "Request body must be a JSON object" }, { status: 400 });
    }
    const result = await updateWorkOrderLine(id, lineId, body, actor(body));
    const issueState = await reconcileIssues(id);
    return NextResponse.json({ ok: true, ...result, ...issueState });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string; lineId: string }> }) {
  const { id, lineId } = await context.params;
  try {
    const parsed = await request.json().catch(() => undefined);
    const body = asRecord(parsed) ?? {};
    const result = await cancelWorkOrderLine(id, lineId, actor(body));
    const issueState = await reconcileIssues(id);
    return NextResponse.json({ ok: true, ...result, ...issueState });
  } catch (error) {
    return errorResponse(error);
  }
}
