import { NextRequest, NextResponse } from "next/server";
import { listMetaManagedAccounts, selectMetaManagedAccount } from "@/src/services/meta-account-selection.service";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

export async function GET(request: NextRequest) {
  const access = await authorize(PERMISSIONS.SETTINGS_INTEGRATIONS, { strict: true, request });
  if (!access.allowed) return access.response!;
  try {
    const accounts = await listMetaManagedAccounts();
    return NextResponse.json({ ok: true, accounts }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Не вдалося отримати Meta Pages" }, { status: 422 });
  }
}

export async function PUT(request: NextRequest) {
  const access = await authorize(PERMISSIONS.SETTINGS_INTEGRATIONS, { strict: true, request });
  if (!access.allowed) return access.response!;
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({})) as { pageId?: unknown };
    const pageId = typeof body.pageId === "string" ? body.pageId : "";
    const selected = await selectMetaManagedAccount(pageId);
    return NextResponse.json({ ok: true, selected }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Не вдалося вибрати Meta Page" }, { status: 422 });
  }
}
