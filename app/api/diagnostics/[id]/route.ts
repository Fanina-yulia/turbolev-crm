import { NextResponse } from "next/server";
import {
  DiagnosticNotFoundError,
  DiagnosticTransitionError,
  DiagnosticValidationError,
  getDiagnostic,
  parseDiagnosticStatus,
  transitionDiagnostic,
} from "@/src/services/diagnostics.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const diagnostic = await getDiagnostic(id);
    if (!diagnostic) return NextResponse.json({ ok: false, error: "Діагностику не знайдено." }, { status: 404 });
    return NextResponse.json({ ok: true, diagnostic }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/diagnostics/[id] failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити діагностику." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const body = await request.json() as Record<string, unknown>;
    const status = parseDiagnosticStatus(body.status);
    if (!status) return NextResponse.json({ ok: false, error: "Оберіть коректний статус діагностики." }, { status: 400 });
    const result = await transitionDiagnostic(id, {
      status,
      technicalConclusion: typeof body.technicalConclusion === "string" ? body.technicalConclusion : undefined,
      actorName: typeof body.actorName === "string" ? body.actorName : undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof DiagnosticNotFoundError) {
      return NextResponse.json({ ok: false, error: "Діагностику не знайдено." }, { status: 404 });
    }
    if (error instanceof DiagnosticValidationError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    if (error instanceof DiagnosticTransitionError) {
      return NextResponse.json({
        ok: false,
        error: "Цей перехід статусу заборонений процесом.",
        workflowDecision: error.decision,
      }, { status: 409 });
    }
    console.error("PATCH /api/diagnostics/[id] failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося змінити діагностику." }, { status: 500 });
  }
}
