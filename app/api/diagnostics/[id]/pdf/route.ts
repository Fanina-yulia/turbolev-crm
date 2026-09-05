import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { assertDiagnosticScope } from "@/src/services/diagnostic-access.service";
import { DiagnosticCardError } from "@/src/services/diagnostic-card.service";
import {
  DiagnosticCardPdfError,
  getDiagnosticCardPdfFile,
  getLatestDiagnosticCardPdf,
  saveDiagnosticCardPdf,
} from "@/src/services/diagnostic-card-pdf.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function failure(error: unknown, fallback: string) {
  if (error instanceof DiagnosticCardPdfError || error instanceof DiagnosticCardError) {
    return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
  }
  console.error(fallback, error);
  return NextResponse.json({ ok: false, error: fallback }, { status: 500 });
}

function safeDownloadName(value: string) {
  return value.replace(/[\r\n"]/g, "_");
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.DIAGNOSTICS_READ, { request, minimumScope: "SELF" });
    if (!access.allowed) return access.response!;
    if (!(await assertDiagnosticScope(access, id))) return NextResponse.json({ ok: false, error: "LOCATION_FORBIDDEN" }, { status: 403 });

    const url = new URL(request.url);
    if (url.searchParams.get("meta") === "1") {
      return NextResponse.json({ ok: true, pdf: await getLatestDiagnosticCardPdf(id) }, { headers: { "Cache-Control": "no-store" } });
    }

    const pdf = await getDiagnosticCardPdfFile(id);
    if (!pdf) return NextResponse.json({ ok: false, error: "PDF_NOT_SAVED", message: "Діагностичну карту ще не збережено у PDF-файл." }, { status: 404 });
    const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
    return new Response(pdf.fileData, {
      status: 200,
      headers: {
        "Content-Type": pdf.mimeType,
        "Content-Length": String(pdf.fileSize),
        "Content-Disposition": `${disposition}; filename="${safeDownloadName(pdf.fileName)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return failure(error, "DIAGNOSTIC_CARD_PDF_LOAD_FAILED");
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.DIAGNOSTICS_WRITE, { request, minimumScope: "LOCATION", strict: true });
    if (!access.allowed) return access.response!;
    if (!(await assertDiagnosticScope(access, id))) return NextResponse.json({ ok: false, error: "LOCATION_FORBIDDEN" }, { status: 403 });
    const result = await saveDiagnosticCardPdf(id, access.context.user?.id || null, access.context.user?.name || "CRM / Сервіс-менеджер");
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error, "DIAGNOSTIC_CARD_PDF_SAVE_FAILED");
  }
}
