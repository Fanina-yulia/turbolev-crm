import { NextResponse } from "next/server";
import { WorkOrderFinanceValidationError } from "@/src/domain/work-order-finance";
import {
  createWorkOrderLine,
  getWorkOrderLines,
  WorkOrderLineError,
} from "@/src/services/work-order-lines.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function actor(body: Record<string, unknown>) {
  return typeof body.actorName === "string" && body.actorName.trim()
    ? body.actorName.trim().slice(0, 120)
    : "CRM / Сервіс-менеджер";
}

function errorResponse(error: unknown) {
  if (error instanceof WorkOrderFinanceValidationError) {
    return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: 400 });
  }
  if (error instanceof WorkOrderLineError) {
    const status = ["WORK_ORDER_NOT_FOUND", "LINE_NOT_FOUND", "CATALOG_WORK_NOT_FOUND", "SUPPLIER_QUOTE_NOT_FOUND"].includes(error.code)
      ? 404
      : error.code === "ACTUAL_ALREADY_LOCKED" || error.code === "INVALID_STATUS_TRANSITION"
        ? 409
        : 400;
    return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status });
  }
  console.error("[work-order-lines]", error);
  return NextResponse.json({ ok: false, code: "INTERNAL_ERROR", error: "WorkOrder line operation failed" }, { status: 500 });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const result = await getWorkOrderLines(id);
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const result = await createWorkOrderLine(id, body, actor(body));
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
