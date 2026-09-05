import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { assertDiagnosticScope } from "@/src/services/diagnostic-access.service";
import { DiagnosticCardPdfError, createDiagnosticCardPdfShare } from "@/src/services/diagnostic-card-pdf.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.DIAGNOSTICS_WRITE, { request, minimumScope: "LOCATION", strict: true });
    if (!access.allowed) return access.response!;
    if (!(await assertDiagnosticScope(access, id))) return NextResponse.json({ ok: false, error: "LOCATION_FORBIDDEN" }, { status: 403 });
    const result = await createDiagnosticCardPdfShare(id, access.context.user?.id || null);
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof DiagnosticCardPdfError) return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    console.error("POST diagnostic card PDF share failed", error);
    return NextResponse.json({ ok: false, error: "DIAGNOSTIC_CARD_PDF_SHARE_FAILED", message: "Не вдалося створити посилання на PDF-файл." }, { status: 500 });
  }
}
