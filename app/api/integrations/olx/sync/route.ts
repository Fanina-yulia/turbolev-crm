import { NextRequest, NextResponse } from "next/server";
import { syncOlxInbox } from "@/src/services/olx-communications.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const result = await syncOlxInbox();
    return NextResponse.json(result);
  } catch (error) {
    console.error("POST /api/integrations/olx/sync failed", error);
    const code = typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code || "OLX_SYNC_FAILED")
      : "OLX_SYNC_FAILED";
    const status = code === "OLX_RATE_LIMITED" ? 429 : code.includes("AUTH") || code.includes("REAUTH") ? 422 : 502;
    return NextResponse.json({ ok: false, code, error: error instanceof Error ? error.message : "OLX sync failed" }, { status });
  }
}
