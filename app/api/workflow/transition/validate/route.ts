import { NextRequest, NextResponse } from "next/server";
import { evaluateWorkflowTransition, getWorkflowCatalog, type HardGateCode, type WorkflowEntity } from "@/src/domain/workflow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const catalog = getWorkflowCatalog();
const entities = new Set<WorkflowEntity>(catalog.entities.map((item) => item.entity));
const hardGates = new Set<HardGateCode>(Object.keys(catalog.hardGates) as HardGateCode[]);

function asGateState(value: unknown): Partial<Record<HardGateCode, boolean>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Partial<Record<HardGateCode, boolean>> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const gate = key.trim().toUpperCase() as HardGateCode;
    if (hardGates.has(gate) && typeof raw === "boolean") result[gate] = raw;
  }
  return result;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const rawEntity = typeof body.entity === "string" ? body.entity.trim().toUpperCase() : "";
    const from = typeof body.from === "string" ? body.from.trim() : "";
    const to = typeof body.to === "string" ? body.to.trim() : "";
    if (!entities.has(rawEntity as WorkflowEntity)) {
      return NextResponse.json({ ok: false, error: "UNKNOWN_WORKFLOW_ENTITY" }, { status: 400 });
    }
    if (!from || !to) {
      return NextResponse.json({ ok: false, error: "FROM_AND_TO_REQUIRED" }, { status: 400 });
    }
    const decision = evaluateWorkflowTransition({
      entity: rawEntity as WorkflowEntity,
      from,
      to,
      gates: asGateState(body.gates),
    });
    return NextResponse.json({
      ok: true,
      mode: "dry-run",
      decision,
      gateLabels: Object.fromEntries(decision.requiredGates.map((gate) => [gate, catalog.hardGates[gate]])),
      actionLabels: Object.fromEntries(decision.actions.map((action) => [action, catalog.actions[action]])),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Workflow transition validation failed", error);
    return NextResponse.json({ ok: false, error: "WORKFLOW_RUNTIME_ERROR" }, { status: 500 });
  }
}
