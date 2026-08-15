import { NextRequest, NextResponse } from "next/server";
import {
  loadWorkflowPresentationSettings,
  resetWorkflowStatusPresentation,
  updateWorkflowStatusPresentation,
  workflowPresentationErrorMessage,
} from "@/src/services/workflow-presentation.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const settings = await loadWorkflowPresentationSettings();
    return NextResponse.json({ ok: true, settings }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Workflow presentation GET failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити presentation-налаштування." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const entity = typeof body.entity === "string" ? body.entity : "";
    const status = typeof body.status === "string" ? body.status : "";
    const override = body.override && typeof body.override === "object" ? body.override : {};
    const result = await updateWorkflowStatusPresentation(entity, status, override);
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    console.error("Workflow presentation PUT failed", error);
    return NextResponse.json({ ok: false, error: workflowPresentationErrorMessage(code) }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const entity = request.nextUrl.searchParams.get("entity") ?? "";
    const status = request.nextUrl.searchParams.get("status") ?? "";
    const settings = await resetWorkflowStatusPresentation(entity, status);
    return NextResponse.json({ ok: true, settings }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    console.error("Workflow presentation DELETE failed", error);
    return NextResponse.json({ ok: false, error: workflowPresentationErrorMessage(code) }, { status: 400 });
  }
}
