import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getDiagnosticCard, DiagnosticCardError } from "@/src/services/diagnostic-card.service";
import { assertDiagnosticScope } from "@/src/services/diagnostic-access.service";
import { StructuredDiagnosticError } from "@/src/services/structured-diagnostics.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.DIAGNOSTICS_READ, { request, minimumScope: "SELF" });
    if (!access.allowed) return access.response!;
    if (!(await assertDiagnosticScope(access, id))) return NextResponse.json({ ok: false, error: "LOCATION_FORBIDDEN" }, { status: 403 });
    const state = await getDiagnosticCard(id);
    if (!state) return NextResponse.json({ ok: true, card: null }, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({
      ok: true,
      card: state.card,
      latest: state.latest,
      final: state.final,
      revisions: state.revisions.map((revision) => ({
        id: revision.id,
        revision: revision.revision,
        kind: revision.kind,
        sourceFingerprint: revision.sourceFingerprint,
        createdByUserId: revision.createdByUserId,
        createdAt: revision.createdAt,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof DiagnosticCardError || error instanceof StructuredDiagnosticError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    }
    console.error("GET diagnostic card failed", error);
    return NextResponse.json({ ok: false, error: "DIAGNOSTIC_CARD_LOAD_FAILED" }, { status: 500 });
  }
}
