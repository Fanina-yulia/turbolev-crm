import { NextRequest, NextResponse } from "next/server";
import { getSqlPool } from "@/src/lib/sql";
import { syncOlxInbox } from "@/src/services/olx-communications.service";
import { isIntegrationConfigured } from "@/src/services/integration-credentials.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_SYNC_INTERVAL_MS = 45_000;

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    if (!(await isIntegrationConfigured("OLX"))) {
      return NextResponse.json({ ok: true, configured: false, skipped: true });
    }

    const row = await getSqlPool().query<{ lastSyncedAt: Date | null; status: string }>(
      `SELECT "lastSyncedAt","status" FROM "CommunicationSyncState" WHERE "provider"='OLX' LIMIT 1`,
    ).catch(() => ({ rows: [] as Array<{ lastSyncedAt: Date | null; status: string }> }));
    const lastSyncedAt = row.rows[0]?.lastSyncedAt || null;
    if (lastSyncedAt && Date.now() - lastSyncedAt.getTime() < MIN_SYNC_INTERVAL_MS) {
      return NextResponse.json({ ok: true, configured: true, skipped: true, lastSyncedAt: lastSyncedAt.toISOString() });
    }

    const result = await syncOlxInbox();
    return NextResponse.json({ ...result, configured: true, skipped: false });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code || "OLX_POLL_FAILED")
      : "OLX_POLL_FAILED";
    const status = code === "OLX_RATE_LIMITED" ? 429 : code.includes("AUTH") || code.includes("REAUTH") ? 422 : 502;
    return NextResponse.json({ ok: false, code, error: error instanceof Error ? error.message : "OLX poll failed" }, { status });
  }
}
