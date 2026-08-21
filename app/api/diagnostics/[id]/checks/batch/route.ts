import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { StructuredDiagnosticError } from "@/src/services/structured-diagnostics.service";
import { updateQuickDiagnosticChecksBatch } from "@/src/services/quick-diagnostic-batch.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.DIAGNOSTICS_WRITE, { request, minimumScope: "ASSIGNED" });
    if (!access.allowed) return access.response!;
    if (!access.context.user || !access.context.roles.some((role) => role.code === "MECHANIC")) {
      return NextResponse.json({ ok: false, error: "MECHANIC_ROLE_REQUIRED" }, { status: 403 });
    }

    const body = await request.json().catch(() => null) as { updates?: Array<{ checkId?: unknown; state?: unknown }> } | null;
    const updates = Array.isArray(body?.updates)
      ? body!.updates.flatMap((item) => {
        const checkId = typeof item?.checkId === "string" ? item.checkId.trim().slice(0, 128) : "";
        const state = String(item?.state || "").toUpperCase();
        return checkId && state === "OK" ? [{ checkId, state: "OK" as const }] : [];
      })
      : [];

    if (!updates.length) {
      return NextResponse.json({ ok: false, error: "CHECKS_REQUIRED", message: "Не передано пункти для збереження." }, { status: 400 });
    }
    if (updates.length > 100) {
      return NextResponse.json({ ok: false, error: "TOO_MANY_CHECKS", message: "За один раз можна зберегти не більше 100 пунктів." }, { status: 400 });
    }

    const data = await updateQuickDiagnosticChecksBatch(access.context.user.id, id, updates);
    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    if (error instanceof StructuredDiagnosticError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    }
    console.error("PATCH diagnostic checks batch failed", error);
    return NextResponse.json({ ok: false, error: "DIAGNOSTIC_CHECK_BATCH_UPDATE_FAILED", message: "Не вдалося зберегти відмітки діагностики." }, { status: 500 });
  }
}
