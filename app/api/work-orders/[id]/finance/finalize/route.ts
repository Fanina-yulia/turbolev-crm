import { NextResponse } from "next/server";
import { WorkOrderFinanceValidationError } from "@/src/domain/work-order-finance";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeWorkOrderRecord } from "@/src/security/work-order-scope";
import {
  finalizeWorkOrderFinance,
  WorkOrderFinanceError,
} from "@/src/services/work-order-finance.service";
import {
  finalizeWorkOrderFinanceFromLines,
  hasWorkOrderLines,
  WorkOrderLineError,
} from "@/src/services/work-order-lines.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof WorkOrderFinanceValidationError) {
    return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: 400 });
  }
  if (error instanceof WorkOrderLineError) {
    const status = error.code === "WORK_ORDER_NOT_FOUND" ? 404 : ["ACTUAL_ALREADY_LOCKED", "LINES_NOT_COMPLETED"].includes(error.code) ? 409 : 400;
    return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status });
  }
  if (error instanceof WorkOrderFinanceError) {
    const status = error.code === "WORK_ORDER_NOT_FOUND" ? 404 : 409;
    return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status });
  }
  console.error("[work-order-finance-finalize]", error);
  return NextResponse.json({ ok: false, code: "INTERNAL_ERROR", error: "Financial finalization failed" }, { status: 500 });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await authorizeWorkOrderRecord(PERMISSIONS.FINANCE_WRITE, request, id);
  if (!access.allowed) return access.response;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const actorName = access.context.user?.name || access.context.user?.email || "CRM / Фінанси";
    const usesLines = await hasWorkOrderLines(id);
    const result = usesLines
      ? await finalizeWorkOrderFinanceFromLines(id, body, actorName)
      : await finalizeWorkOrderFinance(id, body, actorName);

    return NextResponse.json({
      ok: true,
      sourceOfTruth: usesLines ? "WORK_ORDER_LINES" : "LEGACY_FINANCE_INPUT",
      ...result,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
