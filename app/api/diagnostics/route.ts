import { NextRequest, NextResponse } from "next/server";
import { listDiagnostics, parseDiagnosticStatus } from "@/src/services/diagnostics.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  try {
    const rawStatus = request.nextUrl.searchParams.get("status");
    const status = rawStatus ? parseDiagnosticStatus(rawStatus) : null;
    if (rawStatus && !status) return NextResponse.json({ ok: false, error: "Невідомий статус діагностики." }, { status: 400 });
    const limitRaw = Number(request.nextUrl.searchParams.get("limit") || 200);
    const diagnostics = await listDiagnostics({ status, limit: Number.isFinite(limitRaw) ? limitRaw : 200 });
    return NextResponse.json({ ok: true, diagnostics }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/diagnostics failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити діагностики." }, { status: 500 });
  }
}
