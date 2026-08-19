import { NextResponse } from "next/server";
import { DiagnosticReportError, getSharedDiagnosticMedia } from "@/src/services/diagnostic-report.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ token: string; mediaId: string }> }) {
  const { token, mediaId } = await context.params;
  try {
    const media = await getSharedDiagnosticMedia(token, mediaId);
    return new Response(media.fileData, {
      status: 200,
      headers: {
        "Content-Type": media.mimeType,
        "Content-Length": String(media.fileSize),
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": `inline; filename="${media.fileName.replace(/[\r\n\"]/g, "_")}"`,
      },
    });
  } catch (error) {
    if (error instanceof DiagnosticReportError) return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    console.error("GET public diagnostic media failed", error);
    return NextResponse.json({ ok: false, error: "REPORT_MEDIA_LOAD_FAILED" }, { status: 500 });
  }
}
