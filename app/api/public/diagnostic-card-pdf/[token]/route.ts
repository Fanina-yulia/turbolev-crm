import { NextResponse } from "next/server";
import { DiagnosticCardPdfError, getDiagnosticCardPdfByToken } from "@/src/services/diagnostic-card-pdf.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  try {
    const pdf = await getDiagnosticCardPdfByToken(token);
    return new Response(pdf.fileData, {
      status: 200,
      headers: {
        "Content-Type": pdf.mimeType,
        "Content-Length": String(pdf.fileSize),
        "Content-Disposition": `inline; filename="${pdf.fileName.replace(/[\r\n"]/g, "_")}"`,
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof DiagnosticCardPdfError) return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    console.error("GET public diagnostic card PDF failed", error);
    return NextResponse.json({ ok: false, error: "PUBLIC_DIAGNOSTIC_CARD_PDF_LOAD_FAILED" }, { status: 500 });
  }
}
