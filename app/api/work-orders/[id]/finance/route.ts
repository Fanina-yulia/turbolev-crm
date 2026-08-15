import { NextResponse } from "next/server";
import { WorkOrderFinanceValidationError } from "@/src/domain/work-order-finance";
import {
  getWorkOrderFinance,
  savePlannedWorkOrderFinance,
  WorkOrderFinanceError,
} from "@/src/services/work-order-finance.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof WorkOrderFinanceValidationError) {
    return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: 400 });
  }
  if (error instanceof WorkOrderFinanceError) {
    const status = error.code === "WORK_ORDER_NOT_FOUND" ? 404 : 409;
    return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status });
  }
  console.error("[work-order-finance]", error);
  return NextResponse.json({ ok: false, code: "INTERNAL_ERROR", error: "Financial operation failed" }, { status: 500 });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const result = await getWorkOrderFinance(id);
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const actorName = typeof body.actorName === "string" && body.actorName.trim()
      ? body.actorName.trim().slice(0, 120)
      : "CRM / Сервіс-менеджер";
    const result = await savePlannedWorkOrderFinance(id, body, actorName);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
