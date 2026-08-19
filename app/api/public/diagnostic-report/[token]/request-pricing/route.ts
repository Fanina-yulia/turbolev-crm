import { NextResponse } from "next/server";
import { DiagnosticReportError, requestDiagnosticPricing } from "@/src/services/diagnostic-report.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  try {
    await requestDiagnosticPricing(token);
    const back = new URL(`/r/${encodeURIComponent(token)}?pricing=requested`, request.url);
    return NextResponse.redirect(back, 303);
  } catch (error) {
    if (error instanceof DiagnosticReportError) return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    console.error("POST public diagnostic pricing request failed", error);
    return NextResponse.json({ ok: false, error: "PRICING_REQUEST_FAILED" }, { status: 500 });
  }
}
