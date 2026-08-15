import { NextResponse } from "next/server";
import { listAuditEvents } from "@/src/services/audit.service";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorize(PERMISSIONS.AUDIT_READ, { request });
  if (!auth.allowed) return auth.response!;

  const { searchParams } = new URL(request.url);
  const entityType = searchParams.get("entityType")?.trim() || "";
  const entityId = searchParams.get("entityId")?.trim() || "";
  if (!entityType || !entityId) {
    return NextResponse.json({ ok: false, error: "entityType and entityId are required" }, { status: 400 });
  }
  const events = await listAuditEvents(entityType, entityId, Number(searchParams.get("take") || 50));
  return NextResponse.json(
    { ok: true, events, security: { enforcementMode: auth.context.enforcementMode, shadowBypass: auth.shadowBypass } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
