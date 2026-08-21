import { NextResponse } from "next/server";
import { WorkOrderFinanceValidationError } from "@/src/domain/work-order-finance";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeWorkOrderRecord } from "@/src/security/work-order-scope";
import {
  getWorkOrderFinance,
  savePlannedWorkOrderFinance,
  WorkOrderFinanceError,
} from "@/src/services/work-order-finance.service";
import {
  hasWorkOrderLines,
  rebuildPlannedSnapshotFromLines,
  WorkOrderLineError,
} from "@/src/services/work-order-lines.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof WorkOrderFinanceValidationError) {
    return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: 400 });
  }
  if (error instanceof WorkOrderLineError) {
    const status = error.code === "WORK_ORDER_NOT_FOUND" ? 404 : error.code === "ACTUAL_ALREADY_LOCKED" ? 409 : 400;
    return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status });
  }
  if (error instanceof WorkOrderFinanceError) {
    const status = error.code === "WORK_ORDER_NOT_FOUND" ? 404 : 409;
    return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status });
  }
  console.error("[work-order-finance]", error);
  return NextResponse.json({ ok: false, code: "INTERNAL_ERROR", error: "Financial operation failed" }, { status: 500 });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await authorizeWorkOrderRecord(PERMISSIONS.FINANCE_READ, request, id);
  if (!access.allowed) return access.response;

  try {
    const result = await getWorkOrderFinance(id);
    const lineItems = await hasWorkOrderLines(id);
    return NextResponse.json(
      { ok: true, ...result, sourceOfTruth: lineItems ? "WORK_ORDER_LINES" : "LEGACY_FINANCE_INPUT" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await authorizeWorkOrderRecord(PERMISSIONS.FINANCE_WRITE, request, id);
  if (!access.allowed) return access.response;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const actorName = access.context.user?.name || access.context.user?.email || "CRM / Фінанси";

    if (await hasWorkOrderLines(id)) {
      const result = await rebuildPlannedSnapshotFromLines(id, actorName);
      return NextResponse.json({ ok: true, sourceOfTruth: "WORK_ORDER_LINES", ...result });
    }

    const result = await savePlannedWorkOrderFinance(id, body, actorName);
    return NextResponse.json({ ok: true, sourceOfTruth: "LEGACY_FINANCE_INPUT", ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
