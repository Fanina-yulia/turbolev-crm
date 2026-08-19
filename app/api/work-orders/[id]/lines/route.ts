import { NextResponse } from "next/server";
import { WorkOrderFinanceValidationError } from "@/src/domain/work-order-finance";
import {
  createWorkOrderLine,
  getWorkOrderLines,
  WorkOrderLineError,
} from "@/src/services/work-order-lines.service";
import {
  buildWorkOrderLineWarranty,
  prepareCatalogWorkOrderLineInput,
  WorkOrderServiceWarrantyError,
} from "@/src/services/work-order-service-warranty.service";

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
  if (error instanceof WorkOrderFinanceValidationError) {
    return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: 400 });
  }
  if (error instanceof WorkOrderServiceWarrantyError) {
    const status = error.code === "CATALOG_WORK_NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status });
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
    const warranties = result.lines.map(buildWorkOrderLineWarranty).filter(Boolean);
    return NextResponse.json({ ok: true, ...result, warranties }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const body = asRecord(await request.json().catch(() => null));
    if (!body) {
      return NextResponse.json({ ok: false, code: "INVALID_JSON_BODY", error: "Request body must be a JSON object" }, { status: 400 });
    }
    const prepared = await prepareCatalogWorkOrderLineInput(body);
    const result = await createWorkOrderLine(id, prepared, actor(body));
    return NextResponse.json({ ok: true, ...result, warranty: buildWorkOrderLineWarranty(result.line) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}