import { NextRequest, NextResponse } from "next/server";
import { getWorkflowCatalog, getWorkflowDefinition } from "@/src/domain/workflow";
import type { WorkflowEntity } from "@/src/domain/workflow";

export const dynamic = "force-dynamic";

const ENTITIES = new Set<WorkflowEntity>([
  "INQUIRY", "LEAD", "CLIENT", "VEHICLE", "APPOINTMENT", "DIAGNOSTIC", "WORK_ORDER",
  "PARTS_REQUEST", "SUPPLIER_ORDER", "STOCK_RESERVATION", "PAYMENT", "QUALITY_CONTROL", "WARRANTY",
]);

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("entity")?.trim().toUpperCase();
  if (raw) {
    if (!ENTITIES.has(raw as WorkflowEntity)) {
      return NextResponse.json({ ok: false, error: "UNKNOWN_WORKFLOW_ENTITY" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, definition: getWorkflowDefinition(raw as WorkflowEntity) }, { headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ ok: true, catalog: getWorkflowCatalog() }, { headers: { "Cache-Control": "no-store" } });
}
